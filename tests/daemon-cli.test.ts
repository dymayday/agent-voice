import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli";
import {
	daemonLockPath,
	intentionalStopPath,
	readDaemonLock,
	writeDaemonLock,
	writeIntentionalStop,
} from "../src/daemon";
import { openDb } from "../src/db";
import { createEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import { countByStatus, enqueue } from "../src/store";

async function withTempHome<T>(
	fn: (home: string) => T | Promise<T>,
): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-daemon-cli-test-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

describe("agent-voice daemon CLI", () => {
	test("daemon --foreground --once processes one due job in test mode", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "claude", text: "Speak me." });
			const seed = openDb(paths.db);
			enqueue(seed, event);
			seed.close();
			const spoken: string[] = [];

			const result = await runCli(["daemon", "--foreground", "--once"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: {
					processorDeps: {
						summarize: async () => "Claude finished one job.",
						speak: async (summary, voice) => {
							spoken.push(`${voice}:${summary}`);
						},
					},
				},
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("processed");
			expect(spoken).toEqual(["af_heart:Claude finished one job."]);
			const check = openDb(paths.db);
			expect(countByStatus(check).done).toBe(1);
			const summary = check
				.query("SELECT summary FROM jobs WHERE id=?")
				.get(event.id) as { summary: string };
			expect(summary.summary).toBe("Claude finished one job.");
			check.close();
			expect(existsSync(daemonLockPath(paths))).toBe(false);
		});
	});

	test("status reports daemon PID lock state and queue counts", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeDaemonLock(paths, 4321);
			const seed = openDb(paths.db);
			enqueue(seed, createEvent({ agent: "pi", text: "Queued." }));
			seed.close();

			const result = await runCli(["status"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: { isPidAlive: (pid) => pid === 4321 },
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("running pid=4321");
			expect(result.stdout).toContain("pending=1");
			expect(result.stdout).toContain("processing=0");
		});
	});

	test("start refuses to create a second daemon when a healthy lock exists", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeDaemonLock(paths, 1234);
			let started = false;

			const result = await runCli(["start"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: {
					isPidAlive: () => true,
					startBackground: async () => {
						started = true;
						return 9999;
					},
				},
			});

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("already running");
			expect(started).toBe(false);
		});
	});

	test("start clears intentional-stop marker before launching", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeIntentionalStop(paths);

			const result = await runCli(["start"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: {
					startBackground: async () => 6789,
				},
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("started pid=6789");
			expect(existsSync(intentionalStopPath(paths))).toBe(false);
		});
	});

	test("start spawns a detached foreground daemon when no custom launcher is injected", async () => {
		await withTempHome(async (home) => {
			const spawned: Array<{
				command: string;
				args: string[];
				env: Record<string, string | undefined>;
				cwd: string;
			}> = [];
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });

			const result = await runCli(["start"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: {
					spawnDetached: (request) => {
						spawned.push(request);
						return 24601;
					},
				},
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("started pid=24601");
			expect(spawned).toHaveLength(1);
			expect(spawned[0].command).toBe(process.execPath);
			expect(spawned[0].args.at(-2)).toBe("daemon");
			expect(spawned[0].args.at(-1)).toBe("--foreground");
			expect(spawned[0].env.AGENT_VOICE_HOME).toBe(home);
			expect(spawned[0].cwd).toBe(home);
			expect(readDaemonLock(paths)).toBe(24601);
		});
	});

	test("start reports launcher failure without rejecting", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(["start"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: {
					spawnDetached: () => {
						throw new Error("spawn denied");
					},
				},
			});

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("spawn denied");
		});
	});

	test("daemon foreground accepts a lock prewritten for its own pid", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeDaemonLock(paths, process.pid);
			const seed = openDb(paths.db);
			enqueue(seed, createEvent({ agent: "claude", text: "Speak me." }));
			seed.close();
			const spoken: string[] = [];

			const result = await runCli(["daemon", "--foreground", "--once"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: {
					processorDeps: {
						summarize: async () => "Claude finished one prelocked job.",
						speak: async (summary, voice) => {
							spoken.push(`${voice}:${summary}`);
						},
					},
				},
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("processed");
			expect(spoken).toEqual(["af_heart:Claude finished one prelocked job."]);
			expect(existsSync(daemonLockPath(paths))).toBe(false);
		});
	});

	test("stop writes intentional-stop marker before invoking stop helper", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeDaemonLock(paths, 9876);
			let markerSeenByStop = false;

			const result = await runCli(["stop"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: {
					isPidAlive: () => true,
					stopProcess: async () => {
						markerSeenByStop = existsSync(intentionalStopPath(paths));
					},
				},
			});

			expect(result.exitCode).toBe(0);
			expect(markerSeenByStop).toBe(true);
			expect(existsSync(intentionalStopPath(paths))).toBe(true);
		});
	});

	test("stop sends SIGTERM when no custom stop helper is injected", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeDaemonLock(paths, 1357);
			const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];

			const result = await runCli(["stop"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: {
					isPidAlive: () => true,
					killProcess: (pid, signal) => {
						signals.push({ pid, signal });
					},
				},
			});

			expect(result.exitCode).toBe(0);
			expect(signals).toEqual([{ pid: 1357, signal: "SIGTERM" }]);
			expect(existsSync(intentionalStopPath(paths))).toBe(true);
		});
	});

	test("successful stop clears daemon lock so status is cleanly stopped", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeDaemonLock(paths, 2468);

			const result = await runCli(["stop"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: {
					isPidAlive: () => true,
					killProcess: () => {},
				},
			});

			expect(result.exitCode).toBe(0);
			expect(existsSync(daemonLockPath(paths))).toBe(false);
		});
	});

	test("stop reports signaling failure without rejecting", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeDaemonLock(paths, 9753);

			const result = await runCli(["stop"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: {
					isPidAlive: () => true,
					killProcess: () => {
						throw new Error("permission denied");
					},
				},
			});

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("permission denied");
			expect(existsSync(intentionalStopPath(paths))).toBe(true);
		});
	});

	test("test command runs manual summarize and speak path", async () => {
		await withTempHome(async (home) => {
			const spoken: string[] = [];

			const result = await runCli(["test", "Manual raw text"], {
				env: { AGENT_VOICE_HOME: home },
				daemonDeps: {
					processorDeps: {
						summarize: async (event) => {
							expect(event.text).toBe("Manual raw text");
							return "Manual summary.";
						},
						speak: async (summary, voice) => {
							spoken.push(`${voice}:${summary}`);
						},
					},
				},
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("Manual summary.");
			expect(spoken).toEqual(["af_heart:Manual summary."]);
		});
	});
});
