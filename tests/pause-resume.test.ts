import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";
import { loadConfig } from "../src/config";
import { resolvePaths } from "../src/paths";

async function withTempHome<T>(
	fn: (home: string) => Promise<T> | T,
): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-pause-test-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

describe("agent-voice pause/resume", () => {
	test("pause disables the system and resume enables it", async () => {
		await withTempHome(async (home) => {
			const env = { AGENT_VOICE_HOME: home };
			const paths = resolvePaths(env);

			const pause = await runCli(["pause"], { env });
			expect(pause.exitCode).toBe(0);
			expect(pause.stdout).toContain("paused");
			expect(loadConfig(paths).enabled).toBe(false);

			const statusPaused = JSON.parse(
				(await runCli(["status", "--json"], { env })).stdout,
			);
			expect(statusPaused.ui.state).toBe("paused");

			const resume = await runCli(["resume"], { env });
			expect(resume.exitCode).toBe(0);
			expect(resume.stdout).toContain("resumed");
			expect(loadConfig(paths).enabled).toBe(true);
		});
	});

	test("timed pause is rejected until implemented", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(["pause", "--for", "1h"], {
				env: { AGENT_VOICE_HOME: home },
			});
			expect(result.exitCode).toBe(2);
			expect(result.stderr).toContain("Timed pause is not implemented");
		});
	});
});
