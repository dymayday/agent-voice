import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli";
import { writeDaemonLock } from "../src/daemon";
import { openDb } from "../src/db";
import { createEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import { countByStatus, enqueue } from "../src/store";

async function withTempHome<T>(
	fn: (home: string) => T | Promise<T>,
): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-integration-test-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

describe("agent-voice daemon integration", () => {
	test("foreground daemon loop processes queued jobs and exits in bounded test mode", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const seed = openDb(paths.db);
			enqueue(seed, createEvent({ agent: "claude", text: "First raw turn." }));
			enqueue(seed, createEvent({ agent: "codex", text: "Second raw turn." }));
			seed.close();
			const spoken: string[] = [];

			const result = await runCli(["daemon", "--foreground"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: {
					maxIterations: 3,
					pollIntervalMs: 0,
					processorDeps: {
						summarize: async (event) => `${event.agent} summary.`,
						speak: async (summary, voice) => {
							spoken.push(`${voice}:${summary}`);
						},
					},
				},
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("processed=2");
			expect(result.stdout).toContain("idle=1");
			expect(spoken).toEqual([
				"af_heart:claude summary.",
				"af_heart:codex summary.",
			]);

			const check = openDb(paths.db);
			expect(countByStatus(check).pending).toBe(0);
			expect(countByStatus(check).done).toBe(2);
			check.close();
		});
	});

	test("foreground daemon refuses to start when a healthy lock exists", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeDaemonLock(paths, 2468);

			const result = await runCli(["daemon", "--foreground"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: {
					isPidAlive: (pid) => pid === 2468,
					maxIterations: 1,
					processorDeps: {
						summarize: async () => "should not run",
						speak: async () => undefined,
					},
				},
			});

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("already running");

			const check = openDb(paths.db);
			expect(countByStatus(check).done).toBe(0);
			check.close();
		});
	});
});
