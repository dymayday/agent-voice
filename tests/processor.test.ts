import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { defaultConfig } from "../src/config";
import { createEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import { enqueue, countByStatus } from "../src/store";
import { processNextJob, type ProcessorDeps } from "../src/processor";

function deps(over: Partial<ProcessorDeps> = {}): ProcessorDeps {
	return {
		summarize: async () => "Spoken summary.",
		speak: async () => {},
		...over,
	};
}

async function withDb<T>(
	fn: (db: ReturnType<typeof openDb>) => Promise<T>,
): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-processor-test-"));
	const db = openDb(resolvePaths({ AGENT_VOICE_HOME: home }).db);
	try {
		return await fn(db);
	} finally {
		db.close();
		rmSync(home, { recursive: true, force: true });
	}
}

function increasingClock(seconds: number[]): () => Date {
	const times = seconds.map((s) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)));
	let index = 0;
	return () => times[Math.min(index++, times.length - 1)];
}

describe("processNextJob", () => {
	test("happy path: summarize, speak, mark done", async () => {
		const db = openDb(":memory:");
		try {
			enqueue(db, createEvent({ agent: "claude", text: "Work." }));
			const result = await processNextJob(
				db,
				defaultConfig,
				deps(),
				() => new Date(),
			);
			expect(result.kind).toBe("processed");
			expect(countByStatus(db).done).toBe(1);
		} finally {
			db.close();
		}
	});

	test("idle when queue empty", async () => {
		const db = openDb(":memory:");
		try {
			const result = await processNextJob(
				db,
				defaultConfig,
				deps(),
				() => new Date(),
			);
			expect(result.kind).toBe("idle");
		} finally {
			db.close();
		}
	});

	test("records a fresh finished_at later than claimed_at", async () => {
		await withDb(async (db) => {
			const event = createEvent({ agent: "pi", text: "Do the thing." });
			enqueue(db, event);
			const processorDeps: ProcessorDeps = {
				summarize: async () => "A summary.",
				speak: async () => {},
			};

			const result = await processNextJob(
				db,
				defaultConfig,
				processorDeps,
				increasingClock([0, 5]),
			);

			expect(result.kind).toBe("processed");
			const row = db
				.query("SELECT claimed_at, finished_at FROM jobs WHERE id=?")
				.get(event.id) as { claimed_at: string; finished_at: string };
			expect(Date.parse(row.finished_at)).toBeGreaterThan(
				Date.parse(row.claimed_at),
			);
		});
	});

	test("treats a TTS failure as terminal without scheduling a retry", async () => {
		await withDb(async (db) => {
			const event = createEvent({ agent: "pi", text: "Speak me." });
			enqueue(db, event);
			const processorDeps: ProcessorDeps = {
				summarize: async () => "A summary.",
				speak: async () => {
					throw new Error("Kokoro exited before ready");
				},
			};

			const result = await processNextJob(db, defaultConfig, processorDeps);

			expect(result.kind).toBe("failed");
			const row = db
				.query(
					"SELECT status, attempts, next_attempt_at, last_error FROM jobs WHERE id=?",
				)
				.get(event.id) as {
				status: string;
				attempts: number;
				next_attempt_at: string | null;
				last_error: string | null;
			};
			expect(row.status).toBe("failed");
			expect(row.attempts).toBe(1);
			expect(row.next_attempt_at).toBeNull();
			expect(row.last_error).toContain("speak failed:");
			expect(row.last_error).toContain("Kokoro exited before ready");
		});
	});

	test("records the summarizer the outcome actually came from", async () => {
		await withDb(async (db) => {
			const event = createEvent({ agent: "claude", text: "Long agent output." });
			enqueue(db, event);
			const processorDeps: ProcessorDeps = {
				summarize: async () => ({
					summary: "Heuristic fallback summary.",
					summarizerUsed: "heuristic",
				}),
				speak: async () => {},
			};

			await processNextJob(db, defaultConfig, processorDeps);

			const row = db
				.query("SELECT summary, summarizer_used FROM jobs WHERE id=?")
				.get(event.id) as { summary: string; summarizer_used: string };
			expect(row.summary).toBe("Heuristic fallback summary.");
			expect(row.summarizer_used).toBe("heuristic");
		});
	});

	test("does not treat an unspoken persisted summary as already spoken", async () => {
		await withDb(async (db) => {
			const event = createEvent({ agent: "claude", text: "Recovered." });
			enqueue(db, event);
			db.query(
				"UPDATE jobs SET status='processing', attempts=1, last_attempt_at=?, summary=?, summarizer_used=? WHERE id=?",
			).run(
				"2026-01-01T00:00:00.000Z",
				"Previously summarized.",
				"heuristic",
				event.id,
			);
			let speakCalls = 0;

			const result = await processNextJob(
				db,
				defaultConfig,
				deps({
					speak: async () => {
						speakCalls += 1;
					},
				}),
				() => new Date("2026-01-01T00:05:00.000Z"),
			);

			expect(result.kind).toBe("processed");
			expect(speakCalls).toBe(1);
		});
	});

	test("still schedules a retry when summarization throws", async () => {
		await withDb(async (db) => {
			const event = createEvent({ agent: "pi", text: "Summarize me." });
			enqueue(db, event);
			const processorDeps: ProcessorDeps = {
				summarize: async () => {
					throw new Error("summarizer offline");
				},
				speak: async () => {},
			};

			const result = await processNextJob(db, defaultConfig, processorDeps);

			expect(result.kind).toBe("retry_scheduled");
			const row = db
				.query("SELECT status, next_attempt_at FROM jobs WHERE id=?")
				.get(event.id) as { status: string; next_attempt_at: string | null };
			expect(row.status).toBe("pending");
			expect(row.next_attempt_at).not.toBeNull();
		});
	});
});
