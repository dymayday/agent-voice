import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { defaultConfig, type AgentVoiceConfig } from "../src/config";
import { createEvent, type AgentVoiceEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import {
	processNextJob,
	requeueProcessingJob,
	type ProcessorDeps,
} from "../src/processor";
import { summarize } from "../src/summarizers";
import { enqueueEvent, listJobs, writeJob } from "../src/spool";
import type { QueueJob } from "../src/queue";

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

function readJob(path: string): QueueJob {
	return JSON.parse(readFileSync(path, "utf8")) as QueueJob;
}

function deps(overrides: Partial<ProcessorDeps> = {}): ProcessorDeps {
	return {
		summarize: async () => "Agent finished the requested work.",
		speak: async () => undefined,
		...overrides,
	};
}

describe("agent-voice daemon processor", () => {
	test("one incoming job moves to done after summarize and speak", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const rawText = "Raw local text with Bearer sk-secret123.";
			const event = createEvent({ agent: "claude", text: rawText });
			enqueueEvent(paths, event);
			const spoken: string[] = [];

			const result = await processNextJob(
				paths,
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
				new Date("2026-06-12T00:00:00.000Z"),
			);

			expect(result.kind).toBe("processed");
			expect(spoken).toEqual(["af_heart:Claude completed the task."]);
			expect(listJobs(paths, "incoming")).toEqual([]);
			expect(listJobs(paths, "processing")).toEqual([]);
			expect(listJobs(paths, "done")).toHaveLength(1);
			const done = readJob(listJobs(paths, "done")[0]);
			expect(done.text).toBe(rawText);
			expect(done.metadata?.summary).toBe("Claude completed the task.");
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
				enqueueEvent(paths, item.event);

				const result = await processNextJob(paths, item.config, deps());

				expect(result.kind, item.name).toBe("idle");
				expect(listJobs(paths, "incoming")).toEqual([]);
				expect(listJobs(paths, "skipped")).toHaveLength(1);
				expect(
					readJob(listJobs(paths, "skipped")[0]).metadata?.skipReason,
				).toBe(item.reason);
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
			enqueueEvent(paths, event);

			const result = await processNextJob(
				paths,
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
			expect(listJobs(paths, "done")).toHaveLength(1);
			expect(readJob(listJobs(paths, "done")[0]).metadata?.summary).toBe(
				"Implemented the daemon processor.",
			);
		});
	});

	test("TTS failure schedules retry with nextAttemptAt", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			enqueueEvent(paths, createEvent({ agent: "claude", text: "Retry me." }));
			const now = new Date("2026-06-12T00:00:00.000Z");

			const result = await processNextJob(
				paths,
				config(),
				deps({
					speak: async () => {
						throw new Error("speaker busy");
					},
				}),
				now,
			);

			expect(result.kind).toBe("retry_scheduled");
			expect(listJobs(paths, "processing")).toEqual([]);
			expect(listJobs(paths, "incoming")).toHaveLength(1);
			const retry = readJob(listJobs(paths, "incoming")[0]);
			expect(retry.attempts).toBe(1);
			expect(retry.nextAttemptAt).toBe("2026-06-12T00:00:30.000Z");
			expect(retry.metadata?.lastError).toBe("speaker busy");
		});
	});

	test("TTS failure after max attempts moves to failed", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeJob(
				paths,
				"incoming",
				{
					...createEvent({ agent: "claude", text: "Fail me." }),
					attempts: defaultConfig.spool.maxAttempts - 1,
				},
				{ createdAt: "2026-06-12T00:00:00.000Z" },
			);

			const result = await processNextJob(
				paths,
				config(),
				deps({
					speak: async () => {
						throw new Error("speaker still busy");
					},
				}),
				new Date("2026-06-12T00:00:00.000Z"),
			);

			expect(result.kind).toBe("failed");
			expect(listJobs(paths, "failed")).toHaveLength(1);
			expect(readJob(listJobs(paths, "failed")[0]).metadata?.lastError).toBe(
				"speaker still busy",
			);
		});
	});

	test("stale processing jobs recover before processing", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeJob(
				paths,
				"processing",
				{
					...createEvent({ agent: "pi", text: "Recovered job." }),
					attempts: 1,
					lastAttemptAt: "2026-06-12T00:00:00.000Z",
				},
				{ createdAt: "2026-06-12T00:00:00.000Z" },
			);

			const result = await processNextJob(
				paths,
				config({ spool: { processingTimeoutSeconds: 120 } }),
				deps(),
				new Date("2026-06-12T00:05:00.000Z"),
			);

			expect(result.kind).toBe("processed");
			expect(listJobs(paths, "done")).toHaveLength(1);
			expect(readJob(listJobs(paths, "done")[0]).metadata?.recoveredFrom).toBe(
				"stale_processing",
			);
		});
	});

	test("post-speech bookkeeping failure does not schedule duplicate speech", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			enqueueEvent(paths, createEvent({ agent: "claude", text: "Speak once." }));
			let speakCalls = 0;

			const result = await processNextJob(
				paths,
				config(),
				deps({
					summarize: async () => "Claude spoke before bookkeeping failed.",
					speak: async () => {
						speakCalls += 1;
						const processingPath = listJobs(paths, "processing")[0];
						writeFileSync(
							join(paths.spool.done, basename(processingPath)),
							"{}\n",
							"utf8",
						);
					},
				}),
				new Date("2026-06-12T00:00:00.000Z"),
			);

			expect(result.kind).toBe("failed");
			expect(speakCalls).toBe(1);
			expect(listJobs(paths, "incoming")).toEqual([]);
			expect(listJobs(paths, "processing")).toEqual([]);
			expect(listJobs(paths, "failed")).toHaveLength(1);
			expect(readJob(listJobs(paths, "failed")[0]).metadata?.summary).toBe(
				"Claude spoke before bookkeeping failed.",
			);
		});
	});

	test("recovered already-spoken jobs finish without speaking twice", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeJob(
				paths,
				"processing",
				{
					...createEvent({ agent: "claude", text: "Already spoken." }),
					attempts: 1,
					lastAttemptAt: "2026-06-12T00:00:00.000Z",
					metadata: {
						summary: "Claude already spoke this job.",
						spokenAt: "2026-06-12T00:00:01.000Z",
					},
				},
				{ createdAt: "2026-06-12T00:00:00.000Z" },
			);
			let speakCalls = 0;

			const result = await processNextJob(
				paths,
				config({ spool: { processingTimeoutSeconds: 120 } }),
				deps({
					speak: async () => {
						speakCalls += 1;
					},
				}),
				new Date("2026-06-12T00:05:00.000Z"),
			);

			expect(result.kind).toBe("processed");
			expect(speakCalls).toBe(0);
			expect(listJobs(paths, "incoming")).toEqual([]);
			expect(listJobs(paths, "processing")).toEqual([]);
			expect(listJobs(paths, "done")).toHaveLength(1);
			expect(readJob(listJobs(paths, "done")[0]).metadata?.summary).toBe(
				"Claude already spoke this job.",
			);
		});
	});

	test("shutdown requeues current processing job without losing it", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const processingPath = writeJob(
				paths,
				"processing",
				{
					...createEvent({ agent: "opencode", text: "Do not lose me." }),
					attempts: 1,
					lastAttemptAt: "2026-06-12T00:00:00.000Z",
				},
				{ createdAt: "2026-06-12T00:00:00.000Z" },
			);

			const incomingPath = requeueProcessingJob(
				paths,
				processingPath,
				"shutdown",
			);

			expect(listJobs(paths, "processing")).toEqual([]);
			expect(listJobs(paths, "incoming")).toEqual([incomingPath]);
			expect(readJob(incomingPath).text).toBe("Do not lose me.");
			expect(readJob(incomingPath).metadata?.requeuedReason).toBe("shutdown");
		});
	});
});
