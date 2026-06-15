import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";
import { loadConfig, saveConfig } from "../src/config";
import { writeDaemonLock } from "../src/daemon";
import { openDb } from "../src/db";
import { createEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import { enqueue, markFailed } from "../src/store";

type JsonStatus = {
	version: 1;
	daemon: {
		state: "running" | "stale" | "stopped";
		running: boolean;
		pid: number | null;
	};
	queues: {
		pending: number;
		processing: number;
		done: number;
		failed: number;
		skipped: number;
	};
	config: { enabled: boolean; agents: Record<string, { enabled: boolean; mode: string }> };
	paths: { home: string; config: string; db: string };
	ui: { state: string; attention: string[] };
};

async function withTempHome<T>(fn: (home: string) => Promise<T> | T): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-status-test-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

describe("agent-voice status --json", () => {
	test("returns parseable app status without changing text status", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const db = openDb(paths.db);
			enqueue(db, createEvent({ agent: "claude", text: "Done." }));
			db.close();

			const jsonResult = await runCli(["status", "--json"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: { isPidAlive: () => false },
			});
			expect(jsonResult.exitCode).toBe(0);
			const parsed = JSON.parse(jsonResult.stdout) as JsonStatus;

			expect(parsed.version).toBe(1);
			expect(parsed.daemon.state).toBe("stopped");
			expect(parsed.queues.pending).toBe(1);
			expect(parsed.config.enabled).toBe(true);
			expect(parsed.paths.home).toBe(home);
			expect(parsed.paths.db).toBe(paths.db);
			expect(parsed.ui.state).toBe("daemon_stopped");

			const textResult = await runCli(["status"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: { isPidAlive: () => false },
			});
			expect(textResult.stdout).toContain("stopped");
			expect(() => JSON.parse(textResult.stdout)).toThrow();
		});
	});

	test("reports paused attention from config", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const config = loadConfig(paths);
			saveConfig(paths, { ...config, enabled: false });
			const db = openDb(paths.db);
			enqueue(db, createEvent({ agent: "pi", text: "Paused event." }));
			db.close();

			const result = await runCli(["status", "--json"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: { isPidAlive: () => true },
			});

			const parsed = JSON.parse(result.stdout) as JsonStatus;
			expect(parsed.config.enabled).toBe(false);
			expect(parsed.ui.state).toBe("paused");
			expect(parsed.ui.attention).toContain("system_paused");
		});
	});

	test("reports failed jobs as needs attention", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "codex", text: "Failed." });
			const db = openDb(paths.db);
			enqueue(db, event);
			markFailed(db, event.id, new Date("2026-06-15T00:00:00.000Z"), "boom");
			db.close();

			const result = await runCli(["status", "--json"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: { isPidAlive: () => true },
			});

			const parsed = JSON.parse(result.stdout) as JsonStatus;
			expect(parsed.ui.state).toBe("needs_attention");
			expect(parsed.ui.attention).toContain("failed_jobs");
		});
	});

	test("reports stale daemon lock as needs attention", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeDaemonLock(paths, 12345);

			const result = await runCli(["status", "--json"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: { isPidAlive: () => false },
			});

			const parsed = JSON.parse(result.stdout) as JsonStatus;
			expect(parsed.daemon.state).toBe("stale");
			expect(parsed.ui.state).toBe("needs_attention");
			expect(parsed.ui.attention).toContain("stale_daemon_lock");
		});
	});

	test("status json does not create a missing config file", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			expect(existsSync(paths.config)).toBe(false);

			const result = await runCli(["status", "--json"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: { isPidAlive: () => false },
			});

			expect(result.exitCode).toBe(0);
			expect(existsSync(paths.config)).toBe(false);
		});
	});
});
