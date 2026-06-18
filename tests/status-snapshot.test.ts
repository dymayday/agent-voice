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
import { loadConfig, type AgentVoiceConfig } from "../src/config";
import {
	clearStatusSnapshot,
	statusSnapshotPath,
	writeStatusSnapshotAtomic,
} from "../src/daemon";
import { resolvePaths } from "../src/paths";
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

describe("composeStatusSnapshot", () => {
	test("derives a running daemon snapshot from explicit inputs", () => {
		const snapshot = composeStatusSnapshot({
			daemon: { running: true, pid: 4321 },
			queues: { ...zeroQueues, processing: 1 },
			config: { enabled: true, agents: emptyAgents },
			paths: { home: "/h", config: "/h/config.json", db: "/h/queue.db" },
		});
		expect(snapshot.version).toBe(1);
		expect(snapshot.daemon).toEqual({ state: "running", running: true, pid: 4321 });
		expect(snapshot.ui.state).toBe("processing");
		expect(snapshot.ui.attention).toEqual([]);
	});

	test("derives stale vs stopped from pid when not running", () => {
		const stale = composeStatusSnapshot({
			daemon: { running: false, pid: 99 },
			queues: zeroQueues,
			config: { enabled: true, agents: emptyAgents },
			paths: { home: "/h", config: "/h/config.json", db: "/h/queue.db" },
		});
		expect(stale.daemon.state).toBe("stale");
		expect(stale.ui.attention).toContain("stale_daemon_lock");

		const stopped = composeStatusSnapshot({
			daemon: { running: false, pid: null },
			queues: zeroQueues,
			config: { enabled: true, agents: emptyAgents },
			paths: { home: "/h", config: "/h/config.json", db: "/h/queue.db" },
		});
		expect(stopped.daemon.state).toBe("stopped");
		expect(stopped.ui.state).toBe("daemon_stopped");
	});

	test("buildAppStatusSnapshot delegates to composeStatusSnapshot (byte-identical)", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			// No daemon, no db file: getDaemonStatus(readOnly) -> stopped + zero queues.
			const built = buildAppStatusSnapshot(paths, { isPidAlive: () => false });
			const config = loadConfig(paths, { createIfMissing: false });
			const composed = composeStatusSnapshot({
				daemon: { running: false, pid: null },
				queues: zeroQueues,
				config: { enabled: config.enabled, agents: config.agents },
				paths: { home: paths.home, config: paths.config, db: paths.db },
			});
			expect(formatAppStatusJson(composed)).toBe(formatAppStatusJson(built));
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
					paths: { home: paths.home, config: paths.config, db: paths.db },
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
