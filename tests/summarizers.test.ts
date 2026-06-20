import { describe, expect, test } from "bun:test";
import { defaultConfig, type AgentVoiceConfig } from "../src/config";
import { createEvent } from "../src/events";
import {
	buildPrompt,
	heuristicSummary,
	summarize,
	summarizeWithSource,
	type SummarizerRunRequest,
	type SummarizerRunResult,
} from "../src/summarizers";

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

function recordingRunner(
	resultForCall: (
		request: SummarizerRunRequest,
		index: number,
	) => SummarizerRunResult,
): {
	calls: SummarizerRunRequest[];
	runner: (request: SummarizerRunRequest) => Promise<SummarizerRunResult>;
} {
	const calls: SummarizerRunRequest[] = [];
	return {
		calls,
		runner: async (request) => {
			calls.push(request);
			return resultForCall(request, calls.length - 1);
		},
	};
}

describe("agent-voice summarizer fallback chain", () => {
	test("Codex fast uses safe arg array and passes raw text via stdin", async () => {
		const rawText = "Authorization: Bearer sk-secret123; do not interpolate me";
		const event = createEvent({ agent: "claude", text: rawText });
		const { calls, runner } = recordingRunner(() => ({
			ok: true,
			stdout: "Claude finished the auth fix.\n\n",
		}));

		const summary = await summarize(
			event,
			config({ summarizer: { priority: ["codex-fast", "heuristic"] } }),
			runner,
		);

		expect(summary).toBe("Claude finished the auth fix.");
		expect(calls).toHaveLength(1);
		expect(calls[0].cmd).toBe("codex");
		expect(calls[0].args).toEqual([
			"exec",
			"-m",
			"gpt-5.3-codex",
			"-c",
			"service_tier='\"fast\"'",
			"--skip-git-repo-check",
			"--ephemeral",
			"-",
		]);
		expect(calls[0].args.join("\n")).not.toContain(rawText);
		expect(calls[0].stdin).toContain(rawText);
		expect(calls[0].env.AGENT_VOICE_DISABLE).toBe("1");
		expect(calls[0].timeoutMs).toBe(
			defaultConfig.summarizer.timeoutSeconds * 1000,
		);
	});

	test("Pi fast passes the prompt via stdin, never argv", async () => {
		const rawText = "Pi completed the queue task with token sk-secret-xyz.";
		const event = createEvent({ agent: "pi", text: rawText });
		const { calls, runner } = recordingRunner(() => ({
			ok: true,
			stdout: "Pi completed the queue policy.\n",
		}));

		const summary = await summarize(
			event,
			config({
				summarizer: {
					priority: ["pi-fast", "heuristic"],
					piModel: "openai-codex/gpt-5.5",
				},
			}),
			runner,
		);

		expect(summary).toBe("Pi completed the queue policy.");
		expect(calls).toHaveLength(1);
		expect(calls[0].cmd).toBe("pi");
		expect(calls[0].args).toEqual([
			"--model",
			"openai-codex/gpt-5.5",
			"--thinking",
			"off",
			"--no-tools",
			"--no-skills",
			"--no-extensions",
			"--no-context-files",
			"--no-prompt-templates",
			"--no-session",
			"-p",
		]);
		expect(calls[0].args.join("\n")).not.toContain(rawText);
		expect(calls[0].stdin).toContain(rawText);
		expect(calls[0].env.AGENT_VOICE_DISABLE).toBe("1");
	});

	test("heuristic strips embedded terminal escape sequences", () => {
		const noisy = "\x1b[?2026hThe build \x1b[<999upassed.";
		expect(heuristicSummary(noisy)).toBe("The build passed.");
	});

	test("pi stdout escape sequences never leak into the summary", async () => {
		const event = createEvent({ agent: "pi", text: "Pi did the work." });
		const { runner } = recordingRunner(() => ({
			ok: true,
			stdout: "\x1b[?2026hPi finished the task\x1b[<999u",
		}));

		const summary = await summarize(
			event,
			config({ summarizer: { priority: ["pi-fast", "heuristic"] } }),
			runner,
		);

		expect(summary).toBe("Pi finished the task.");
	});

	test("escape stripping is ESC-anchored and leaves bracketed text intact", () => {
		const result = heuristicSummary(
			"The build [important] passed with array[0] index intact.",
		);
		expect(result).toContain("The build");
		expect(result).toContain("[important]");
		expect(result).toContain("array[0]");
	});

	test("heuristic returns only the first sentence when several exist", () => {
		expect(
			heuristicSummary(
				"First sentence is short. Second sentence should be dropped. Third too.",
			),
		).toBe("First sentence is short.");
	});

	test("heuristic returns the entire first sentence, never a 180-char fragment", () => {
		const longSentence =
			"We migrated the entire authentication subsystem to the new token format and verified every downstream consumer including the dashboard, the mobile clients, the daemon, and the background workers without any regressions.";
		const result = heuristicSummary(longSentence);
		expect(longSentence.length).toBeGreaterThan(180);
		expect(result).toBe(longSentence);
		expect(result.length).toBeGreaterThan(180);
	});

	test("heuristic appends a period when the first sentence has no terminator", () => {
		expect(heuristicSummary("Build finished cleanly")).toBe(
			"Build finished cleanly.",
		);
	});

	test("missing executable skips to the next summarizer", async () => {
		const event = createEvent({ agent: "codex", text: "Codex finished." });
		const { calls, runner } = recordingRunner((_request, index) =>
			index === 0
				? { ok: false, code: "ENOENT", stderr: "codex missing" }
				: { ok: true, stdout: "Fallback Pi summary." },
		);

		const summary = await summarize(
			event,
			config({
				summarizer: { priority: ["codex-fast", "pi-fast", "heuristic"] },
			}),
			runner,
		);

		expect(summary).toBe("Fallback Pi summary.");
		expect(calls.map((call) => call.cmd)).toEqual(["codex", "pi"]);
	});

	test("external summarizer output keeps all lines in one sentence", async () => {
		const event = createEvent({ agent: "claude", text: "Claude finished." });
		const { runner } = recordingRunner(() => ({
			ok: true,
			stdout: "Fixed auth flow.\nAdded regression tests!\nUpdated docs?\n",
		}));

		const summary = await summarize(
			event,
			config({ summarizer: { priority: ["codex-fast", "heuristic"] } }),
			runner,
		);

		expect(summary).toBe(
			"Fixed auth flow; Added regression tests; Updated docs.",
		);
		expect(summary).not.toContain("\n");
	});

	test("OpenCode uses prompt argument without interpolating agent text into args", async () => {
		const rawText = "OpenCode produced raw output with `rm -rf /` text.";
		const event = createEvent({ agent: "opencode", text: rawText });
		const { calls, runner } = recordingRunner(() => ({
			ok: true,
			stdout: "OpenCode finished the wrapper work.",
		}));

		const summary = await summarize(
			event,
			config({
				summarizer: {
					priority: ["opencode", "heuristic"],
					opencodeModel: "anthropic/claude-sonnet-4",
				},
			}),
			runner,
		);

		expect(summary).toBe("OpenCode finished the wrapper work.");
		expect(calls).toHaveLength(1);
		expect(calls[0].cmd).toBe("opencode");
		expect(calls[0].args).toEqual([
			"run",
			"--model",
			"anthropic/claude-sonnet-4",
			"--prompt",
			"-",
		]);
		expect(calls[0].args.join("\n")).not.toContain(rawText);
		expect(calls[0].stdin).toContain(rawText);
		expect(calls[0].env.AGENT_VOICE_DISABLE).toBe("1");
	});

	test("all external failures fall back to heuristic", async () => {
		const event = createEvent({
			agent: "claude",
			text: "Implemented the daemon queue processor. Added retry handling and tests.",
		});
		const { calls, runner } = recordingRunner(() => ({
			ok: false,
			exitCode: 1,
			stderr: "model unavailable",
		}));

		const summary = await summarize(
			event,
			config({
				summarizer: {
					priority: ["codex-fast", "pi-fast", "opencode", "heuristic"],
					opencodeModel: "openrouter/test-model",
				},
			}),
			runner,
		);

		expect(calls.map((call) => call.cmd)).toEqual(["codex", "pi", "opencode"]);
		expect(summary).toBe("Implemented the daemon queue processor.");
	});

	test("summarizeWithSource labels the heuristic fallback when every LLM fails", async () => {
		const event = createEvent({
			agent: "claude",
			text: "Implemented the daemon queue processor. Added retry handling and tests.",
		});
		const { runner } = recordingRunner(() => ({
			ok: false,
			exitCode: 1,
			stderr: "model timed out",
		}));

		const outcome = await summarizeWithSource(
			event,
			config({ summarizer: { priority: ["pi-fast", "heuristic"] } }),
			runner,
		);

		expect(outcome.summarizerUsed).toBe("heuristic");
		expect(outcome.summary).toBe("Implemented the daemon queue processor.");
	});

	test("summarizeWithSource labels the LLM that actually produced the summary", async () => {
		const event = createEvent({ agent: "pi", text: "Pi did the work." });
		const { runner } = recordingRunner(() => ({
			ok: true,
			stdout: "Pi finished the queue policy.",
		}));

		const outcome = await summarizeWithSource(
			event,
			config({ summarizer: { priority: ["pi-fast", "heuristic"] } }),
			runner,
		);

		expect(outcome.summarizerUsed).toBe("pi-fast");
		expect(outcome.summary).toBe("Pi finished the queue policy.");
	});

	test("summarizeWithSource reports each failing summarizer via onFallback", async () => {
		const event = createEvent({ agent: "claude", text: "Work done here." });
		const { runner } = recordingRunner(() => ({
			ok: false,
			exitCode: 1,
			stderr: "boom",
		}));
		const fallbacks: string[] = [];

		await summarizeWithSource(
			event,
			config({ summarizer: { priority: ["pi-fast", "heuristic"] } }),
			runner,
			{ onFallback: (info) => fallbacks.push(info.name) },
		);

		expect(fallbacks).toEqual(["pi-fast"]);
	});

	test("heuristic summary returns the first sentence of cleaned multi-line output", () => {
		const summary = heuristicSummary(
			"## Done\n\n- Implemented summarizer fallback.\n- Added tests!\n\u0007Second sentence should now be included.",
		);

		expect(summary).toBe("Done Implemented summarizer fallback.");
		expect(summary).not.toContain("\n");
	});

	test("question events are spoken verbatim without invoking the summarizer", async () => {
		const event = createEvent({
			agent: "claude",
			text: "Claude is asking for your input: Pick one. The options are A, B, or C.",
			metadata: { kind: "question" },
		});
		const { calls, runner } = recordingRunner(() => ({
			ok: true,
			stdout: "should not be used",
		}));

		const outcome = await summarizeWithSource(
			event,
			config({ summarizer: { priority: ["pi-fast", "heuristic"] } }),
			runner,
		);

		expect(outcome.summarizerUsed).toBe("verbatim");
		expect(outcome.summary).toBe(
			"Claude is asking for your input: Pick one. The options are A, B, or C.",
		);
		expect(calls).toHaveLength(0);
	});

	test("summarizer keeps up to maxSentences sentences", async () => {
		const event = createEvent({ agent: "claude", text: "x" });
		const { runner } = recordingRunner(() => ({
			ok: true,
			stdout: "First done. Second done. Third dropped.",
		}));

		const summary = await summarize(
			event,
			config({
				summarizer: { priority: ["pi-fast", "heuristic"], maxSentences: 2 },
			}),
			runner,
		);

		expect(summary).toBe("First done. Second done.");
	});

	test("heuristicSummary keeps the first N sentences when asked", () => {
		expect(heuristicSummary("One. Two. Three.", 2)).toBe("One. Two.");
	});

	test("heuristicSummary applies a word-boundary char cap when maxChars is given", () => {
		const result = heuristicSummary("This sentence is quite long indeed.", 1, 20);
		expect(result).toBe("This sentence is.");
		expect(result.length).toBeLessThanOrEqual(20);
	});

	test("buildPrompt injects the style fragment and the sentence + char budget", () => {
		const rawText = "Raw local response including Bearer sk-secret123.";
		const prompt = buildPrompt(
			createEvent({ agent: "claude", text: rawText }),
			config({
				summarizer: {
					promptStyle: "terse",
					maxSentences: 2,
					maxSummaryChars: 200,
				},
			}),
		);

		expect(prompt).toContain("at most 2 sentences");
		expect(prompt).toContain("about 200 characters");
		expect(prompt).toContain("Be as brief as possible");
		expect(prompt).toContain("Agent: claude");
		expect(prompt).toContain(rawText);
	});

	test("buildPrompt is singular and neutral at the defaults", () => {
		const prompt = buildPrompt(createEvent({ agent: "pi", text: "done" }), config());
		expect(prompt).toContain("at most 1 sentence");
		expect(prompt).not.toContain("at most 1 sentences");
		expect(prompt).toContain("plainly and neutrally");
	});
});
