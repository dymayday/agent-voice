import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	defaultConfig,
	saveConfig,
	type AgentVoiceConfig,
} from "../src/config";
import { runDaemonLoop } from "../src/daemon";
import { openDb } from "../src/db";
import { createEvent, type AgentVoiceEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import { processNextJob, type ProcessorDeps } from "../src/processor";
import {
	countByStatus,
	enqueue,
	recoverStale,
	type JobStatus,
} from "../src/store";
import { summarize } from "../src/summarizers";

async function withTempHome<T>(
	fn: (home: string) => T | Promise<T>,
): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-daemon-test-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

type ConfigOverrides = Partial<
	Omit<AgentVoiceConfig, "agents" | "spool" | "summarizer" | "tts">
> & {
	agents?: Partial<AgentVoiceConfig["agents"]>;
	spool?: Partial<AgentVoiceConfig["spool"]>;
	summarizer?: Partial<AgentVoiceConfig["summarizer"]>;
	tts?: Partial<AgentVoiceConfig["tts"]>;
};

function config(overrides: ConfigOverrides = {}): AgentVoiceConfig {
	return {
		...defaultConfig,
		...overrides,
		agents: { ...defaultConfig.agents, ...overrides.agents },
		spool: { ...defaultConfig.spool, ...overrides.spool },
		summarizer: { ...defaultConfig.summarizer, ...overrides.summarizer },
		tts: { ...defaultConfig.tts, ...overrides.tts },
	};
}

interface JobRecord {
	status: string;
	summary: string | null;
	summarizer_used: string | null;
	skip_reason: string | null;
	last_error: string | null;
	attempts: number;
	next_attempt_at: string | null;
}

function readJob(db: ReturnType<typeof openDb>, id: string): JobRecord {
	return db
		.query(
			"SELECT status, summary, summarizer_used, skip_reason, last_error, attempts, next_attempt_at FROM jobs WHERE id=?",
		)
		.get(id) as JobRecord;
}

function deps(overrides: Partial<ProcessorDeps> = {}): ProcessorDeps {
	return {
		summarize: async () => "Agent finished the requested work.",
		speak: async () => undefined,
		...overrides,
	};
}

function counts(db: ReturnType<typeof openDb>): Record<JobStatus, number> {
	return countByStatus(db);
}

describe("agent-voice daemon processor", () => {
	test("one pending job moves to done after summarize and speak", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const rawText = "Raw local text with Bearer sk-secret123.";
			const event = createEvent({ agent: "claude", text: rawText });
			const db = openDb(paths.db);
			try {
				enqueue(db, event);
				const spoken: string[] = [];

				const result = await processNextJob(
					db,
					config(),
					deps({
						summarize: async (input) => {
							expect(input.text).toBe(rawText);
							return "Claude completed the task.";
						},
						speak: async (summary, voice) => {
							spoken.push(`${voice}:${summary}`);
						},
					}),
					() => new Date("2026-06-12T00:00:00.000Z"),
				);

				expect(result.kind).toBe("processed");
				expect(spoken).toEqual(["af_heart:Claude completed the task."]);
				expect(counts(db).pending).toBe(0);
				expect(counts(db).processing).toBe(0);
				expect(counts(db).done).toBe(1);
				const done = readJob(db, event.id);
				expect(done.summary).toBe("Claude completed the task.");
			} finally {
				db.close();
			}
		});
	});

	test("running daemon reloads config before each job", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const first = createEvent({ agent: "claude", text: "First job." });
			const second = createEvent({ agent: "claude", text: "Second job." });
			const initialConfig = config({ enabled: true });
			saveConfig(paths, initialConfig);
			const db = openDb(paths.db);
			try {
				enqueue(db, first);
				enqueue(db, second);
			} finally {
				db.close();
			}

			const spoken: string[] = [];
			await runDaemonLoop(paths, initialConfig, {
				maxIterations: 2,
				pollIntervalMs: 0,
				processorDeps: deps({
					summarize: async (event) => {
						if (event.id === first.id) {
							saveConfig(paths, config({ enabled: false }));
						}
						return `Summary for ${event.id}`;
					},
					speak: async (summary) => {
						spoken.push(summary);
					},
				}),
			});

			const check = openDb(paths.db);
			try {
				expect(readJob(check, first.id).status).toBe("done");
				expect(readJob(check, second.id).status).toBe("skipped");
				expect(readJob(check, second.id).skip_reason).toBe("disabled_system");
				expect(spoken).toEqual([`Summary for ${first.id}`]);
			} finally {
				check.close();
			}
		});
	});

	test("running daemon keeps the last valid config when a reload is temporarily invalid", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const first = createEvent({ agent: "claude", text: "First job." });
			const second = createEvent({ agent: "claude", text: "Second job." });
			const initialConfig = config({ enabled: true });
			saveConfig(paths, initialConfig);
			const db = openDb(paths.db);
			try {
				enqueue(db, first);
				enqueue(db, second);
			} finally {
				db.close();
			}

			const spoken: string[] = [];
			await runDaemonLoop(paths, initialConfig, {
				maxIterations: 2,
				pollIntervalMs: 0,
				processorDeps: deps({
					summarize: async (event) => {
						if (event.id === first.id) {
							writeFileSync(paths.config, "{ invalid json", "utf8");
						}
						return `Summary for ${event.id}`;
					},
					speak: async (summary) => {
						spoken.push(summary);
					},
				}),
			});

			const check = openDb(paths.db);
			try {
				expect(readJob(check, first.id).status).toBe("done");
				expect(readJob(check, second.id).status).toBe("done");
				expect(spoken).toEqual([
					`Summary for ${first.id}`,
					`Summary for ${second.id}`,
				]);
			} finally {
				check.close();
			}
		});
	});

	test("disabled system, disabled agent, and ignored cwd move due jobs to skipped", async () => {
		const cases: Array<{
			name: string;
			event: AgentVoiceEvent;
			config: AgentVoiceConfig;
			reason: string;
		}> = [
			{
				name: "disabled system",
				event: createEvent({ agent: "claude", text: "Skip." }),
				config: config({ enabled: false }),
				reason: "disabled_system",
			},
			{
				name: "disabled agent",
				event: createEvent({ agent: "pi", text: "Skip." }),
				config: config({ agents: { pi: { enabled: false, mode: "native" } } }),
				reason: "disabled_agent",
			},
			{
				name: "ignored cwd",
				event: createEvent({
					agent: "opencode",
					text: "Skip.",
					cwd: "/Users/meidhy/private/project",
				}),
				config: config({ ignoreCwdPatterns: ["/Users/meidhy/private/**"] }),
				reason: "ignored_cwd",
			},
		];

		for (const item of cases) {
			await withTempHome(async (home) => {
				const paths = resolvePaths({ AGENT_VOICE_HOME: home });
				const db = openDb(paths.db);
				try {
					enqueue(db, item.event);

					const result = await processNextJob(db, item.config, deps());

					expect(result.kind, item.name).toBe("idle");
					expect(counts(db).pending).toBe(0);
					expect(counts(db).skipped).toBe(1);
					expect(readJob(db, item.event.id).skip_reason).toBe(item.reason);
				} finally {
					db.close();
				}
			});
		}
	});

	test("summarizer external failures plus heuristic success moves to done", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({
				agent: "codex",
				text: "Implemented the daemon processor. Added tests.",
			});
			const db = openDb(paths.db);
			try {
				enqueue(db, event);

				const result = await processNextJob(
					db,
					config({ summarizer: { priority: ["codex-fast", "heuristic"] } }),
					deps({
						summarize: (input, cfg) =>
							summarize(input, cfg, async () => ({
								ok: false,
								exitCode: 1,
								stderr: "model unavailable",
							})),
					}),
				);

				expect(result.kind).toBe("processed");
				expect(counts(db).done).toBe(1);
				expect(readJob(db, event.id).summary).toBe(
					"Implemented the daemon processor.",
				);
			} finally {
				db.close();
			}
		});
	});

	test("TTS failure is terminal and does not schedule a retry", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "claude", text: "Retry me." });
			const db = openDb(paths.db);
			try {
				enqueue(db, event);

				const result = await processNextJob(
					db,
					config(),
					deps({
						speak: async () => {
							throw new Error("speaker busy");
						},
					}),
					() => new Date("2026-06-12T00:00:00.000Z"),
				);

				expect(result.kind).toBe("failed");
				expect(counts(db).processing).toBe(0);
				expect(counts(db).pending).toBe(0);
				expect(counts(db).failed).toBe(1);
				const failed = readJob(db, event.id);
				expect(failed.attempts).toBe(1);
				expect(failed.next_attempt_at).toBeNull();
				expect(failed.last_error).toContain("speak failed:");
				expect(failed.last_error).toContain("speaker busy");
			} finally {
				db.close();
			}
		});
	});

	test("summarizer failure after max attempts moves to failed", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "claude", text: "Fail me." });
			const db = openDb(paths.db);
			try {
				enqueue(db, {
					...event,
					createdAt: "2026-06-12T00:00:00.000Z",
				});
				// Drive attempts up to the last allowed attempt so the next failure fails.
				db.query("UPDATE jobs SET attempts=? WHERE id=?").run(
					defaultConfig.spool.maxAttempts - 1,
					event.id,
				);

				const result = await processNextJob(
					db,
					config(),
					deps({
						summarize: async () => {
							throw new Error("summarizer still down");
						},
					}),
					() => new Date("2026-06-12T00:00:00.000Z"),
				);

				expect(result.kind).toBe("failed");
				expect(counts(db).failed).toBe(1);
				expect(readJob(db, event.id).last_error).toBe("summarizer still down");
			} finally {
				db.close();
			}
		});
	});

	test("summarizer failure below max attempts schedules retry with nextAttemptAt", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "claude", text: "Retry me." });
			const db = openDb(paths.db);
			try {
				enqueue(db, event);

				const result = await processNextJob(
					db,
					config(),
					deps({
						summarize: async () => {
							throw new Error("summarizer busy");
						},
					}),
					() => new Date("2026-06-12T00:00:00.000Z"),
				);

				expect(result.kind).toBe("retry_scheduled");
				expect(counts(db).processing).toBe(0);
				expect(counts(db).pending).toBe(1);
				const retry = readJob(db, event.id);
				expect(retry.attempts).toBe(1);
				expect(retry.next_attempt_at).toBe("2026-06-12T00:00:30.000Z");
				expect(retry.last_error).toBe("summarizer busy");
			} finally {
				db.close();
			}
		});
	});

	test("stale processing jobs recover before processing", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "pi", text: "Recovered job." });
			const db = openDb(paths.db);
			try {
				enqueue(db, { ...event, createdAt: "2026-06-12T00:00:00.000Z" });
				db.query(
					"UPDATE jobs SET status='processing', attempts=1, last_attempt_at=? WHERE id=?",
				).run("2026-06-12T00:00:00.000Z", event.id);

				const result = await processNextJob(
					db,
					config({ spool: { processingTimeoutSeconds: 120 } }),
					deps(),
					() => new Date("2026-06-12T00:05:00.000Z"),
				);

				expect(result.kind).toBe("processed");
				expect(counts(db).done).toBe(1);
			} finally {
				db.close();
			}
		});
	});

	test("recovered already-spoken jobs finish without speaking twice", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "claude", text: "Already spoken." });
			const db = openDb(paths.db);
			try {
				enqueue(db, { ...event, createdAt: "2026-06-12T00:00:00.000Z" });
				// Simulate a crash after speech was explicitly marked complete but
				// before the terminal done transition was written.
				db.query(
					"UPDATE jobs SET status='processing', attempts=1, last_attempt_at=?, summary=?, spoken_at=? WHERE id=?",
				).run(
					"2026-06-12T00:00:00.000Z",
					"Claude already spoke this job.",
					"2026-06-12T00:00:10.000Z",
					event.id,
				);
				let speakCalls = 0;

				const result = await processNextJob(
					db,
					config({ spool: { processingTimeoutSeconds: 120 } }),
					deps({
						speak: async () => {
							speakCalls += 1;
						},
					}),
					() => new Date("2026-06-12T00:05:00.000Z"),
				);

				expect(result.kind).toBe("processed");
				expect(speakCalls).toBe(0);
				expect(counts(db).pending).toBe(0);
				expect(counts(db).processing).toBe(0);
				expect(counts(db).done).toBe(1);
				expect(readJob(db, event.id).summary).toBe(
					"Claude already spoke this job.",
				);
			} finally {
				db.close();
			}
		});
	});

	test("recoverStale returns stale processing jobs to pending", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "opencode", text: "Do not lose me." });
			const db = openDb(paths.db);
			try {
				enqueue(db, { ...event, createdAt: "2026-06-12T00:00:00.000Z" });
				db.query(
					"UPDATE jobs SET status='processing', attempts=1, last_attempt_at=? WHERE id=?",
				).run("2026-06-12T00:00:00.000Z", event.id);

				const recovered = recoverStale(
					db,
					config(),
					new Date("2026-06-12T00:05:00.000Z"),
				);

				expect(recovered).toEqual([event.id]);
				expect(counts(db).processing).toBe(0);
				expect(counts(db).pending).toBe(1);
			} finally {
				db.close();
			}
		});
	});
});

describe("agent-voice daemon idle wait", () => {
	test("idle wait uses min(safetyNet, msUntilNextDue) for a seeded future retry", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "claude", text: "Retry later." });
			const db = openDb(paths.db);
			try {
				enqueue(db, event);
				// Schedule the retry 10s after the fixed clock; safety-net is 30s,
				// so min(30_000, 10_000) = 10_000.
				db.query(
					"UPDATE jobs SET next_attempt_at='2026-06-12T00:00:10.000Z' WHERE id=?",
				).run(event.id);
			} finally {
				db.close();
			}

			const waits: number[] = [];
			await runDaemonLoop(paths, config(), {
				maxIterations: 1,
				pollIntervalMs: 30_000, // safety-net cap
				now: () => new Date("2026-06-12T00:00:00.000Z"),
				waitForWork: async (ms) => {
					waits.push(ms);
				},
				processorDeps: deps(),
			});

			expect(waits).toEqual([10_000]);
		});
	});

	test("idle wait falls back to the safety-net cap when nothing is pending", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const waits: number[] = [];
			await runDaemonLoop(paths, config(), {
				maxIterations: 1,
				pollIntervalMs: 30_000,
				now: () => new Date("2026-06-12T00:00:00.000Z"),
				waitForWork: async (ms) => {
					waits.push(ms);
				},
				processorDeps: deps(),
			});
			// No pending rows -> msUntilNextDue null -> wait the full safety net.
			expect(waits).toEqual([30_000]);
		});
	});

	test("idle wait caps a far-future retry at the safety-net cap", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "pi", text: "Much later." });
			const db = openDb(paths.db);
			try {
				enqueue(db, event);
				db.query(
					"UPDATE jobs SET next_attempt_at='2026-06-12T01:00:00.000Z' WHERE id=?",
				).run(event.id);
			} finally {
				db.close();
			}
			const waits: number[] = [];
			await runDaemonLoop(paths, config(), {
				maxIterations: 1,
				pollIntervalMs: 30_000,
				now: () => new Date("2026-06-12T00:00:00.000Z"),
				waitForWork: async (ms) => {
					waits.push(ms);
				},
				processorDeps: deps(),
			});
			// 1h out, capped to the 30s safety net.
			expect(waits).toEqual([30_000]);
		});
	});
});

describe("agent-voice daemon wall-clock pruning", () => {
	test("prunes on elapsed pruneIntervalMs even without the iteration trigger", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const seed = openDb(paths.db);
			try {
				// An old terminal row that retention pruning should delete.
				const old = createEvent({ agent: "claude", text: "Old done." });
				enqueue(seed, old);
				seed
					.query(
						"UPDATE jobs SET status='done', finished_at='2026-05-01T00:00:00.000Z' WHERE id=?",
					)
					.run(old.id);
			} finally {
				seed.close();
			}

			// pruneIntervalMs: 0 makes the wall-clock branch (now - lastPrune >= 0)
			// fire on the first iteration with a fixed clock. The iteration trigger
			// (pruneEveryIterations: 300) can never fire at maxIterations: 1, so a
			// prune here proves the wall-clock path is what ran.
			await runDaemonLoop(paths, config({ spool: { retentionDays: 7 } }), {
				maxIterations: 1,
				pollIntervalMs: 0,
				pruneEveryIterations: 300, // far above maxIterations: never triggers
				pruneIntervalMs: 0, // wall-clock branch fires immediately
				now: () => new Date("2026-06-12T00:00:00.000Z"),
				waitForWork: async () => {},
				processorDeps: deps(),
			});

			const check = openDb(paths.db);
			try {
				// The old done row was pruned by the wall-clock-triggered prune.
				expect(countByStatus(check).done).toBe(0);
			} finally {
				check.close();
			}
		});
	});

	test("iteration-cadence pruning still fires (default trigger preserved)", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const seed = openDb(paths.db);
			try {
				const old = createEvent({ agent: "codex", text: "Old done." });
				enqueue(seed, old);
				seed
					.query(
						"UPDATE jobs SET status='done', finished_at='2026-05-01T00:00:00.000Z' WHERE id=?",
					)
					.run(old.id);
			} finally {
				seed.close();
			}

			// Fixed clock so the wall-clock branch never fires; only the
			// iteration trigger (pruneEveryIterations: 1) can prune.
			await runDaemonLoop(paths, config({ spool: { retentionDays: 7 } }), {
				maxIterations: 1,
				pollIntervalMs: 0,
				pruneEveryIterations: 1,
				pruneIntervalMs: Number.POSITIVE_INFINITY,
				now: () => new Date("2026-06-12T00:00:00.000Z"),
				waitForWork: async () => {},
				processorDeps: deps(),
			});

			const check = openDb(paths.db);
			try {
				expect(countByStatus(check).done).toBe(0);
			} finally {
				check.close();
			}
		});
	});
});
