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
	resultForCall: (request: SummarizerRunRequest, index: number) => SummarizerRunResult,
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
		expect(calls[0].timeoutMs).toBe(defaultConfig.summarizer.timeoutSeconds * 1000);
	});

	test("Pi fast uses safe arg array with configured model and recursion guard", async () => {
		const event = createEvent({ agent: "pi", text: "Pi completed the queue task." });
		const { calls, runner } = recordingRunner(() => ({
			ok: true,
			stdout: "Pi completed the queue policy.\n",
		}));

		const summary = await summarize(
			event,
			config({
				summarizer: {
					priority: ["pi-fast", "heuristic"],
					piModel: "custom/pi-fast-model",
				},
			}),
			runner,
		);

		expect(summary).toBe("Pi completed the queue policy.");
		expect(calls).toHaveLength(1);
		expect(calls[0].cmd).toBe("pi");
		expect(calls[0].args).toEqual([
			"--fast",
			"-p",
			"--model",
			"custom/pi-fast-model",
			"--no-tools",
			"--no-session",
			"-",
		]);
		expect(calls[0].stdin).toContain("Pi completed the queue task.");
		expect(calls[0].env.AGENT_VOICE_DISABLE).toBe("1");
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
			config({ summarizer: { priority: ["codex-fast", "pi-fast", "heuristic"] } }),
			runner,
		);

		expect(summary).toBe("Fallback Pi summary.");
		expect(calls.map((call) => call.cmd)).toEqual(["codex", "pi"]);
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

	test("heuristic summary is one short TTS-friendly sentence", () => {
		const summary = heuristicSummary(
			"## Done\n\n- Implemented summarizer fallback.\n- Added tests!\n\u0007Second sentence should not be included.",
			54,
		);

		expect(summary.length).toBeLessThanOrEqual(54);
		expect(summary).toBe("Done Implemented summarizer fallback.");
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
