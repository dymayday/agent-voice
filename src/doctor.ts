import { existsSync } from "node:fs";
import { loadConfig } from "./config";
import { getDaemonStatus, type DaemonCliDeps } from "./daemon";
import type { AgentVoicePaths } from "./paths";

export interface DoctorCheck {
	id: string;
	ok: boolean;
	severity: "info" | "warning" | "error";
	message: string;
	action?: string;
}

export interface DoctorReport {
	version: 1;
	checks: DoctorCheck[];
}

export function buildDoctorReport(
	paths: AgentVoicePaths,
	deps: DaemonCliDeps = {},
): DoctorReport {
	const checks: DoctorCheck[] = [];
	const configExists = existsSync(paths.config);
	let config;
	try {
		config = loadConfig(paths, { createIfMissing: false });
		checks.push({
			id: "config.load",
			ok: configExists,
			severity: configExists ? "info" : "warning",
			message: configExists
				? "Config loaded"
				: "Config file not found; using defaults",
			...(configExists ? {} : { action: "Open setup to create config.json" }),
		});
	} catch (error) {
		checks.push({
			id: "config.load",
			ok: false,
			severity: "error",
			message: error instanceof Error ? error.message : String(error),
			action: "Open setup and repair config.json",
		});
	}

	if (config) {
		const exists = existsSync(config.tts.kokoroScript);
		checks.push({
			id: "tts.kokoroScript.exists",
			ok: exists,
			severity: exists ? "info" : "error",
			message: exists
				? "Kokoro script exists"
				: `Kokoro script not found: ${config.tts.kokoroScript}`,
			...(exists
				? {}
				: {
						action:
							"Run: agent-voice config set tts.kokoroScript /absolute/path/to/kokoro_tts_service.py",
					}),
		});
	}

	const daemon = getDaemonStatus(paths, deps, { readOnly: true });
	checks.push({
		id: "daemon.running",
		ok: daemon.running,
		severity: daemon.running ? "info" : "warning",
		message: daemon.running
			? `Daemon running pid=${daemon.pid}`
			: "Daemon is not running",
		...(daemon.running ? {} : { action: "Start daemon" }),
	});

	checks.push({
		id: "queue.failed.empty",
		ok: daemon.queues.failed === 0,
		severity: daemon.queues.failed === 0 ? "info" : "warning",
		message: `${daemon.queues.failed} failed jobs`,
		...(daemon.queues.failed === 0
			? {}
			: { action: "Open dashboard failed jobs" }),
	});

	return { version: 1, checks };
}
