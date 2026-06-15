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
