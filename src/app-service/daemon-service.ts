import {
	getDaemonStatus,
	startDaemon,
	stopDaemon,
	type DaemonCliDeps,
} from "../daemon";
import type { AgentVoicePaths } from "../paths";
import { fail, ok } from "./errors";
import type { AppServiceResult } from "./types";

export interface DaemonActionResult {
	running: boolean;
	pid: number | null;
}

function messageFromError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function startFailureCode(reason: string): "CONFLICT" | "INTERNAL" {
	return reason.toLowerCase().includes("already running")
		? "CONFLICT"
		: "INTERNAL";
}

export async function startDaemonService(
	paths: AgentVoicePaths,
	deps: DaemonCliDeps = {},
): Promise<AppServiceResult<DaemonActionResult>> {
	try {
		const started = await startDaemon(paths, deps);
		if (!started.ok) {
			return fail(startFailureCode(started.reason), started.reason);
		}

		const status = getDaemonStatus(paths, deps, { readOnly: true });
		return ok({
			running: status.running,
			pid: status.running ? status.pid : null,
		});
	} catch (error) {
		return fail("INTERNAL", messageFromError(error));
	}
}

export async function stopDaemonService(
	paths: AgentVoicePaths,
	deps: DaemonCliDeps = {},
): Promise<AppServiceResult<DaemonActionResult>> {
	try {
		await stopDaemon(paths, deps);
		const status = getDaemonStatus(paths, deps, { readOnly: true });
		return ok({
			running: status.running,
			pid: status.running ? status.pid : null,
		});
	} catch (error) {
		return fail("INTERNAL", messageFromError(error));
	}
}
