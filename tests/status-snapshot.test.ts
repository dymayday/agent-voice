import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { loadConfig, type AgentVoiceConfig, type AgentName } from "../src/config";
import {
	clearStatusSnapshot,
	createStatusPublisher,
	statusSnapshotPath,
	writeStatusSnapshotAtomic,
} from "../src/daemon";
import { openDb } from "../src/db";
import { resolvePaths } from "../src/paths";
import { type AgentInstallState, installPi } from "../src/install";
import {
	buildAppStatusSnapshot,
	composeStatusSnapshot,
	formatAppStatusJson,
} from "../src/status";

async function withTempHome<T>(
	fn: (home: string) => Promise<T> | T,
): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-snapshot-test-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

const zeroQueues = {
	pending: 0,
	processing: 0,
	done: 0,
	failed: 0,
	skipped: 0,
};

// composeStatusSnapshot passes `agents` through untouched; an empty map is fine
// for these unit tests. Typed to satisfy the strict AgentName-keyed record.
const emptyAgents = {} as AgentVoiceConfig["agents"];

// composeStatusSnapshot also passes `install` through untouched. Use a real,
// total AgentName-keyed map (not a cast) so the fixture cannot drift into an
// illegal partial state.
const sampleInstall: Record<AgentName, AgentInstallState> = {
	claude: "unknown",
	codex: "unsupported",
	pi: "unknown",
	opencode: "unsupported",
};

describe("composeStatusSnapshot", () => {
	test("derives a running daemon snapshot from explicit inputs", () => {
		const snapshot = composeStatusSnapshot({
			daemon: { running: true, pid: 4321 },
			queues: { ...zeroQueues, processing: 1 },
			config: { enabled: true, agents: emptyAgents },
			install: sampleInstall,
			paths: { home: "/h", config: "/h/config.json", db: "/h/queue.db" },
			buildId: "build-aaa+1",
		});
		expect(snapshot.version).toBe(1);
		expect(snapshot.daemon).toEqual({ state: "running", running: true, pid: 4321 });
		expect(snapshot.ui.state).toBe("processing");
		expect(snapshot.ui.attention).toEqual([]);
		// buildId passes straight through the composer.
		expect(snapshot.buildId).toBe("build-aaa+1");
	});

	test("derives stale vs stopped from pid when not running", () => {
		const stale = composeStatusSnapshot({
			daemon: { running: false, pid: 99 },
			queues: zeroQueues,
			config: { enabled: true, agents: emptyAgents },
			install: sampleInstall,
			paths: { home: "/h", config: "/h/config.json", db: "/h/queue.db" },
			buildId: null,
		});
		expect(stale.daemon.state).toBe("stale");
		expect(stale.ui.attention).toContain("stale_daemon_lock");

		const stopped = composeStatusSnapshot({
			daemon: { running: false, pid: null },
			queues: zeroQueues,
			config: { enabled: true, agents: emptyAgents },
			install: sampleInstall,
			paths: { home: "/h", config: "/h/config.json", db: "/h/queue.db" },
			buildId: null,
		});
		expect(stopped.daemon.state).toBe("stopped");
		expect(stopped.ui.state).toBe("daemon_stopped");
	});

	test("buildAppStatusSnapshot reports detected install state", async () => {
		await withTempHome((home) => {
			const env = {
				HOME: home,
				AGENT_VOICE_HOME: join(home, ".agent-voice"),
				AGENT_VOICE_EXECUTABLE: "/repo/bin/agent-voice",
			};
			const paths = resolvePaths(env);
			installPi(env);

			const built = buildAppStatusSnapshot(paths, { isPidAlive: () => false }, env);

			expect(built.install.pi).toBe("installed");
			expect(built.install.claude).toBe("not_installed");
			expect(built.install.codex).toBe("not_installed");
		});
	});

	test("the daemon publisher writes detected install state to status.json", async () => {
		await withTempHome((home) => {
			const env = {
				HOME: home,
				AGENT_VOICE_HOME: join(home, ".agent-voice"),
				AGENT_VOICE_EXECUTABLE: "/repo/bin/agent-voice",
			};
			const paths = resolvePaths(env);
			installPi(env);
			const config = loadConfig(paths, { createIfMissing: true });
			const db = openDb(paths.db);
			try {
				const publisher = createStatusPublisher(paths, db, env);
				publisher.publish(config);
				const snapshot = JSON.parse(
					readFileSync(statusSnapshotPath(paths), "utf8"),
				) as { install: Record<string, string> };
				expect(snapshot.install.pi).toBe("installed");
				expect(snapshot.install.opencode).toBe("not_installed");
			} finally {
				db.close();
			}
		});
	});

	test("the daemon publisher reports the build id captured at startup", async () => {
		await withTempHome((home) => {
			const env = {
				HOME: home,
				AGENT_VOICE_HOME: join(home, ".agent-voice"),
				AGENT_VOICE_EXECUTABLE: "/repo/bin/agent-voice",
			};
			const paths = resolvePaths(env);
			const config = loadConfig(paths, { createIfMissing: true });
			const db = openDb(paths.db);
			try {
				// Inject the startup build id explicitly; a long-running daemon keeps
				// reporting this even after the on-disk bundle is rebuilt.
				createStatusPublisher(paths, db, env, "startup-build+1").publish(config);
				const snapshot = JSON.parse(
					readFileSync(statusSnapshotPath(paths), "utf8"),
				) as { buildId: string | null };
				expect(snapshot.buildId).toBe("startup-build+1");
			} finally {
				db.close();
			}
		});
	});

	test("both snapshot producers report the same install map", async () => {
		await withTempHome((home) => {
			const env = {
				HOME: home,
				AGENT_VOICE_HOME: join(home, ".agent-voice"),
				AGENT_VOICE_EXECUTABLE: "/repo/bin/agent-voice",
			};
			const paths = resolvePaths(env);
			installPi(env);

			const built = buildAppStatusSnapshot(paths, { isPidAlive: () => false }, env);

			const config = loadConfig(paths, { createIfMissing: true });
			const db = openDb(paths.db);
			try {
				createStatusPublisher(paths, db, env).publish(config);
				const published = JSON.parse(
					readFileSync(statusSnapshotPath(paths), "utf8"),
				);
				expect(built.install).toEqual(published.install);
			} finally {
				db.close();
			}
		});
	});
});

describe("writeStatusSnapshotAtomic / clearStatusSnapshot", () => {
	test("writes status.json atomically, leaving no temp file behind", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const json = formatAppStatusJson(
				composeStatusSnapshot({
					daemon: { running: true, pid: 7 },
					queues: zeroQueues,
					config: { enabled: true, agents: emptyAgents },
					install: sampleInstall,
					paths: { home: paths.home, config: paths.config, db: paths.db },
					buildId: null,
				}),
			);
			writeStatusSnapshotAtomic(paths, json);

			const path = statusSnapshotPath(paths);
			expect(existsSync(path)).toBe(true);
			expect(readFileSync(path, "utf8")).toBe(json);
			const leftovers = readdirSync(paths.run).filter((name) =>
				name.includes(".tmp"),
			);
			expect(leftovers).toEqual([]);
		});
	});

	test("sequential writes leave the final payload", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeStatusSnapshotAtomic(paths, "first\n");
			writeStatusSnapshotAtomic(paths, "second\n");
			expect(readFileSync(statusSnapshotPath(paths), "utf8")).toBe("second\n");
		});
	});

	test("clearStatusSnapshot removes the file and is idempotent", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			writeStatusSnapshotAtomic(paths, "x\n");
			expect(existsSync(statusSnapshotPath(paths))).toBe(true);
			clearStatusSnapshot(paths);
			expect(existsSync(statusSnapshotPath(paths))).toBe(false);
			expect(() => clearStatusSnapshot(paths)).not.toThrow();
		});
	});
});
