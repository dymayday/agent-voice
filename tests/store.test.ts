import { describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { createEvent } from "../src/events";
import {
	enqueue,
	countByStatus,
	clearActiveQueue,
	clearFailedJobs,
} from "../src/store";

describe("store: clear active queue", () => {
	test("deletes pending and processing jobs while preserving history", () => {
		const db = openDb(":memory:");
		try {
			const pending = createEvent({ agent: "claude", text: "Pending." });
			const processing = createEvent({ agent: "codex", text: "Processing." });
			const done = createEvent({ agent: "pi", text: "Done." });
			const failed = createEvent({ agent: "claude", text: "Failed." });
			const skipped = createEvent({ agent: "codex", text: "Skipped." });
			for (const event of [pending, processing, done, failed, skipped])
				enqueue(db, event);
			db.query("UPDATE jobs SET status='processing' WHERE id=?").run(
				processing.id,
			);
			db.query("UPDATE jobs SET status='done' WHERE id=?").run(done.id);
			db.query("UPDATE jobs SET status='failed' WHERE id=?").run(failed.id);
			db.query("UPDATE jobs SET status='skipped' WHERE id=?").run(skipped.id);

			const deleted = clearActiveQueue(db);

			expect(deleted).toBe(2);
			expect(countByStatus(db)).toEqual({
				pending: 0,
				processing: 0,
				done: 1,
				failed: 1,
				skipped: 1,
			});
		} finally {
			db.close();
		}
	});

	test("clears failed jobs without touching active or done history", () => {
		const db = openDb(":memory:");
		try {
			const pending = createEvent({ agent: "claude", text: "Pending." });
			const done = createEvent({ agent: "pi", text: "Done." });
			const failed = createEvent({ agent: "codex", text: "Failed." });
			enqueue(db, pending);
			enqueue(db, done);
			enqueue(db, failed);
			db.query("UPDATE jobs SET status='failed' WHERE id=?").run(failed.id);
			db.query("UPDATE jobs SET status='done' WHERE id=?").run(done.id);

			const deleted = clearFailedJobs(db);

			expect(deleted).toBe(1);
			expect(countByStatus(db)).toEqual({
				pending: 1,
				processing: 0,
				done: 1,
				failed: 0,
				skipped: 0,
			});
		} finally {
			db.close();
		}
	});
});

describe("store: enqueue + dedup", () => {
	test("enqueue inserts a pending job", () => {
		const db = openDb(":memory:");
		try {
			const event = createEvent({ agent: "claude", text: "Hello." });
			const res = enqueue(db, event);
			expect(res.inserted).toBe(true);
			expect(countByStatus(db).pending).toBe(1);
		} finally {
			db.close();
		}
	});

	test("duplicate event id is a no-op", () => {
		const db = openDb(":memory:");
		try {
			const event = createEvent({ agent: "claude", text: "Once." });
			expect(enqueue(db, event).inserted).toBe(true);
			expect(
				enqueue(db, { ...event, text: "Different payload." }).inserted,
			).toBe(false);
			expect(countByStatus(db).pending).toBe(1);
		} finally {
			db.close();
		}
	});
});

import { claimNextDue, recoverStale } from "../src/store";
import { defaultConfig } from "../src/config";
import { getNextDueTime, msUntilNextDue } from "../src/store";

describe("store: due-time queries", () => {
	test("empty queue returns null", () => {
		const db = openDb(":memory:");
		try {
			expect(getNextDueTime(db)).toBeNull();
			expect(msUntilNextDue(db, new Date("2026-06-12T00:00:00.000Z"))).toBeNull();
		} finally {
			db.close();
		}
	});

	test("pending job with NULL next_attempt_at is due now (sentinel, 0ms)", () => {
		const db = openDb(":memory:");
		try {
			enqueue(db, createEvent({ agent: "claude", text: "Due now." }));
			expect(getNextDueTime(db)).toBe("0000-01-01T00:00:00.000Z");
			expect(msUntilNextDue(db, new Date("2026-06-12T00:00:00.000Z"))).toBe(0);
		} finally {
			db.close();
		}
	});

	test("future next_attempt_at yields a positive ms delta", () => {
		const db = openDb(":memory:");
		try {
			const event = createEvent({ agent: "pi", text: "Later." });
			enqueue(db, event);
			db.query(
				"UPDATE jobs SET next_attempt_at='2026-06-12T00:00:30.000Z' WHERE id=?",
			).run(event.id);
			expect(getNextDueTime(db)).toBe("2026-06-12T00:00:30.000Z");
			expect(
				msUntilNextDue(db, new Date("2026-06-12T00:00:00.000Z")),
			).toBe(30_000);
		} finally {
			db.close();
		}
	});

	test("past next_attempt_at clamps to 0 (<=0)", () => {
		const db = openDb(":memory:");
		try {
			const event = createEvent({ agent: "codex", text: "Overdue." });
			enqueue(db, event);
			db.query(
				"UPDATE jobs SET next_attempt_at='2026-06-12T00:00:00.000Z' WHERE id=?",
			).run(event.id);
			expect(
				msUntilNextDue(db, new Date("2026-06-12T00:01:00.000Z")),
			).toBe(0);
		} finally {
			db.close();
		}
	});

	test("ignores non-pending jobs (done/processing/failed)", () => {
		const db = openDb(":memory:");
		try {
			const done = createEvent({ agent: "claude", text: "Done." });
			const processing = createEvent({ agent: "codex", text: "Processing." });
			const failed = createEvent({ agent: "pi", text: "Failed." });
			for (const e of [done, processing, failed]) enqueue(db, e);
			db.query(
				"UPDATE jobs SET status='done', next_attempt_at='2026-06-12T00:00:05.000Z' WHERE id=?",
			).run(done.id);
			db.query(
				"UPDATE jobs SET status='processing', next_attempt_at='2026-06-12T00:00:05.000Z' WHERE id=?",
			).run(processing.id);
			db.query(
				"UPDATE jobs SET status='failed', next_attempt_at='2026-06-12T00:00:05.000Z' WHERE id=?",
			).run(failed.id);
			// No pending rows remain, so both queries report "no pending work".
			expect(getNextDueTime(db)).toBeNull();
			expect(
				msUntilNextDue(db, new Date("2026-06-12T00:00:00.000Z")),
			).toBeNull();
		} finally {
			db.close();
		}
	});

	test("NULL-pending row wins over a future-pending row (due now)", () => {
		const db = openDb(":memory:");
		try {
			const future = createEvent({ agent: "claude", text: "Future." });
			const dueNow = createEvent({ agent: "codex", text: "Now." });
			enqueue(db, future);
			enqueue(db, dueNow);
			db.query(
				"UPDATE jobs SET next_attempt_at='2026-06-12T01:00:00.000Z' WHERE id=?",
			).run(future.id);
			// dueNow keeps NULL next_attempt_at -> sentinel wins.
			expect(getNextDueTime(db)).toBe("0000-01-01T00:00:00.000Z");
			expect(msUntilNextDue(db, new Date("2026-06-12T00:00:00.000Z"))).toBe(0);
		} finally {
			db.close();
		}
	});
});

describe("store: claim + recover", () => {
	test("oldest due pending job is claimed first and moved to processing", () => {
		const db = openDb(":memory:");
		try {
			const older = createEvent({ agent: "codex", text: "First." });
			const newer = createEvent({ agent: "claude", text: "Second." });
			enqueue(db, { ...older, createdAt: "2026-06-12T00:00:01.000Z" });
			enqueue(db, { ...newer, createdAt: "2026-06-12T00:00:02.000Z" });

			const claimed = claimNextDue(
				db,
				defaultConfig,
				new Date("2026-06-12T00:01:00.000Z"),
			);
			expect(claimed?.id).toBe(older.id);
			expect(claimed?.attempts).toBe(1);
			expect(countByStatus(db).processing).toBe(1);
			expect(countByStatus(db).pending).toBe(1);
		} finally {
			db.close();
		}
	});

	test("future next_attempt_at job is not claimed until due", () => {
		const db = openDb(":memory:");
		try {
			const event = createEvent({ agent: "pi", text: "Later." });
			enqueue(db, event);
			db.query(
				"UPDATE jobs SET next_attempt_at = '2026-06-12T00:02:00.000Z' WHERE id = ?",
			).run(event.id);
			expect(
				claimNextDue(db, defaultConfig, new Date("2026-06-12T00:01:00.000Z")),
			).toBeNull();
			expect(
				claimNextDue(db, defaultConfig, new Date("2026-06-12T00:02:00.000Z"))
					?.id,
			).toBe(event.id);
		} finally {
			db.close();
		}
	});

	test("disabled system claims nothing and marks skipped", () => {
		const db = openDb(":memory:");
		try {
			enqueue(db, createEvent({ agent: "claude", text: "Queued." }));
			const claimed = claimNextDue(
				db,
				{ ...defaultConfig, enabled: false },
				new Date(),
			);
			expect(claimed).toBeNull();
			expect(countByStatus(db).skipped).toBe(1);
		} finally {
			db.close();
		}
	});

	test("stale processing jobs return to pending; fresh ones stay", () => {
		const db = openDb(":memory:");
		try {
			const stale = createEvent({ agent: "claude", text: "Stale." });
			const fresh = createEvent({ agent: "codex", text: "Fresh." });
			enqueue(db, stale);
			enqueue(db, fresh);
			db.query(
				"UPDATE jobs SET status='processing', last_attempt_at=? WHERE id=?",
			).run("2026-06-12T00:00:00.000Z", stale.id);
			db.query(
				"UPDATE jobs SET status='processing', last_attempt_at=? WHERE id=?",
			).run("2026-06-12T00:04:30.000Z", fresh.id);

			const recovered = recoverStale(
				db,
				defaultConfig,
				new Date("2026-06-12T00:05:00.000Z"),
			);
			expect(recovered).toEqual([stale.id]);
			expect(countByStatus(db).processing).toBe(1);
			expect(countByStatus(db).pending).toBe(1);
		} finally {
			db.close();
		}
	});
});

import {
	markSpoken,
	markDone,
	requeueForRetry,
	markFailed,
} from "../src/store";

describe("store: terminal transitions", () => {
	test("markSpoken then markDone records summary + finishes", () => {
		const db = openDb(":memory:");
		try {
			const event = createEvent({ agent: "claude", text: "Do it." });
			enqueue(db, event);
			claimNextDue(db, defaultConfig, new Date());
			markSpoken(
				db,
				event.id,
				"All done.",
				"codex-fast",
				new Date("2026-06-12T00:00:03.000Z"),
			);
			markDone(db, event.id, new Date("2026-06-12T00:00:05.000Z"));

			const row = db
				.query(
					"SELECT status, summary, summarizer_used, spoken_at, finished_at FROM jobs WHERE id=?",
				)
				.get(event.id) as {
				status: string;
				summary: string;
				summarizer_used: string;
				spoken_at: string;
				finished_at: string;
			};
			expect(row.status).toBe("done");
			expect(row.summary).toBe("All done.");
			expect(row.summarizer_used).toBe("codex-fast");
			expect(row.spoken_at).toBe("2026-06-12T00:00:03.000Z");
			expect(row.finished_at).toBe("2026-06-12T00:00:05.000Z");
		} finally {
			db.close();
		}
	});

	test("requeueForRetry returns the job to pending with backoff", () => {
		const db = openDb(":memory:");
		try {
			const event = createEvent({ agent: "pi", text: "Flaky." });
			enqueue(db, event);
			claimNextDue(db, defaultConfig, new Date());
			requeueForRetry(
				db,
				event.id,
				"2026-06-12T00:00:30.000Z",
				"temporary failure",
			);
			const row = db
				.query(
					"SELECT status, next_attempt_at, last_error FROM jobs WHERE id=?",
				)
				.get(event.id) as {
				status: string;
				next_attempt_at: string;
				last_error: string;
			};
			expect(row.status).toBe("pending");
			expect(row.next_attempt_at).toBe("2026-06-12T00:00:30.000Z");
			expect(row.last_error).toBe("temporary failure");
		} finally {
			db.close();
		}
	});

	test("markFailed finishes with error", () => {
		const db = openDb(":memory:");
		try {
			const event = createEvent({ agent: "codex", text: "Nope." });
			enqueue(db, event);
			claimNextDue(db, defaultConfig, new Date());
			markFailed(
				db,
				event.id,
				new Date("2026-06-12T00:00:09.000Z"),
				"still failing",
			);
			const row = db
				.query("SELECT status, last_error, finished_at FROM jobs WHERE id=?")
				.get(event.id) as {
				status: string;
				last_error: string;
				finished_at: string;
			};
			expect(row.status).toBe("failed");
			expect(row.last_error).toBe("still failing");
			expect(row.finished_at).toBe("2026-06-12T00:00:09.000Z");
		} finally {
			db.close();
		}
	});
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneRetention, listHistory } from "../src/store";

describe("store: retention + history", () => {
	test("pruneRetention deletes old terminal rows, keeps recent + in-flight", () => {
		const db = openDb(":memory:");
		try {
			const old = createEvent({ agent: "claude", text: "Old." });
			const recent = createEvent({ agent: "codex", text: "Recent." });
			const live = createEvent({ agent: "pi", text: "Live." });
			enqueue(db, old);
			enqueue(db, recent);
			enqueue(db, live);
			db.query("UPDATE jobs SET status='done', finished_at=? WHERE id=?").run(
				"2026-06-01T00:00:00.000Z",
				old.id,
			);
			db.query("UPDATE jobs SET status='done', finished_at=? WHERE id=?").run(
				"2026-06-15T00:00:00.000Z",
				recent.id,
			);

			const deleted = pruneRetention(
				db,
				7,
				new Date("2026-06-15T12:00:00.000Z"),
			);
			expect(deleted).toBe(1);
			expect(countByStatus(db).done).toBe(1);
			expect(countByStatus(db).pending).toBe(1);
		} finally {
			db.close();
		}
	});

	test("listHistory filters by agent", () => {
		const db = openDb(":memory:");
		try {
			const a = createEvent({ agent: "claude", text: "A." });
			const b = createEvent({ agent: "codex", text: "B." });
			enqueue(db, a);
			enqueue(db, b);
			db.query("UPDATE jobs SET status='done' WHERE id=?").run(a.id);
			db.query("UPDATE jobs SET status='done' WHERE id=?").run(b.id);
			const claudeHistory = listHistory(db, { agent: "claude" });
			expect(claudeHistory.map((j) => j.id)).toEqual([a.id]);
		} finally {
			db.close();
		}
	});

	test("non-degradation: claim time is flat with large history", () => {
		const db = openDb(":memory:");
		try {
			const insert = db.query(
				`INSERT INTO jobs (id, version, agent, event, text, status, attempts, created_at, enqueued_at, finished_at)
         VALUES (?, 1, 'claude', 'turn_end', 'x', 'done', 1, ?, ?, ?)`,
			);
			const txn = db.transaction(() => {
				for (let i = 0; i < 50_000; i++) {
					const ts = `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`;
					insert.run(`hist-${i}`, ts, ts, ts);
				}
			});
			txn();
			const live = createEvent({ agent: "claude", text: "Pick me." });
			enqueue(db, live);

			const start = performance.now();
			const claimed = claimNextDue(
				db,
				defaultConfig,
				new Date("2026-12-01T00:00:00.000Z"),
			);
			const elapsedMs = performance.now() - start;

			expect(claimed?.id).toBe(live.id);
			// Partial index keeps the hot path off the 50k history rows.
			expect(elapsedMs).toBeLessThan(25);
		} finally {
			db.close();
		}
	});

	test("concurrent connections: enqueue while claim, no loss or dup", () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-store-conc-"));
		const dbPath = join(home, "queue.db");
		const writer = openDb(dbPath);
		const reader = openDb(dbPath);
		try {
			const e1 = createEvent({ agent: "claude", text: "One." });
			const e2 = createEvent({ agent: "codex", text: "Two." });
			enqueue(writer, { ...e1, createdAt: "2026-06-12T00:00:01.000Z" });
			const claimed = claimNextDue(
				reader,
				defaultConfig,
				new Date("2026-06-12T00:01:00.000Z"),
			);
			enqueue(writer, { ...e2, createdAt: "2026-06-12T00:00:02.000Z" });
			expect(claimed?.id).toBe(e1.id);
			expect(countByStatus(reader).pending).toBe(1);
			expect(countByStatus(reader).processing).toBe(1);
		} finally {
			writer.close();
			reader.close();
			rmSync(home, { recursive: true, force: true });
		}
	});
});
