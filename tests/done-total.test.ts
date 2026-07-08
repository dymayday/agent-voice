import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { createEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import {
	countByStatus,
	countsForSnapshot,
	enqueue,
	getDoneTotal,
	markDone,
	pruneRetention,
} from "../src/store";
import { getQueueSnapshot, getStatus } from "../src/app-service/status-service";

function completeJob(
	db: ReturnType<typeof openDb>,
	text: string,
	finishedAt: Date,
): string {
	const event = createEvent({ agent: "claude", text });
	enqueue(db, event);
	markDone(db, event.id, finishedAt);
	return event.id;
}

describe("lifetime done total", () => {
	test("markDone increments a total that pruneRetention does not decrease", () => {
		const db = openDb(":memory:");
		try {
			const now = new Date("2026-07-08T12:00:00.000Z");
			completeJob(db, "recent", now);
			completeJob(db, "old", new Date("2026-06-29T12:00:00.000Z")); // > 7 days

			expect(getDoneTotal(db)).toBe(2);
			expect(countByStatus(db).done).toBe(2);

			pruneRetention(db, 7, now);

			// The live gauge drops as the aged job is deleted, but the lifetime
			// total — the number the "Done" tile shows — must not go backwards.
			expect(countByStatus(db).done).toBe(1);
			expect(getDoneTotal(db)).toBe(2);
		} finally {
			db.close();
		}
	});

	test("countsForSnapshot reports the lifetime total for done, live counts otherwise", () => {
		const db = openDb(":memory:");
		try {
			const now = new Date("2026-07-08T12:00:00.000Z");
			completeJob(db, "old", new Date("2026-06-01T00:00:00.000Z"));
			pruneRetention(db, 7, now);

			expect(countsForSnapshot(db).done).toBe(1); // never decreases

			const pending = createEvent({ agent: "codex", text: "pending" });
			enqueue(db, pending);
			expect(countsForSnapshot(db).pending).toBe(1); // other statuses stay live
			expect(countsForSnapshot(db).done).toBe(1);
		} finally {
			db.close();
		}
	});

	test("markDone is idempotent for the total", () => {
		const db = openDb(":memory:");
		try {
			const now = new Date("2026-07-08T12:00:00.000Z");
			const event = createEvent({ agent: "claude", text: "x" });
			enqueue(db, event);
			markDone(db, event.id, now);
			markDone(db, event.id, now); // re-mark the same job

			expect(getDoneTotal(db)).toBe(1);
		} finally {
			db.close();
		}
	});

	test("getDoneTotal falls back to the live done count when unseeded", () => {
		const db = openDb(":memory:");
		try {
			// Simulate a pre-feature database: done rows exist but no counter key.
			for (const text of ["a", "b", "c"]) {
				const event = createEvent({ agent: "claude", text });
				enqueue(db, event);
				db.query(
					"UPDATE jobs SET status='done', finished_at=$f WHERE id=$id",
				).run({ $f: "2026-07-01T00:00:00.000Z", $id: event.id });
			}
			db.query("DELETE FROM schema_meta WHERE key='done_total'").run();

			// getDoneTotal's live-count fallback keeps read paths correct on a DB
			// that predates the counter key (the persist-on-open path is covered by
			// the reopen test below).
			expect(getDoneTotal(db)).toBe(3);
		} finally {
			db.close();
		}
	});
});

describe("lifetime done total: persistence and snapshot paths", () => {
	function fileFixture() {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-done-total-"));
		const paths = resolvePaths({ AGENT_VOICE_HOME: home });
		return { home, paths };
	}

	test("openDb seeds and persists the total from pre-existing done rows", () => {
		const { home, paths } = fileFixture();
		try {
			// Simulate a pre-feature DB: done rows on disk, counter key removed.
			const seed = openDb(paths.db);
			for (const text of ["a", "b", "c"]) {
				const event = createEvent({ agent: "claude", text });
				enqueue(seed, event);
				markDone(seed, event.id, new Date("2026-07-01T00:00:00.000Z"));
			}
			seed.query("DELETE FROM schema_meta WHERE key='done_total'").run();
			seed.close();

			// Reopening through openDb must WRITE the key from surviving rows, not
			// just rely on the read-time fallback — so the total then survives prunes.
			const reopened = openDb(paths.db);
			try {
				const row = reopened
					.query("SELECT value FROM schema_meta WHERE key='done_total'")
					.get() as { value: string } | null;
				expect(row?.value).toBe("3");
				expect(getDoneTotal(reopened)).toBe(3);
			} finally {
				reopened.close();
			}
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("persisted total survives a restart after a prune (no reseed down)", () => {
		const { home, paths } = fileFixture();
		try {
			const now = new Date("2026-07-08T12:00:00.000Z");
			const writer = openDb(paths.db);
			const recent = createEvent({ agent: "claude", text: "recent" });
			const old = createEvent({ agent: "codex", text: "old" });
			enqueue(writer, recent);
			enqueue(writer, old);
			markDone(writer, recent.id, now);
			markDone(writer, old.id, new Date("2026-06-29T12:00:00.000Z"));
			pruneRetention(writer, 7, now); // deletes the aged done row
			expect(countByStatus(writer).done).toBe(1);
			expect(getDoneTotal(writer)).toBe(2);
			writer.close();

			// Restart: seedDoneTotal must not overwrite the persisted total with the
			// smaller post-prune live count — that would reintroduce the bug.
			const restarted = openDb(paths.db);
			try {
				expect(countByStatus(restarted).done).toBe(1);
				expect(getDoneTotal(restarted)).toBe(2);
				expect(countsForSnapshot(restarted).done).toBe(2);
			} finally {
				restarted.close();
			}
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("status read paths report the lifetime total after a prune", () => {
		const { home, paths } = fileFixture();
		try {
			const now = new Date("2026-07-08T12:00:00.000Z");
			const db = openDb(paths.db);
			const recent = createEvent({ agent: "claude", text: "recent" });
			const old = createEvent({ agent: "codex", text: "old" });
			enqueue(db, recent);
			enqueue(db, old);
			markDone(db, recent.id, now);
			markDone(db, old.id, new Date("2026-06-01T00:00:00.000Z"));
			pruneRetention(db, 7, now); // live done drops to 1, lifetime total stays 2
			db.close();

			// status-service getQueueSnapshot (read-only open) -> countsForSnapshot
			const snapshot = getQueueSnapshot(paths);
			expect(snapshot.ok).toBe(true);
			if (!snapshot.ok) throw new Error(snapshot.error.message);
			expect(snapshot.value.counts.done).toBe(2);
			expect(snapshot.value.recent).toHaveLength(1); // only the surviving row

			// getStatus -> buildAppStatusSnapshot -> readQueueCounts -> countsForSnapshot
			const status = getStatus(paths, {
				daemonDeps: { isPidAlive: () => false },
				installEnv: { HOME: home },
				playback: { platform: "linux", commandExists: () => false },
			});
			expect(status.ok).toBe(true);
			if (!status.ok) throw new Error(status.error.message);
			expect(status.value.queue.done).toBe(2);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
