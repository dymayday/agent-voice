import type { AgentVoiceConfig } from "./config";
import { loadConfig } from "./config";
import { getDaemonStatus, type DaemonCliDeps } from "./daemon";
import type { AgentVoicePaths } from "./paths";
import type { JobStatus } from "./store";

export interface AppStatusSnapshot {
	version: 1;
	daemon: {
		state: "running" | "stale" | "stopped";
		running: boolean;
		pid: number | null;
	};
	queues: Record<JobStatus, number>;
	config: Pick<AgentVoiceConfig, "enabled" | "agents">;
	paths: { home: string; config: string; db: string };
	ui: {
		state:
			| "ready"
			| "processing"
			| "paused"
			| "needs_attention"
			| "daemon_stopped";
		attention: string[];
	};
}

function deriveDaemonRunState(
	running: boolean,
	pid: number | null,
): AppStatusSnapshot["daemon"]["state"] {
	if (running) return "running";
	return pid ? "stale" : "stopped";
}

export interface StatusSnapshotInput {
	daemon: { running: boolean; pid: number | null };
	queues: Record<JobStatus, number>;
	config: Pick<AgentVoiceConfig, "enabled" | "agents">;
	paths: { home: string; config: string; db: string };
}

/**
 * Assemble an AppStatusSnapshot from already-known pieces, without touching the
 * filesystem. The daemon loop uses this to publish its own status from the
 * writable DB handle it already holds; `buildAppStatusSnapshot` uses it for the
 * read-only spawn path so both share one UI-state derivation.
 */
export function composeStatusSnapshot(
	input: StatusSnapshotInput,
): AppStatusSnapshot {
	const base: Omit<AppStatusSnapshot, "ui"> = {
		version: 1,
		daemon: {
			state: deriveDaemonRunState(input.daemon.running, input.daemon.pid),
			running: input.daemon.running,
			pid: input.daemon.pid,
		},
		queues: input.queues,
		config: { enabled: input.config.enabled, agents: input.config.agents },
		paths: input.paths,
	};
	return { ...base, ui: deriveUiState(base) };
}

function deriveUiState(
	snapshot: Omit<AppStatusSnapshot, "ui">,
): AppStatusSnapshot["ui"] {
	const attention: string[] = [];
	if (!snapshot.config.enabled) attention.push("system_paused");
	if (snapshot.queues.failed > 0) attention.push("failed_jobs");
	if (snapshot.daemon.state === "stale") attention.push("stale_daemon_lock");

	if (!snapshot.config.enabled) return { state: "paused", attention };
	if (attention.length > 0) return { state: "needs_attention", attention };
	if (snapshot.daemon.state === "stopped") {
		return { state: "daemon_stopped", attention };
	}
	if (snapshot.queues.processing > 0) {
		return { state: "processing", attention };
	}
	return { state: "ready", attention };
}

export function buildAppStatusSnapshot(
	paths: AgentVoicePaths,
	deps: DaemonCliDeps = {},
): AppStatusSnapshot {
	const daemon = getDaemonStatus(paths, deps, { readOnly: true });
	const config = loadConfig(paths, { createIfMissing: false });
	return composeStatusSnapshot({
		daemon: { running: daemon.running, pid: daemon.pid },
		queues: daemon.queues,
		config: { enabled: config.enabled, agents: config.agents },
		paths: { home: paths.home, config: paths.config, db: paths.db },
	});
}

export function formatAppStatusJson(snapshot: AppStatusSnapshot): string {
	return `${JSON.stringify(snapshot, null, 2)}\n`;
}
