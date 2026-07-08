import { describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { createEvent } from "../src/events";
import {
	countByStatus,
	countsForSnapshot,
	enqueue,
	getDoneTotal,
	markDone,
	pruneRetention,
} from "../src/store";

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

			// Continuity across upgrade: the total reflects existing completions.
			expect(getDoneTotal(db)).toBe(3);
		} finally {
			db.close();
		}
	});
});
