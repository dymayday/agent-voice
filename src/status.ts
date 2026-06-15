import type { AgentVoiceConfig } from "./config";
import { loadConfig } from "./config";
import { getDaemonStatus, type DaemonCliDeps, type DaemonStatus } from "./daemon";
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

function daemonState(status: DaemonStatus): AppStatusSnapshot["daemon"]["state"] {
	if (status.running) return "running";
	return status.pid ? "stale" : "stopped";
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
	const daemon = getDaemonStatus(paths, deps);
	const config = loadConfig(paths, { createIfMissing: false });
	const base: Omit<AppStatusSnapshot, "ui"> = {
		version: 1,
		daemon: {
			state: daemonState(daemon),
			running: daemon.running,
			pid: daemon.pid,
		},
		queues: daemon.queues,
		config: { enabled: config.enabled, agents: config.agents },
		paths: { home: paths.home, config: paths.config, db: paths.db },
	};
	return { ...base, ui: deriveUiState(base) };
}

export function formatAppStatusJson(snapshot: AppStatusSnapshot): string {
	return `${JSON.stringify(snapshot, null, 2)}\n`;
}
