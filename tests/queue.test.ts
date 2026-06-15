import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { defaultConfig, type AgentVoiceConfig } from "../src/config";
import { createEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import { enqueueEvent, listJobs, writeJob } from "../src/spool";
import {
	claimNextDueJob,
	dedupeSeenEvent,
	isDue,
	markAttempt,
	recoverStaleProcessing,
	scheduleRetry,
	shouldSkipJob,
	type QueueJob,
} from "../src/queue";

async function withTempHome<T>(
	fn: (home: string) => T | Promise<T>,
): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-queue-test-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

type ConfigOverrides = Partial<Omit<AgentVoiceConfig, "agents" | "spool" | "summarizer" | "tts">> & {
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

describe("agent-voice queue policy", () => {
	test("queue annotations use spool atomic replacement instead of direct truncate writes", () => {
		const source = readFileSync(join(import.meta.dir, "../src/queue.ts"), "utf8");

		expect(source).not.toContain("writeFileSync");
		expect(source).toContain("replaceJob");
	});

	test("oldest due incoming job is selected first", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const newer = createEvent({ agent: "claude", text: "Second." });
			const older = createEvent({ agent: "codex", text: "First." });
			writeJob(paths, "incoming", newer, {
				createdAt: "2026-06-12T00:00:02.000Z",
			});
			const olderPath = writeJob(paths, "incoming", older, {
				createdAt: "2026-06-12T00:00:01.000Z",
			});

			const claimed = claimNextDueJob(
				paths,
				config(),
				new Date("2026-06-12T00:01:00.000Z"),
			);

			expect(claimed?.event.id).toBe(older.id);
			expect(claimed?.processingPath).toBe(
				join(paths.spool.processing, basename(olderPath)),
			);
			expect(readJob(claimed!.processingPath).attempts).toBe(1);
			expect(listJobs(paths, "incoming")).toHaveLength(1);
		});
	});

	test("future nextAttemptAt incoming job is skipped until due", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const due = createEvent({ agent: "pi", text: "Due now." });
			const future = {
				...createEvent({ agent: "claude", text: "Later." }),
				nextAttemptAt: "2026-06-12T00:02:00.000Z",
			} satisfies QueueJob;
			writeJob(paths, "incoming", future, {
				createdAt: "2026-06-12T00:00:01.000Z",
			});
			writeJob(paths, "incoming", due, {
				createdAt: "2026-06-12T00:00:02.000Z",
			});

			const claimed = claimNextDueJob(
				paths,
				config(),
				new Date("2026-06-12T00:01:00.000Z"),
			);

			expect(claimed?.event.id).toBe(due.id);
			expect(listJobs(paths, "incoming")).toHaveLength(1);
			expect(readJob(listJobs(paths, "incoming")[0]).id).toBe(future.id);
			expect(isDue(future, new Date("2026-06-12T00:01:59.999Z"))).toBe(false);
			expect(isDue(future, new Date("2026-06-12T00:02:00.000Z"))).toBe(true);
		});
	});

	test("attempts increment when a job moves to processing", () => {
		const now = new Date("2026-06-12T00:00:00.000Z");
		const event = createEvent({ agent: "opencode", text: "Try." });

		const first = markAttempt(event, now);
		const second = markAttempt(first, new Date("2026-06-12T00:01:00.000Z"));

		expect(first.attempts).toBe(1);
		expect(first.lastAttemptAt).toBe(now.toISOString());
		expect(first.nextAttemptAt).toBeUndefined();
		expect(second.attempts).toBe(2);
	});

	test("retry backoff uses attempts, retryBackoffSeconds, and processing timeout cap", () => {
		const now = new Date("2026-06-12T00:00:00.000Z");
		const base = markAttempt(createEvent({ agent: "claude", text: "Retry." }), now);

		const retry = scheduleRetry(
			base,
			config({ spool: { ...defaultConfig.spool, retryBackoffSeconds: 30 } }),
			now,
			"temporary audio failure",
		);
		const capped = scheduleRetry(
			{ ...base, attempts: 10 },
			config({
				spool: {
					...defaultConfig.spool,
					retryBackoffSeconds: 30,
					processingTimeoutSeconds: 120,
					maxAttempts: 20,
				},
			}),
			now,
			"slow subprocess",
		);

		expect(retry.state).toBe("incoming");
		expect(retry.job.nextAttemptAt).toBe("2026-06-12T00:00:30.000Z");
		expect(retry.job.metadata?.lastError).toBe("temporary audio failure");
		expect(capped.job.nextAttemptAt).toBe("2026-06-12T00:02:00.000Z");
	});

	test("max attempts turns a retryable failure into failed", () => {
		const now = new Date("2026-06-12T00:00:00.000Z");
		const job = {
			...createEvent({ agent: "codex", text: "Too many." }),
			attempts: defaultConfig.spool.maxAttempts,
		} satisfies QueueJob;

		const result = scheduleRetry(job, config(), now, "still failing");

		expect(result.state).toBe("failed");
		expect(result.job.nextAttemptAt).toBeUndefined();
		expect(result.job.metadata?.lastError).toBe("still failing");
	});

	test("disabled system, disabled agent, and ignored cwd move jobs to skipped", async () => {
		const disabledSystem = shouldSkipJob(
			createEvent({ agent: "claude", text: "Skip." }),
			config({ enabled: false }),
		);
		const disabledAgent = shouldSkipJob(
			createEvent({ agent: "pi", text: "Skip." }),
			config({ agents: { pi: { enabled: false, mode: "native" } } }),
		);
		const ignoredCwd = shouldSkipJob(
			createEvent({
				agent: "opencode",
				text: "Skip.",
				cwd: "/Users/meidhy/private/project",
			}),
			config({ ignoreCwdPatterns: ["/Users/meidhy/private/**"] }),
		);

		expect(disabledSystem).toEqual({ skip: true, reason: "disabled_system" });
		expect(disabledAgent).toEqual({ skip: true, reason: "disabled_agent" });
		expect(ignoredCwd).toEqual({ skip: true, reason: "ignored_cwd" });

		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "claude", text: "Queued." });
			enqueueEvent(paths, event);

			const claimed = claimNextDueJob(
				paths,
				config({ enabled: false }),
				new Date("2026-06-12T00:00:00.000Z"),
			);

			expect(claimed).toBeNull();
			expect(listJobs(paths, "incoming")).toEqual([]);
			expect(listJobs(paths, "skipped")).toHaveLength(1);
			expect(readJob(listJobs(paths, "skipped")[0]).metadata?.skipReason).toBe(
				"disabled_system",
			);
		});
	});

	test("stale processing jobs move back to incoming on startup", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const stale = {
				...createEvent({ agent: "claude", text: "Old processing." }),
				lastAttemptAt: "2026-06-12T00:00:00.000Z",
				attempts: 1,
			} satisfies QueueJob;
			const fresh = {
				...createEvent({ agent: "codex", text: "Fresh processing." }),
				lastAttemptAt: "2026-06-12T00:04:30.000Z",
				attempts: 1,
			} satisfies QueueJob;
			writeJob(paths, "processing", stale, {
				createdAt: "2026-06-12T00:00:00.000Z",
			});
			writeJob(paths, "processing", fresh, {
				createdAt: "2026-06-12T00:04:30.000Z",
			});

			const recovered = recoverStaleProcessing(
				paths,
				config({ spool: { ...defaultConfig.spool, processingTimeoutSeconds: 120 } }),
				new Date("2026-06-12T00:05:00.000Z"),
			);

			expect(recovered).toHaveLength(1);
			expect(readJob(recovered[0]).id).toBe(stale.id);
			expect(listJobs(paths, "processing")).toHaveLength(1);
			expect(readJob(listJobs(paths, "processing")[0]).id).toBe(fresh.id);
		});
	});

	test("duplicate event id is not processed twice", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "claude", text: "Once." });
			const firstDone = writeJob(paths, "done", event, {
				createdAt: "2026-06-12T00:00:00.000Z",
			});
			const duplicateIncoming = enqueueEvent(paths, {
				...event,
				text: "Duplicate raw payload.",
			});

			expect(dedupeSeenEvent(paths, event.id)).toEqual({ seen: true, path: firstDone });

			const claimed = claimNextDueJob(
				paths,
				config(),
				new Date("2026-06-12T00:01:00.000Z"),
			);

			expect(claimed).toBeNull();
			expect(existsSync(duplicateIncoming)).toBe(false);
			expect(listJobs(paths, "skipped")).toHaveLength(1);
			expect(readJob(listJobs(paths, "skipped")[0]).metadata?.skipReason).toBe(
				"duplicate_event",
			);
		});
	});
});
