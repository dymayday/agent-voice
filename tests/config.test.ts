import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, loadConfig, setConfigValue } from "../src/config";
import { runCli } from "../src/cli";
import { resolvePaths } from "../src/paths";

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

	test("default config is pi-first through the codex subscription with an absolute Kokoro path", () => {
		expect(defaultConfig.summarizer.priority).toEqual(["pi-fast", "heuristic"]);
		expect(defaultConfig.summarizer.codexModel).toBe("gpt-5.3-codex");
		expect(defaultConfig.summarizer.piModel).toBe("openai-codex/gpt-5.5");
		expect(defaultConfig.summarizer.thinking).toBe("off");
		expect(defaultConfig.tts.kokoroScript).toContain("kokoro_tts_service.py");
		expect(defaultConfig.tts.kokoroScript.startsWith("/")).toBe(true);
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
				"speakPolicy",
				"spool",
				"summarizer",
				"tts",
			]);
			expect((config.summarizer as Record<string, unknown>).codexModel).toBe(
				"gpt-5.3-codex",
			);
			expect(existsSync(join(home, "config.json"))).toBe(true);
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
