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
	test("pause and resume are rejected until implemented", async () => {
		await withTempHome(async (home) => {
			const env = { AGENT_VOICE_HOME: home };
			const paths = resolvePaths(env);

			const pause = await runCli(["pause"], { env });
			expect(pause.exitCode).toBe(2);
			expect(pause.stdout).toBe("");
			expect(pause.stderr).toContain("Pause/resume is not implemented");
			expect(loadConfig(paths).enabled).toBe(true);

			const resume = await runCli(["resume"], { env });
			expect(resume.exitCode).toBe(2);
			expect(resume.stdout).toBe("");
			expect(resume.stderr).toContain("Pause/resume is not implemented");
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
