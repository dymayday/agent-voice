import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";
import { openDb } from "../src/db";
import { createEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import { enqueue } from "../src/store";

async function withTempHome<T>(fn: (home: string) => Promise<T> | T): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-history-test-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

describe("agent-voice history --json", () => {
	test("returns recent terminal jobs from queue.db", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const done = createEvent({ agent: "claude", text: "Done raw text." });
			const failed = createEvent({ agent: "codex", text: "Failed raw text." });
			const db = openDb(paths.db);
			enqueue(db, { ...done, createdAt: "2026-06-15T00:00:01.000Z" });
			enqueue(db, { ...failed, createdAt: "2026-06-15T00:00:02.000Z" });
			db.query(
				"UPDATE jobs SET status='done', summary=?, summarizer_used=?, finished_at=? WHERE id=?",
			).run("Claude finished.", "heuristic", "2026-06-15T00:01:00.000Z", done.id);
			db.query("UPDATE jobs SET status='failed', last_error=?, finished_at=? WHERE id=?").run(
				"boom",
				"2026-06-15T00:02:00.000Z",
				failed.id,
			);
			db.close();

			const result = await runCli(["history", "--json", "--limit", "10"], {
				env: { AGENT_VOICE_HOME: home },
			});

			expect(result.exitCode).toBe(0);
			const parsed = JSON.parse(result.stdout) as {
				version: 1;
				jobs: Array<Record<string, unknown>>;
			};
			expect(parsed.version).toBe(1);
			expect(parsed.jobs.map((job) => job.id)).toEqual([failed.id, done.id]);
			expect(parsed.jobs[0]).toMatchObject({
				status: "failed",
				lastError: "boom",
				text: "Failed raw text.",
			});
			expect(parsed.jobs[1]).toMatchObject({
				status: "done",
				summary: "Claude finished.",
				summarizerUsed: "heuristic",
			});
		});
	});

	test("history json is read-only when queue.db is missing", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });

			const result = await runCli(["history", "--json"], {
				env: { AGENT_VOICE_HOME: home },
			});

			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout)).toEqual({ version: 1, jobs: [] });
			await expect(Bun.file(paths.db).exists()).resolves.toBe(false);
		});
	});

	test("rejects invalid history limits", async () => {
		await withTempHome(async (home) => {
			for (const limit of ["abc", "0", "-1", "1.5"]) {
				const result = await runCli(["history", "--json", "--limit", limit], {
					env: { AGENT_VOICE_HOME: home },
				});
				expect(result.exitCode).toBe(2);
				expect(result.stderr).toContain("--limit must be an integer between 1 and 200");
			}
		});
	});

	test("rejects missing history limit value", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(["history", "--json", "--limit"], {
				env: { AGENT_VOICE_HOME: home },
			});
			expect(result.exitCode).toBe(2);
			expect(result.stderr).toContain("--limit must be an integer between 1 and 200");
		});
	});

	test("rejects plain history until text output is designed", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(["history"], { env: { AGENT_VOICE_HOME: home } });
			expect(result.exitCode).toBe(2);
			expect(result.stderr).toContain("history currently requires --json");
		});
	});
});
