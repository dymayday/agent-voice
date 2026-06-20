import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli";
import { openDb } from "../src/db";
import { createEvent } from "../src/events";
import { countByStatus, enqueue } from "../src/store";

describe("agent-voice CLI", () => {
	test("queue clear deletes active jobs and reports the count", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-cli-clear-"));
		const db = openDb(join(home, "queue.db"));
		try {
			const pending = createEvent({ agent: "claude", text: "Pending." });
			const processing = createEvent({ agent: "codex", text: "Processing." });
			const done = createEvent({ agent: "pi", text: "Done." });
			enqueue(db, pending);
			enqueue(db, processing);
			enqueue(db, done);
			db.query("UPDATE jobs SET status='processing' WHERE id=?").run(
				processing.id,
			);
			db.query("UPDATE jobs SET status='done' WHERE id=?").run(done.id);

			const result = await runCli(["queue", "clear"], {
				env: { AGENT_VOICE_HOME: home },
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("Cleared 2 queued job(s).\n");
			expect(countByStatus(db).done).toBe(1);
			expect(countByStatus(db).pending).toBe(0);
			expect(countByStatus(db).processing).toBe(0);
		} finally {
			db.close();
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("queue clear --failed removes failed jobs and reports count", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-cli-clear-failed-"));
		const db = openDb(join(home, "queue.db"));
		try {
			const pending = createEvent({ agent: "claude", text: "Pending." });
			const done = createEvent({ agent: "pi", text: "Done." });
			const failed = createEvent({ agent: "codex", text: "Failed." });
			enqueue(db, pending);
			enqueue(db, done);
			enqueue(db, failed);
			db.query("UPDATE jobs SET status='processing' WHERE id=?").run(
				pending.id,
			);
			db.query("UPDATE jobs SET status='done' WHERE id=?").run(done.id);
			db.query("UPDATE jobs SET status='failed' WHERE id=?").run(failed.id);

			const result = await runCli(["queue", "clear", "--failed"], {
				env: { AGENT_VOICE_HOME: home },
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("Cleared 1 failed job.\n");
			expect(countByStatus(db).failed).toBe(0);
			expect(countByStatus(db).processing).toBe(1);
			expect(countByStatus(db).done).toBe(1);
		} finally {
			db.close();
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("prints help with core commands", async () => {
		const result = await runCli(["--help"], { stdout: "", stderr: "" });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("agent-voice install --agents pi|claude");
		expect(result.stdout).toContain("agent-voice uninstall --agents pi|claude");
		expect(result.stdout).toContain("--keep-suspended-hooks");
		expect(result.stdout).not.toContain("codex,opencode");
		expect(result.stdout).not.toContain("--restore-suspended-hooks");
		expect(result.stdout).toContain("agent-voice start");
		expect(result.stdout).toContain("agent-voice stop");
		expect(result.stdout).toContain("agent-voice status");
		expect(result.stdout).toContain("agent-voice enqueue --format");
		expect(result.stdout).toContain("agent-voice test");
		expect(result.stdout).toContain("agent-voice enable");
		expect(result.stdout).toContain("agent-voice disable");
		expect(result.stdout).toContain("agent-voice config get");
		expect(result.stdout).toContain("agent-voice queue clear");
		expect(result.stdout).toContain("agent-voice models list");
		expect(result.stdout).toContain("agent-voice kokoro setup");
		expect(result.stdout).toContain("agent-voice kokoro status --json");
		expect(result.stdout).toContain("agent-voice daemon --foreground");
	});

	test("returns available summarizer model list", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-cli-model-list-"));
		try {
			const result = await runCli(["models", "list"], {
				env: { AGENT_VOICE_HOME: home },
			});

			expect(result.exitCode).toBe(0);
			const payload = JSON.parse(result.stdout);
			expect(Array.isArray(payload.models)).toBe(true);
			expect(payload.providers["pi-fast"]).toContain("openai-codex/gpt-5.5");
			expect(payload.providers["codex-fast"]).toContain("gpt-5.3-codex");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("summarizer prompt renders the assembled prompt for the given knobs", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-cli-prompt-"));
		try {
			const result = await runCli(
				["summarizer", "prompt", "--style", "terse", "--max-sentences", "2", "--max-chars", "240"],
				{ env: { AGENT_VOICE_HOME: home } },
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("at most 2 sentences");
			expect(result.stdout).toContain("about 240 characters");
			expect(result.stdout).toContain("Be as brief as possible");
			expect(result.stdout).toContain("[the agent's last message]");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("summarizer prompt rejects an invalid style", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-cli-prompt-invalid-"));
		try {
			const result = await runCli(["summarizer", "prompt", "--style", "shouty"], {
				env: { AGENT_VOICE_HOME: home },
			});
			expect(result.exitCode).toBe(2);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
