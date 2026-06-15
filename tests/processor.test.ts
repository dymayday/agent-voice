import { describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { defaultConfig } from "../src/config";
import { createEvent } from "../src/events";
import { enqueue, countByStatus } from "../src/store";
import { processNextJob, type ProcessorDeps } from "../src/processor";

function deps(over: Partial<ProcessorDeps> = {}): ProcessorDeps {
	return {
		summarize: async () => "Spoken summary.",
		speak: async () => {},
		...over,
	};
}

describe("processNextJob", () => {
	test("happy path: summarize, speak, mark done", async () => {
		const db = openDb(":memory:");
		try {
			enqueue(db, createEvent({ agent: "claude", text: "Work." }));
			const result = await processNextJob(db, defaultConfig, deps(), new Date());
			expect(result.kind).toBe("processed");
			expect(countByStatus(db).done).toBe(1);
		} finally {
			db.close();
		}
	});

	test("speak failure schedules a retry", async () => {
		const db = openDb(":memory:");
		try {
			enqueue(db, createEvent({ agent: "pi", text: "Flaky." }));
			const result = await processNextJob(
				db,
				defaultConfig,
				deps({ speak: async () => { throw new Error("audio device busy"); } }),
				new Date(),
			);
			expect(result.kind).toBe("retry_scheduled");
			expect(countByStatus(db).pending).toBe(1);
		} finally {
			db.close();
		}
	});

	test("idle when queue empty", async () => {
		const db = openDb(":memory:");
		try {
			const result = await processNextJob(db, defaultConfig, deps(), new Date());
			expect(result.kind).toBe("idle");
		} finally {
			db.close();
		}
	});
});
