import { describe, expect, test } from "bun:test";
import { defaultConfig, type AgentVoiceConfig } from "../src/config";
import { createEvent } from "../src/events";
import {
	buildPrompt,
	heuristicSummary,
	summarize,
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
		expect(heuristicSummary(noisy, 180)).toBe("The build passed.");
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
			"The build [important] passed. array[0] index.",
			180,
		);
		expect(result).toContain("The build");
		expect(result).toContain("[important]");
		expect(result).toContain("array[0]");
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
		expect(summary).toBe(
			"Implemented the daemon queue processor; Added retry handling and tests.",
		);
	});

	test("heuristic summary keeps all output in one short TTS-friendly sentence", () => {
		const summary = heuristicSummary(
			"## Done\n\n- Implemented summarizer fallback.\n- Added tests!\n\u0007Second sentence should now be included.",
			140,
		);

		expect(summary.length).toBeLessThanOrEqual(140);
		expect(summary).toBe(
			"Done Implemented summarizer fallback; Added tests; Second sentence should now be included.",
		);
		expect(summary).not.toContain("\n");
	});

	test("buildPrompt asks for one sentence and includes raw local response text", () => {
		const rawText = "Raw local response including Bearer sk-secret123.";
		const prompt = buildPrompt(createEvent({ agent: "claude", text: rawText }));

		expect(prompt).toContain("exactly one short");
		expect(prompt).toContain("Agent: claude");
		expect(prompt).toContain(rawText);
	});
});
