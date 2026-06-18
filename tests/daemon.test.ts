import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	defaultConfig,
	saveConfig,
	type AgentVoiceConfig,
} from "../src/config";
import {
	clearStatusSnapshot,
	runDaemonLoop,
	statusSnapshotPath,
	stopDaemon,
	writeDaemonLock,
	writeStatusSnapshotAtomic,
} from "../src/daemon";
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

	test("idle wait does not call waitForWork when a pending row is already due (waitMs===0)", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "claude", text: "Due any moment." });
			const db = openDb(paths.db);
			try {
				enqueue(db, event);
				// next_attempt_at sits BETWEEN the claim clock read and the
				// idle-branch clock read below: future at claim (not claimed -> idle),
				// past by the time msUntilNextDue runs (-> 0 -> waitMs 0).
				db.query(
					"UPDATE jobs SET next_attempt_at='2026-06-12T00:00:05.000Z' WHERE id=?",
				).run(event.id);
			} finally {
				db.close();
			}

			// Stepping clock: the first two reads (loop lastPrune init + the claim
			// inside processNextJob) see 00:00:00 so the 00:00:05 row is not yet due;
			// every later read sees 00:00:10 so msUntilNextDue computes a past due
			// time and returns 0.
			let reads = 0;
			const now = () =>
				new Date(
					reads++ < 2
						? "2026-06-12T00:00:00.000Z"
						: "2026-06-12T00:00:10.000Z",
				);

			const waits: number[] = [];
			await runDaemonLoop(paths, config(), {
				maxIterations: 1,
				pollIntervalMs: 30_000,
				// Keep both prune triggers dormant so the stepping clock only drives
				// the claim-vs-idle boundary, not a prune.
				pruneEveryIterations: 300,
				pruneIntervalMs: Number.POSITIVE_INFINITY,
				now,
				waitForWork: async (ms) => {
					waits.push(ms);
				},
				processorDeps: deps(),
			});

			// waitMs === 0, so waitForWork is never called. If it ever were, it would
			// only be with a strictly positive value.
			expect(waits).toEqual([]);
			expect(waits.every((ms) => ms > 0)).toBe(true);
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

describe("agent-voice daemon status snapshot publishing", () => {
	function readSnapshot(paths: ReturnType<typeof resolvePaths>) {
		return JSON.parse(readFileSync(statusSnapshotPath(paths), "utf8")) as {
			version: number;
			daemon: { state: string; running: boolean; pid: number | null };
			queues: Record<JobStatus, number>;
			config: { enabled: boolean };
			ui: { state: string; attention: string[] };
		};
	}

	test("publishes a running snapshot before the first iteration", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			// maxIterations:0 means the while body never runs — only site (a) fires.
			const loop = await runDaemonLoop(paths, config(), {
				maxIterations: 0,
				pollIntervalMs: 0,
				processorDeps: deps(),
			});

			expect(loop.iterations).toBe(0);
			expect(loop.snapshotWrites).toBe(1);
			expect(existsSync(statusSnapshotPath(paths))).toBe(true);
			const snapshot = readSnapshot(paths);
			expect(snapshot.daemon.running).toBe(true);
			expect(snapshot.daemon.pid).toBe(process.pid);
			expect(snapshot.ui.state).toBe("ready");
		});
	});

	test("republishes queue counts after a job is processed", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const db = openDb(paths.db);
			try {
				enqueue(db, createEvent({ agent: "claude", text: "Job." }));
			} finally {
				db.close();
			}

			const loop = await runDaemonLoop(paths, config(), {
				maxIterations: 1,
				pollIntervalMs: 0,
				processorDeps: deps(),
			});

			expect(loop.processed).toBe(1);
			// Site (a) pending + onClaimed processing + site (b) done = 3 writes.
			expect(loop.snapshotWrites).toBe(3);
			const snapshot = readSnapshot(paths);
			expect(snapshot.queues.done).toBe(1);
			expect(snapshot.queues.pending).toBe(0);
		});
	});

	test("skips identical snapshot writes across idle iterations", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const loop = await runDaemonLoop(paths, config(), {
				maxIterations: 2,
				pollIntervalMs: 0,
				now: () => new Date("2026-06-18T00:00:00.000Z"),
				waitForWork: async () => undefined,
				processorDeps: deps(),
			});

			expect(loop.idle).toBe(2);
			// Site (a) wrote the idle snapshot once; both idle iterations produce a
			// byte-identical snapshot, so site (b) writes nothing more.
			expect(loop.snapshotWrites).toBe(1);
		});
	});

	test("survives status-write failures without crashing or poisoning the cache", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			// Make every snapshot write fail: a directory at the target path makes
			// the temp->final rename throw.
			mkdirSync(statusSnapshotPath(paths), { recursive: true });
			const db = openDb(paths.db);
			try {
				enqueue(db, createEvent({ agent: "claude", text: "Job." }));
			} finally {
				db.close();
			}

			const spoken: string[] = [];
			// Must not throw despite the write failures.
			const loop = await runDaemonLoop(paths, config(), {
				maxIterations: 1,
				pollIntervalMs: 0,
				processorDeps: deps({
					speak: async (summary) => {
						spoken.push(summary);
					},
				}),
			});

			// The job still processed (a cosmetic write failure must not stop work),
			// and no write was counted as successful (cache only commits on success).
			expect(loop.processed).toBe(1);
			expect(spoken.length).toBe(1);
			expect(loop.snapshotWrites).toBe(0);
		});
	});

	test("publishes the in-flight processing state while a job runs", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const db = openDb(paths.db);
			try {
				enqueue(db, createEvent({ agent: "claude", text: "Job." }));
			} finally {
				db.close();
			}

			const processingSeen: number[] = [];
			await runDaemonLoop(paths, config(), {
				maxIterations: 1,
				pollIntervalMs: 0,
				processorDeps: deps({
					summarize: async () => {
						// onClaimed publishes before summarize runs, so the on-disk
						// snapshot should already show the claimed job as processing.
						processingSeen.push(readSnapshot(paths).queues.processing);
						return "Summary.";
					},
				}),
			});

			expect(processingSeen).toEqual([1]);
			expect(readSnapshot(paths).queues.done).toBe(1);
		});
	});

	test("republishes config changes picked up mid-loop", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			saveConfig(paths, config({ enabled: true }));
			const first = createEvent({ agent: "claude", text: "First." });
			const second = createEvent({ agent: "claude", text: "Second." });
			const db = openDb(paths.db);
			try {
				enqueue(db, first);
				enqueue(db, second);
			} finally {
				db.close();
			}

			const loop = await runDaemonLoop(paths, config({ enabled: true }), {
				maxIterations: 2,
				pollIntervalMs: 0,
				processorDeps: deps({
					summarize: async (event) => {
						if (event.id === first.id) {
							saveConfig(paths, config({ enabled: false }));
						}
						return "Summary.";
					},
				}),
			});

			const snapshot = readSnapshot(paths);
			expect(snapshot.config.enabled).toBe(false);
			expect(snapshot.ui.attention).toContain("system_paused");
			// site (a) + at least one content-changing republish.
			expect(loop.snapshotWrites).toBeGreaterThanOrEqual(2);
		});
	});

	test("stopDaemon clears the published snapshot", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeDaemonLock(paths, 4242);
			writeStatusSnapshotAtomic(paths, "{}\n");
			expect(existsSync(statusSnapshotPath(paths))).toBe(true);

			await stopDaemon(paths, {
				isPidAlive: () => true,
				killProcess: () => undefined,
			});

			expect(existsSync(statusSnapshotPath(paths))).toBe(false);
		});
	});

	test("sweeps orphaned snapshot temp files on start", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			mkdirSync(paths.run, { recursive: true });
			const orphan = `${statusSnapshotPath(paths)}.99999.tmp`;
			writeFileSync(orphan, "stale", "utf8");

			await runDaemonLoop(paths, config(), {
				maxIterations: 0,
				pollIntervalMs: 0,
				processorDeps: deps(),
			});

			expect(existsSync(orphan)).toBe(false);
		});
	});
});
