import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli";
import { openDb } from "../src/db";
import { resolvePaths } from "../src/paths";

async function withTempHome<T>(
	fn: (home: string) => T | Promise<T>,
): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-codex-cli-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

function pendingJobs(home: string): Record<string, unknown>[] {
	const paths = resolvePaths({ AGENT_VOICE_HOME: home });
	if (!existsSync(paths.db)) return [];
	const db = openDb(paths.db);
	try {
		return db
			.query("SELECT * FROM jobs WHERE status='pending' ORDER BY created_at")
			.all() as Record<string, unknown>[];
	} finally {
		db.close();
	}
}

describe("codex hook enqueue formats", () => {
	test("codex-stop-hook enqueues last_assistant_message under agent codex", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(
				["enqueue", "--format", "codex-stop-hook", "--agent", "codex"],
				{
					env: { AGENT_VOICE_HOME: home },
					stdin: JSON.stringify({
						last_assistant_message: "Built the project successfully.",
						cwd: "/repo",
						session_id: "abc",
					}),
				},
			);
			expect(result.exitCode).toBe(0);
			const jobs = pendingJobs(home);
			expect(jobs).toHaveLength(1);
			expect(jobs[0].agent).toBe("codex");
			expect(jobs[0].text).toContain("Built the project successfully.");
			expect(jobs[0].cwd).toBe("/repo");
		});
	});

	test("codex-stop-hook requires --agent codex", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(
				["enqueue", "--format", "codex-stop-hook", "--agent", "claude"],
				{ env: { AGENT_VOICE_HOME: home }, stdin: "{}" },
			);
			expect(result.exitCode).toBe(2);
			expect(result.stderr).toContain("requires --agent codex");
		});
	});

	test("codex-stop-hook stays exit 0 and enqueues a generic line on empty payload", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(
				["enqueue", "--format", "codex-stop-hook", "--agent", "codex"],
				{ env: { AGENT_VOICE_HOME: home }, stdin: "{}" },
			);
			expect(result.exitCode).toBe(0);
			const jobs = pendingJobs(home);
			expect(jobs).toHaveLength(1);
			expect(jobs[0].text).toContain("Codex finished responding.");
		});
	});

	test("codex-stop-hook stays exit 0 and enqueues nothing on malformed JSON", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(
				["enqueue", "--format", "codex-stop-hook", "--agent", "codex"],
				{ env: { AGENT_VOICE_HOME: home }, stdin: "{not json" },
			);
			expect(result.exitCode).toBe(0);
			expect(pendingJobs(home)).toHaveLength(0);
		});
	});

	test("codex-permission-hook enqueues an approval line", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(
				["enqueue", "--format", "codex-permission-hook", "--agent", "codex"],
				{
					env: { AGENT_VOICE_HOME: home },
					stdin: JSON.stringify({
						tool_name: "Bash",
						tool_input: { description: "Run the test suite" },
					}),
				},
			);
			expect(result.exitCode).toBe(0);
			const jobs = pendingJobs(home);
			expect(jobs).toHaveLength(1);
			expect(jobs[0].text).toContain("Bash");
		});
	});

	test("codex-permission-hook stays silent when there is no tool", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(
				["enqueue", "--format", "codex-permission-hook", "--agent", "codex"],
				{ env: { AGENT_VOICE_HOME: home }, stdin: "{}" },
			);
			expect(result.exitCode).toBe(0);
			expect(pendingJobs(home)).toHaveLength(0);
		});
	});

	test("voice-codex bin alias enqueues raw text under agent codex", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(["voice-codex", "--cwd", "/repo"], {
				env: { AGENT_VOICE_HOME: home },
				stdin: "Codex did the thing.",
			});
			expect(result.exitCode).toBe(0);
			const jobs = pendingJobs(home);
			expect(jobs).toHaveLength(1);
			expect(jobs[0].agent).toBe("codex");
			expect(jobs[0].text).toContain("Codex did the thing.");
		});
	});

	test("voice-opencode bin alias enqueues raw text under agent opencode", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(["voice-opencode"], {
				env: { AGENT_VOICE_HOME: home },
				stdin: "OpenCode did the thing.",
			});
			expect(result.exitCode).toBe(0);
			const jobs = pendingJobs(home);
			expect(jobs).toHaveLength(1);
			expect(jobs[0].agent).toBe("opencode");
		});
	});
});
