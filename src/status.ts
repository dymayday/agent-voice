import type { AgentVoiceConfig, AgentName } from "./config";
import { loadConfig } from "./config";
import { getDaemonStatus, type DaemonCliDeps } from "./daemon";
import type { AgentVoicePaths } from "./paths";
import type { JobStatus } from "./store";
import type { AgentInstallState, InstallEnv } from "./install";
import { detectAgentInstallStates } from "./install";
import { readBuildId } from "./build-info";

/** The config fields the status snapshot exposes (deriveUiState reads `enabled`). */
export type StatusConfigView = Pick<AgentVoiceConfig, "enabled" | "agents">;
/** The path fields the status snapshot exposes. */
export type StatusPaths = { home: string; config: string; db: string };

export interface AppStatusSnapshot {
	version: 1;
	/**
	 * Build id the code producing this snapshot was started with, or `null` when
	 * unstamped (dev / source tree). The daemon captures this once at startup, so
	 * a long-running daemon keeps reporting its original build id even after the
	 * bundle on disk is rebuilt — that skew is exactly what the app uses to detect
	 * a stale daemon and restart it.
	 */
	buildId: string | null;
	daemon: {
		state: "running" | "stale" | "stopped";
		running: boolean;
		pid: number | null;
	};
	queues: Record<JobStatus, number>;
	config: StatusConfigView;
	install: Record<AgentName, AgentInstallState>;
	paths: StatusPaths;
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
	config: StatusConfigView;
	install: Record<AgentName, AgentInstallState>;
	paths: StatusPaths;
	buildId: string | null;
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
		buildId: input.buildId,
		daemon: {
			state: deriveDaemonRunState(input.daemon.running, input.daemon.pid),
			running: input.daemon.running,
			pid: input.daemon.pid,
		},
		queues: input.queues,
		// Pass the views straight through: callers that hold a full AgentVoiceConfig
		// narrow to StatusConfigView at the boundary (buildAppStatusSnapshot,
		// createStatusPublisher), so there is nothing extra to strip here.
		config: input.config,
		install: input.install,
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
	env: InstallEnv = process.env as InstallEnv,
): AppStatusSnapshot {
	const daemon = getDaemonStatus(paths, deps, { readOnly: true });
	const config = loadConfig(paths, { createIfMissing: false });
	return composeStatusSnapshot({
		daemon: { running: daemon.running, pid: daemon.pid },
		queues: daemon.queues,
		config: { enabled: config.enabled, agents: config.agents },
		install: detectAgentInstallStates(env),
		paths: { home: paths.home, config: paths.config, db: paths.db },
		// Read fresh: this read-only spawn path runs in a brand-new process, so the
		// build id always reflects the current on-disk build (never stale).
		buildId: readBuildId(),
	});
}

export function formatAppStatusJson(snapshot: AppStatusSnapshot): string {
	return `${JSON.stringify(snapshot, null, 2)}\n`;
}
