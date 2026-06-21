import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	defaultConfig,
	loadConfig,
	setConfigValue,
	validateConfig,
} from "../src/config";
import { runCli } from "../src/cli";
import { resolvePaths } from "../src/paths";

describe("summarizer prompt knobs config", () => {
	test("defaults are the unchanged one-sentence behavior", () => {
		expect(defaultConfig.summarizer.promptStyle).toBe("default");
		expect(defaultConfig.summarizer.maxSentences).toBe(1);
		expect(defaultConfig.summarizer.maxSummaryChars).toBe(180);
	});

	test("defaults skip bare done notifications", () => {
		expect(defaultConfig.ignoreTextPhrases).toEqual(["done"]);
	});

	test("setConfigValue round-trips all three knobs", () => {
		const a = setConfigValue(defaultConfig, "summarizer.promptStyle", "triage");
		expect(a.summarizer.promptStyle).toBe("triage");
		const b = setConfigValue(defaultConfig, "summarizer.maxSentences", "3");
		expect(b.summarizer.maxSentences).toBe(3);
		const c = setConfigValue(
			defaultConfig,
			"summarizer.maxSummaryChars",
			"260",
		);
		expect(c.summarizer.maxSummaryChars).toBe(260);
	});

	test("maxSentences has no upper bound but rejects < 1 and non-integers", () => {
		expect(
			setConfigValue(defaultConfig, "summarizer.maxSentences", "9").summarizer
				.maxSentences,
		).toBe(9);
		expect(() =>
			setConfigValue(defaultConfig, "summarizer.maxSentences", "0"),
		).toThrow();
		expect(() =>
			setConfigValue(defaultConfig, "summarizer.maxSentences", "2.5"),
		).toThrow();
	});

	test("promptStyle rejects unknown ids", () => {
		expect(() =>
			setConfigValue(defaultConfig, "summarizer.promptStyle", "shouty"),
		).toThrow();
	});

	test("validateConfig rejects a bad promptStyle on a full config object", () => {
		const bad = JSON.parse(JSON.stringify(defaultConfig));
		bad.summarizer.promptStyle = "nope";
		expect(() => validateConfig(bad)).toThrow(/summarizer.promptStyle/);
	});

	test("validateConfig rejects maxSentences < 1 and non-integers on a full config object", () => {
		const zero = JSON.parse(JSON.stringify(defaultConfig));
		zero.summarizer.maxSentences = 0;
		expect(() => validateConfig(zero)).toThrow(/summarizer.maxSentences/);

		const fractional = JSON.parse(JSON.stringify(defaultConfig));
		fractional.summarizer.maxSentences = 1.5;
		expect(() => validateConfig(fractional)).toThrow(/summarizer.maxSentences/);
	});

	test("speakQuestionsVerbatim defaults false and round-trips a boolean", () => {
		expect(defaultConfig.summarizer.speakQuestionsVerbatim).toBe(false);
		const on = setConfigValue(
			defaultConfig,
			"summarizer.speakQuestionsVerbatim",
			"true",
		);
		expect(on.summarizer.speakQuestionsVerbatim).toBe(true);
	});

	test("validateConfig rejects a non-boolean speakQuestionsVerbatim", () => {
		const bad = JSON.parse(JSON.stringify(defaultConfig));
		bad.summarizer.speakQuestionsVerbatim = "yes";
		expect(() => validateConfig(bad)).toThrow(
			/summarizer.speakQuestionsVerbatim/,
		);
	});

	test("validateConfig rejects non-string ignore text phrases", () => {
		const bad = JSON.parse(JSON.stringify(defaultConfig));
		bad.ignoreTextPhrases = ["done", 42];
		expect(() => validateConfig(bad)).toThrow(/ignoreTextPhrases/);
	});

	test("adaptive is an accepted promptStyle", () => {
		const updated = setConfigValue(
			defaultConfig,
			"summarizer.promptStyle",
			"adaptive",
		);
		expect(updated.summarizer.promptStyle).toBe("adaptive");
		expect(() => validateConfig(updated)).not.toThrow();
	});
});

async function withTempHome<T>(
	fn: (home: string) => T | Promise<T>,
): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-test-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

describe("agent-voice config and paths", () => {
	test("resolves AGENT_VOICE_HOME before falling back to ~/.agent-voice", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });

			expect(paths.home).toBe(home);
			expect(paths.config).toBe(join(home, "config.json"));
			expect(paths.db).toBe(join(home, "queue.db"));
			expect(paths.logs).toBe(join(home, "logs"));
		});
	});

	test("default config is pi-first through the codex subscription and requires Kokoro setup", () => {
		expect(defaultConfig.summarizer.priority).toEqual([
			"pi-fast",
			"codex-fast",
			"heuristic",
		]);
		expect(defaultConfig.summarizer.timeoutSeconds).toBe(33);
		expect(defaultConfig.summarizer.codexModel).toBe("gpt-5.3-codex");
		expect(defaultConfig.summarizer.piModel).toBe("openai-codex/gpt-5.5");
		expect(defaultConfig.summarizer.thinking).toBe("off");
		expect(defaultConfig.tts.kokoroScript).not.toContain("/Users/");
		expect(defaultConfig.tts.kokoroScript).toBe("");
		expect(defaultConfig.ui.desktopCapsule.enabled).toBe(false);
	});

	test("setConfigValue updates known dotted leaf paths and rejects unsafe paths", () => {
		const updated = setConfigValue(
			defaultConfig,
			"summarizer.timeoutSeconds",
			"8",
		);
		expect(updated.summarizer.timeoutSeconds).toBe(8);

		expect(() =>
			setConfigValue(defaultConfig, "summarizer.missing", "8"),
		).toThrow("Unknown config path");
		expect(() => setConfigValue(defaultConfig, "summarizer", "8")).toThrow(
			"Cannot replace config section",
		);
		expect(() =>
			setConfigValue(defaultConfig, "agents.__proto__.toString", "polluted"),
		).toThrow("Unsafe config path");
		expect(() =>
			setConfigValue(
				defaultConfig,
				"agents.constructor.prototype.polluted",
				"true",
			),
		).toThrow("Unsafe config path");
		expect(() =>
			setConfigValue(defaultConfig, "summarizer.priority", "heuristic"),
		).toThrow("Cannot replace config array");
		expect(() =>
			setConfigValue(defaultConfig, "summarizer.priority.0", "heuristic"),
		).toThrow("Cannot update config array element");
		expect(Object.prototype.toString).not.toBe("polluted");
	});

	test("config get writes defaults under AGENT_VOICE_HOME", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(["config", "get"], {
				env: { AGENT_VOICE_HOME: home },
			});

			expect(result.exitCode).toBe(0);
			const config = JSON.parse(result.stdout) as Record<string, unknown>;
			expect(Object.keys(config).sort()).toEqual([
				"agents",
				"enabled",
				"ignoreCwdPatterns",
				"ignoreTextPhrases",
				"speakPolicy",
				"spool",
				"summarizer",
				"tts",
				"ui",
			]);
			expect((config.summarizer as Record<string, unknown>).codexModel).toBe(
				"gpt-5.3-codex",
			);
			expect(existsSync(join(home, "config.json"))).toBe(true);
		});
	});

	test("heuristic-only configs may leave inactive provider model strings empty", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeFileSync(
				paths.config,
				JSON.stringify({
					summarizer: {
						priority: ["heuristic"],
						codexModel: "",
						piModel: "",
						opencodeModel: "",
					},
				}),
			);

			const config = loadConfig(paths);

			expect(config.summarizer.priority).toEqual(["heuristic"]);
			expect(config.summarizer.codexModel).toBe("");
			expect(config.summarizer.piModel).toBe("");
			expect(config.summarizer.opencodeModel).toBe("");
		});
	});

	test("active external summarizers still require configured model strings", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeFileSync(
				paths.config,
				JSON.stringify({
					summarizer: { priority: ["pi-fast", "heuristic"], piModel: "" },
				}),
			);

			expect(() => loadConfig(paths)).toThrow("summarizer.piModel");
		});
	});

	test("loadConfig merges older partial config files with current defaults", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeFileSync(
				paths.config,
				JSON.stringify({
					enabled: false,
					agents: { pi: { enabled: false, mode: "native" } },
					summarizer: { timeoutSeconds: 9 },
					tts: { voice: "af_sky" },
					spool: { maxAttempts: 2 },
				}),
			);

			const config = loadConfig(paths);

			expect(config.enabled).toBe(false);
			expect(config.agents.pi.enabled).toBe(false);
			expect(config.agents.claude.enabled).toBe(true);
			expect(config.ignoreCwdPatterns).toEqual([]);
			expect(config.ignoreTextPhrases).toEqual(["done"]);
			expect(config.summarizer.timeoutSeconds).toBe(9);
			expect(config.summarizer.maxInputChars).toBe(
				defaultConfig.summarizer.maxInputChars,
			);
			expect(config.tts.voice).toBe("af_sky");
			expect(config.tts.python).toBe("python3");
			expect(config.spool.maxAttempts).toBe(2);
			expect(config.spool.retentionDays).toBe(
				defaultConfig.spool.retentionDays,
			);
			expect(config.ui.desktopCapsule.enabled).toBe(false);
		});
	});

	test("loadConfig rejects unsafe merge keys without prototype pollution", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeFileSync(
				paths.config,
				'{"agents":{"__proto__":{"polluted":"yes"}}}',
			);

			try {
				expect(() => loadConfig(paths)).toThrow("Unsafe config path");
				expect(
					(Object.prototype as Record<string, unknown>).polluted,
				).toBeUndefined();
			} finally {
				delete (Object.prototype as Record<string, unknown>).polluted;
			}
		});
	});

	test("config set writes dotted values", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(
				["config", "set", "summarizer.timeoutSeconds", "8"],
				{
					env: { AGENT_VOICE_HOME: home },
				},
			);

			expect(result.exitCode).toBe(0);
			expect(
				loadConfig(resolvePaths({ AGENT_VOICE_HOME: home })).summarizer
					.timeoutSeconds,
			).toBe(8);

			const capsuleResult = await runCli(
				["config", "set", "ui.desktopCapsule.enabled", "true"],
				{
					env: { AGENT_VOICE_HOME: home },
				},
			);
			expect(capsuleResult.exitCode).toBe(0);
			expect(
				loadConfig(resolvePaths({ AGENT_VOICE_HOME: home })).ui.desktopCapsule
					.enabled,
			).toBe(true);
		});
	});

	test("config set accepts JSON arrays for ignoreTextPhrases", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(
				["config", "set", "ignoreTextPhrases", '["done","ok"]'],
				{
					env: { AGENT_VOICE_HOME: home },
				},
			);

			expect(result.exitCode).toBe(0);
			expect(
				loadConfig(resolvePaths({ AGENT_VOICE_HOME: home })).ignoreTextPhrases,
			).toEqual(["done", "ok"]);
		});
	});

	test("config set rejects invalid scalar values without persisting", async () => {
		await withTempHome(async (home) => {
			const env = { AGENT_VOICE_HOME: home };
			expect(
				(
					await runCli(["config", "set", "summarizer.timeoutSeconds", "8"], {
						env,
					})
				).exitCode,
			).toBe(0);

			const invalidNumber = await runCli(
				["config", "set", "summarizer.timeoutSeconds", "0"],
				{ env },
			);
			expect(invalidNumber.exitCode).toBe(2);
			expect(invalidNumber.stderr).toContain("summarizer.timeoutSeconds");
			expect(loadConfig(resolvePaths(env)).summarizer.timeoutSeconds).toBe(8);

			const invalidUnion = await runCli(
				["config", "set", "summarizer.thinking", "maximum"],
				{ env },
			);
			expect(invalidUnion.exitCode).toBe(2);
			expect(invalidUnion.stderr).toContain("summarizer.thinking");
			expect(loadConfig(resolvePaths(env)).summarizer.thinking).toBe("off");
		});
	});

	test("enable and disable toggle known agents only", async () => {
		await withTempHome(async (home) => {
			expect(
				(
					await runCli(["disable", "codex"], {
						env: { AGENT_VOICE_HOME: home },
					})
				).exitCode,
			).toBe(0);
			expect(
				loadConfig(resolvePaths({ AGENT_VOICE_HOME: home })).agents.codex
					.enabled,
			).toBe(false);

			expect(
				(await runCli(["enable", "codex"], { env: { AGENT_VOICE_HOME: home } }))
					.exitCode,
			).toBe(0);
			expect(
				loadConfig(resolvePaths({ AGENT_VOICE_HOME: home })).agents.codex
					.enabled,
			).toBe(true);

			const invalid = await runCli(["disable", "unknown"], {
				env: { AGENT_VOICE_HOME: home },
			});
			expect(invalid.exitCode).toBe(2);
			expect(invalid.stderr).toContain("Unknown agent");
		});
	});

	test("invalid config set is side-effect-free when config file does not exist", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(
				["config", "set", "summarizer.missing", "8"],
				{
					env: { AGENT_VOICE_HOME: home },
				},
			);

			expect(result.exitCode).toBe(2);
			expect(result.stderr).toContain("Unknown config path");
			expect(existsSync(join(home, "config.json"))).toBe(false);
		});
	});

	test("config set persists JSON without touching unrelated files", async () => {
		await withTempHome(async (home) => {
			await runCli(["config", "set", "tts.voice", "af_sky"], {
				env: { AGENT_VOICE_HOME: home },
			});

			const raw = readFileSync(join(home, "config.json"), "utf8");
			expect(JSON.parse(raw).tts.voice).toBe("af_sky");
		});
	});
});
