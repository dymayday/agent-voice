import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";
import { openDb } from "../src/db";
import { createEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import { enqueue } from "../src/store";

async function withTempHome<T>(
	fn: (home: string) => Promise<T> | T,
): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-history-test-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

type ParsedHistory = {
	version: 1;
	jobs: Array<{ id: string; [key: string]: unknown }>;
	pageInfo: {
		limit: number;
		hasMore: boolean;
		nextCursor: string | null;
	};
};

function finishJob(
	db: ReturnType<typeof openDb>,
	id: string,
	status: "done" | "failed" | "skipped",
	finishedAt: string,
): void {
	if (status === "done") {
		db.query(
			"UPDATE jobs SET status='done', summary=?, summarizer_used=?, finished_at=? WHERE id=?",
		).run(`Summary ${id}`, "heuristic", finishedAt, id);
	} else if (status === "failed") {
		db.query(
			"UPDATE jobs SET status='failed', last_error=?, finished_at=? WHERE id=?",
		).run(`Error ${id}`, finishedAt, id);
	} else {
		db.query(
			"UPDATE jobs SET status='skipped', skip_reason=?, finished_at=? WHERE id=?",
		).run(`Skip ${id}`, finishedAt, id);
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
			).run(
				"Claude finished.",
				"heuristic",
				"2026-06-15T00:01:00.000Z",
				done.id,
			);
			db.query(
				"UPDATE jobs SET status='failed', last_error=?, finished_at=? WHERE id=?",
			).run("boom", "2026-06-15T00:02:00.000Z", failed.id);
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
			expect(parsed).toMatchObject({
				pageInfo: { limit: 10, hasMore: false, nextCursor: null },
			});
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
			expect(JSON.parse(result.stdout)).toEqual({
				version: 1,
				jobs: [],
				pageInfo: { limit: 50, hasMore: false, nextCursor: null },
			});
			await expect(Bun.file(paths.db).exists()).resolves.toBe(false);
		});
	});

	test("paginates older history with an opaque cursor", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const newest = createEvent({ agent: "claude", text: "Newest." });
			const middle = createEvent({ agent: "codex", text: "Middle." });
			const oldest = createEvent({ agent: "pi", text: "Oldest." });
			const db = openDb(paths.db);
			enqueue(db, { ...oldest, createdAt: "2026-06-15T00:00:01.000Z" });
			enqueue(db, { ...middle, createdAt: "2026-06-15T00:00:02.000Z" });
			enqueue(db, { ...newest, createdAt: "2026-06-15T00:00:03.000Z" });
			finishJob(db, oldest.id, "done", "2026-06-15T00:01:00.000Z");
			finishJob(db, middle.id, "failed", "2026-06-15T00:02:00.000Z");
			finishJob(db, newest.id, "skipped", "2026-06-15T00:03:00.000Z");
			db.close();

			const first = await runCli(["history", "--json", "--limit", "2"], {
				env: { AGENT_VOICE_HOME: home },
			});
			expect(first.exitCode).toBe(0);
			const firstParsed = JSON.parse(first.stdout) as ParsedHistory;
			expect(firstParsed.jobs.map((job) => job.id)).toEqual([
				newest.id,
				middle.id,
			]);
			expect(firstParsed.pageInfo).toMatchObject({
				limit: 2,
				hasMore: true,
			});
			expect(firstParsed.pageInfo.nextCursor).toEqual(expect.any(String));

			const second = await runCli(
				[
					"history",
					"--json",
					"--limit",
					"2",
					"--before",
					firstParsed.pageInfo.nextCursor!,
				],
				{ env: { AGENT_VOICE_HOME: home } },
			);
			expect(second.exitCode).toBe(0);
			const secondParsed = JSON.parse(second.stdout) as ParsedHistory;
			expect(secondParsed.jobs.map((job) => job.id)).toEqual([oldest.id]);
			expect(secondParsed.pageInfo).toEqual({
				limit: 2,
				hasMore: false,
				nextCursor: null,
			});
			expect(
				new Set([...firstParsed.jobs, ...secondParsed.jobs].map((job) => job.id))
					.size,
			).toBe(3);
		});
	});

	test("cursor pagination stays stable when newer jobs arrive between pages", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const newest = createEvent({ agent: "claude", text: "Newest." });
			const middle = createEvent({ agent: "codex", text: "Middle." });
			const oldest = createEvent({ agent: "pi", text: "Oldest." });
			const newerAfterFirstPage = createEvent({
				agent: "claude",
				text: "Arrived later.",
			});
			const db = openDb(paths.db);
			enqueue(db, { ...oldest, createdAt: "2026-06-15T00:00:01.000Z" });
			enqueue(db, { ...middle, createdAt: "2026-06-15T00:00:02.000Z" });
			enqueue(db, { ...newest, createdAt: "2026-06-15T00:00:03.000Z" });
			finishJob(db, oldest.id, "done", "2026-06-15T00:01:00.000Z");
			finishJob(db, middle.id, "done", "2026-06-15T00:02:00.000Z");
			finishJob(db, newest.id, "done", "2026-06-15T00:03:00.000Z");
			db.close();

			const first = await runCli(["history", "--json", "--limit", "2"], {
				env: { AGENT_VOICE_HOME: home },
			});
			const firstParsed = JSON.parse(first.stdout) as ParsedHistory;

			const dbAfterFirstPage = openDb(paths.db);
			enqueue(dbAfterFirstPage, {
				...newerAfterFirstPage,
				createdAt: "2026-06-15T00:00:04.000Z",
			});
			finishJob(
				dbAfterFirstPage,
				newerAfterFirstPage.id,
				"done",
				"2026-06-15T00:04:00.000Z",
			);
			dbAfterFirstPage.close();

			const second = await runCli(
				[
					"history",
					"--json",
					"--limit",
					"2",
					"--before",
					firstParsed.pageInfo.nextCursor!,
				],
				{ env: { AGENT_VOICE_HOME: home } },
			);
			const secondParsed = JSON.parse(second.stdout) as ParsedHistory;
			expect(firstParsed.jobs.map((job) => job.id)).toEqual([
				newest.id,
				middle.id,
			]);
			expect(secondParsed.jobs.map((job) => job.id)).toEqual([oldest.id]);
		});
	});

	test("rejects invalid history cursors", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(
				["history", "--json", "--before", "not-a-valid-cursor"],
				{ env: { AGENT_VOICE_HOME: home } },
			);
			expect(result.exitCode).toBe(2);
			expect(result.stderr).toContain(
				"--before must be a valid history cursor",
			);
		});
	});

	test("rejects invalid history limits", async () => {
		await withTempHome(async (home) => {
			for (const limit of ["abc", "0", "-1", "1.5"]) {
				const result = await runCli(["history", "--json", "--limit", limit], {
					env: { AGENT_VOICE_HOME: home },
				});
				expect(result.exitCode).toBe(2);
				expect(result.stderr).toContain(
					"--limit must be an integer between 1 and 200",
				);
			}
		});
	});

	test("rejects missing history limit value", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(["history", "--json", "--limit"], {
				env: { AGENT_VOICE_HOME: home },
			});
			expect(result.exitCode).toBe(2);
			expect(result.stderr).toContain(
				"--limit must be an integer between 1 and 200",
			);
		});
	});

	test("rejects plain history until text output is designed", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(["history"], {
				env: { AGENT_VOICE_HOME: home },
			});
			expect(result.exitCode).toBe(2);
			expect(result.stderr).toContain("history currently requires --json");
		});
	});
});
