import { describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { createEvent } from "../src/events";
import { enqueue, countByStatus } from "../src/store";

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
			expect(enqueue(db, { ...event, text: "Different payload." }).inserted).toBe(false);
			expect(countByStatus(db).pending).toBe(1);
		} finally {
			db.close();
		}
	});
});

import { claimNextDue, recoverStale } from "../src/store";
import { defaultConfig } from "../src/config";

describe("store: claim + recover", () => {
	test("oldest due pending job is claimed first and moved to processing", () => {
		const db = openDb(":memory:");
		try {
			const older = createEvent({ agent: "codex", text: "First." });
			const newer = createEvent({ agent: "claude", text: "Second." });
			enqueue(db, { ...older, createdAt: "2026-06-12T00:00:01.000Z" });
			enqueue(db, { ...newer, createdAt: "2026-06-12T00:00:02.000Z" });

			const claimed = claimNextDue(db, defaultConfig, new Date("2026-06-12T00:01:00.000Z"));
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
			db.query("UPDATE jobs SET next_attempt_at = '2026-06-12T00:02:00.000Z' WHERE id = ?").run(event.id);
			expect(claimNextDue(db, defaultConfig, new Date("2026-06-12T00:01:00.000Z"))).toBeNull();
			expect(claimNextDue(db, defaultConfig, new Date("2026-06-12T00:02:00.000Z"))?.id).toBe(event.id);
		} finally {
			db.close();
		}
	});

	test("disabled system claims nothing and marks skipped", () => {
		const db = openDb(":memory:");
		try {
			enqueue(db, createEvent({ agent: "claude", text: "Queued." }));
			const claimed = claimNextDue(db, { ...defaultConfig, enabled: false }, new Date());
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
			db.query("UPDATE jobs SET status='processing', last_attempt_at=? WHERE id=?")
				.run("2026-06-12T00:00:00.000Z", stale.id);
			db.query("UPDATE jobs SET status='processing', last_attempt_at=? WHERE id=?")
				.run("2026-06-12T00:04:30.000Z", fresh.id);

			const recovered = recoverStale(db, defaultConfig, new Date("2026-06-12T00:05:00.000Z"));
			expect(recovered).toEqual([stale.id]);
			expect(countByStatus(db).processing).toBe(1);
			expect(countByStatus(db).pending).toBe(1);
		} finally {
			db.close();
		}
	});
});
