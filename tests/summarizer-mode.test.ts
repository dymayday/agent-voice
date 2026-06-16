import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";
import { defaultConfig, loadConfig } from "../src/config";
import { resolvePaths } from "../src/paths";

async function withTempHome<T>(
	fn: (home: string) => Promise<T> | T,
): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-summarizer-test-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

describe("agent-voice summarizer mode", () => {
	test("sets heuristic-only and restores default priority", async () => {
		await withTempHome(async (home) => {
			const env = { AGENT_VOICE_HOME: home };
			const paths = resolvePaths(env);

			const local = await runCli(["summarizer", "mode", "heuristic"], { env });
			expect(local.exitCode).toBe(0);
			expect(loadConfig(paths).summarizer.priority).toEqual(["heuristic"]);

			const normal = await runCli(["summarizer", "mode", "default"], { env });
			expect(normal.exitCode).toBe(0);
			expect(loadConfig(paths).summarizer.priority).toEqual(
				defaultConfig.summarizer.priority,
			);
		});
	});

	test("rejects unknown summarizer mode", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(["summarizer", "mode", "fastest"], {
				env: { AGENT_VOICE_HOME: home },
			});
			expect(result.exitCode).toBe(2);
			expect(result.stderr).toContain("Unknown summarizer mode");
		});
	});
});
