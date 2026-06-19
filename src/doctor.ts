import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { loadConfig } from "./config";
import { getDaemonStatus, type DaemonCliDeps } from "./daemon";
import { codexHookState, codexHooksDisabled, type InstallEnv } from "./install";
import { buildKokoroStatus } from "./kokoro-setup";
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

function executableExists(commandOrPath: string): boolean {
	if (!commandOrPath) return false;
	if (commandOrPath.includes("/")) return existsSync(commandOrPath);
	return (process.env.PATH ?? "")
		.split(delimiter)
		.some((directory) => directory.length > 0 && existsSync(join(directory, commandOrPath)));
}

export function buildDoctorReport(
	paths: AgentVoicePaths,
	deps: DaemonCliDeps = {},
	env: InstallEnv = process.env as InstallEnv,
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

	const kokoroStatus = buildKokoroStatus(paths);
	checks.push({
		id: "kokoro.resourceScript.exists",
		ok: kokoroStatus.resourceScriptExists,
		severity: kokoroStatus.resourceScriptExists ? "info" : "error",
		message: kokoroStatus.resourceScriptExists
			? "Bundled Kokoro setup resource exists"
			: `Bundled Kokoro setup resource not found: ${kokoroStatus.resourceScriptPath}`,
		...(kokoroStatus.resourceScriptExists
			? {}
			: { action: "Reinstall Agent Voice or repair bundled Kokoro resources" }),
	});

	if (config) {
		const python = config.tts.python;
		const pythonExists = executableExists(python);
		checks.push({
			id: "tts.python.exists",
			ok: pythonExists,
			severity: pythonExists ? "info" : "error",
			message: pythonExists
				? "Kokoro Python executable exists"
				: python
					? `Kokoro Python executable not found: ${python}`
					: "Kokoro Python executable is not configured",
			...(pythonExists
				? {}
				: { action: "Run agent-voice kokoro setup or choose an existing Python executable" }),
		});

		const script = config.tts.kokoroScript;
		const exists = script.length > 0 && existsSync(script);
		checks.push({
			id: "tts.kokoroScript.exists",
			ok: exists,
			severity: exists ? "info" : "error",
			message: exists
				? "Kokoro script exists"
				: script
					? `Kokoro script not found: ${script}`
					: "Kokoro script is not configured",
			...(exists
				? {}
				: {
						action:
							"Open Setup to configure Kokoro, run: agent-voice kokoro setup, or run: agent-voice config set tts.kokoroScript /absolute/path/to/kokoro_tts_service.py"
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

	// Our Codex hooks.json only fires when Codex's hooks feature is enabled. If
	// the user installed the hook but disabled features.hooks in config.toml,
	// surface it — we never edit their TOML.
	if (codexHookState(env) === "installed") {
		const disabled = codexHooksDisabled(env);
		checks.push({
			id: "codex.hooks.enabled",
			ok: !disabled,
			severity: disabled ? "warning" : "info",
			message: disabled
				? "Codex hooks are disabled (features.hooks = false); the Codex voice hook will not fire"
				: "Codex hooks are enabled",
			...(disabled
				? { action: "Set features.hooks = true in ~/.codex/config.toml" }
				: {}),
		});
	}

	return { version: 1, checks };
}
