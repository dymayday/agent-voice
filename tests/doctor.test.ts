import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";
import { loadConfig, saveConfig } from "../src/config";
import { resolvePaths } from "../src/paths";

async function withTempHome<T>(
	fn: (home: string) => Promise<T> | T,
): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-doctor-test-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

describe("agent-voice doctor --json", () => {
	test("reports Kokoro script and daemon checks", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const fakeKokoro = join(home, "kokoro.py");
			writeFileSync(fakeKokoro, "print('ready')\n", "utf8");
			const config = loadConfig(paths);
			saveConfig(paths, {
				...config,
				tts: { ...config.tts, kokoroScript: fakeKokoro },
			});

			const result = await runCli(["doctor", "--json"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: { isPidAlive: () => false },
			});

			expect(result.exitCode).toBe(0);
			const parsed = JSON.parse(result.stdout) as {
				checks: Array<{ id: string; ok: boolean }>;
			};
			expect(
				parsed.checks.find((check) => check.id === "config.load")?.ok,
			).toBe(true);
			expect(
				parsed.checks.find((check) => check.id === "tts.kokoroScript.exists")
					?.ok,
			).toBe(true);
			expect(
				parsed.checks.find((check) => check.id === "daemon.running")?.ok,
			).toBe(false);
		});
	});

	test("missing Kokoro script recommends setup before manual path editing", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			loadConfig(paths);

			const result = await runCli(["doctor", "--json"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: { isPidAlive: () => false },
			});

			expect(result.exitCode).toBe(0);
			const parsed = JSON.parse(result.stdout) as {
				checks: Array<{ id: string; action?: string }>;
			};
			const ttsCheck = parsed.checks.find(
				(check) => check.id === "tts.kokoroScript.exists",
			);
			expect(ttsCheck?.action).toContain("Open Setup");
			expect(ttsCheck?.action).toContain("agent-voice config set");
		});
	});

	test("reports missing config without creating config or queue files", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			expect(existsSync(paths.config)).toBe(false);
			expect(existsSync(paths.db)).toBe(false);

			const result = await runCli(["doctor", "--json"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: { isPidAlive: () => false },
			});

			expect(result.exitCode).toBe(0);
			const parsed = JSON.parse(result.stdout) as {
				checks: Array<{ id: string; ok: boolean; severity: string }>;
			};
			const configCheck = parsed.checks.find(
				(check) => check.id === "config.load",
			);
			expect(configCheck).toMatchObject({ ok: false, severity: "warning" });
			expect(existsSync(paths.config)).toBe(false);
			expect(existsSync(paths.db)).toBe(false);
			expect(existsSync(`${paths.db}-wal`)).toBe(false);
		});
	});

	test("doctor json handles a missing home directory without creating it", async () => {
		const parent = mkdtempSync(
			join(tmpdir(), "agent-voice-doctor-missing-home-"),
		);
		try {
			const home = join(parent, "missing-home");
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			expect(existsSync(home)).toBe(false);

			const result = await runCli(["doctor", "--json"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: { isPidAlive: () => false },
			});

			expect(result.exitCode).toBe(0);
			const parsed = JSON.parse(result.stdout) as {
				checks: Array<{ id: string; ok: boolean; severity: string }>;
			};
			expect(
				parsed.checks.find((check) => check.id === "queue.failed.empty"),
			).toMatchObject({ ok: true });
			expect(existsSync(home)).toBe(false);
			expect(existsSync(paths.db)).toBe(false);
		} finally {
			rmSync(parent, { recursive: true, force: true });
		}
	});

	test("plain doctor is rejected until text output is designed", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(["doctor"], {
				env: { AGENT_VOICE_HOME: home },
			});
			expect(result.exitCode).toBe(2);
			expect(result.stderr).toContain("doctor currently requires --json");
		});
	});
});
