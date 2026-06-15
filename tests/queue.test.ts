import { describe, expect, test } from "bun:test";
import { defaultConfig, type AgentVoiceConfig } from "../src/config";
import { createEvent } from "../src/events";
import {
	isDue,
	markAttempt,
	scheduleRetry,
	shouldSkipJob,
	type QueueJob,
} from "../src/queue";

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

describe("agent-voice queue policy", () => {
	test("isDue respects nextAttemptAt", () => {
		const future = {
			...createEvent({ agent: "claude", text: "Later." }),
			nextAttemptAt: "2026-06-12T00:02:00.000Z",
		} satisfies QueueJob;
		expect(isDue(future, new Date("2026-06-12T00:01:59.999Z"))).toBe(false);
		expect(isDue(future, new Date("2026-06-12T00:02:00.000Z"))).toBe(true);
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
		const base = markAttempt(
			createEvent({ agent: "claude", text: "Retry." }),
			now,
		);

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

	test("disabled system, disabled agent, and ignored cwd move jobs to skipped", () => {
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
	});
});
