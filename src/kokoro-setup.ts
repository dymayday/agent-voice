import { copyFileSync, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { loadConfig, saveConfig, type AgentVoiceConfig } from "./config";
import {
	assertManagedRoot,
	assertSafeManagedDirectoryTarget,
	assertSafeOverwrite,
	defaultResourceRoot,
	ensureManagedDirectory,
	kokoroHuggingFaceHome,
	kokoroManagedBin,
	kokoroManagedHome,
	kokoroManagedPython,
	kokoroManagedScript,
	kokoroModelsHome,
	kokoroSetupLockPath,
	resourceRequirementsPath,
	resourceScriptPath,
} from "./kokoro/managed-paths";
import {
	DEFAULT_COMMAND_TIMEOUT_MS,
	runChecked,
} from "./kokoro/commands";
import {
	createReadableLineReader,
	isKokoroAudioMessage,
	readKokoroMessageBeforeDeadline,
	type KokoroMessage,
} from "./kokoro/protocol";
import { acquireSetupLock } from "./kokoro/setup-lock";
import {
	resolveUvCommand,
	resolveUvRelease,
	runUvChecked,
	type UvReleaseAsset,
} from "./kokoro/uv-installer";
import type { AgentVoicePaths } from "./paths";

export {
	kokoroManagedHome,
	kokoroManagedPython,
	kokoroManagedScript,
	kokoroManagedUv,
	kokoroSetupLockPath,
} from "./kokoro/managed-paths";
export type { UvReleaseAsset } from "./kokoro/uv-installer";

export type KokoroSetupStepId =
	| "prepare"
	| "uv-check"
	| "script"
	| "venv"
	| "deps"
	| "model"
	| "config"
	| "smoke-test";

export type KokoroSetupStepStatus =
	| "pending"
	| "running"
	| "done"
	| "failed"
	| "skipped";

export type KokoroSetupEvent =
	| {
			type: "step";
			id: KokoroSetupStepId;
			status: KokoroSetupStepStatus;
			title: string;
			error?: string;
	  }
	| { type: "log"; stream: "stdout" | "stderr"; message: string }
	| { type: "complete"; ok: boolean; error?: string };

export type KokoroSetupRunResult =
	| { ok: true; pythonPath: string; scriptPath: string }
	| { ok: false; error: string };

export interface KokoroSetupDeps {
	commandExists(command: string): Promise<boolean>;
	run(request: {
		cmd: string;
		args: string[];
		cwd?: string;
		env?: Record<string, string>;
		timeoutMs?: number;
	}): Promise<{
		ok: boolean;
		stdout?: string;
		stderr?: string;
		exitCode?: number;
	}>;
	smokeTest(
		pythonPath: string,
		scriptPath: string,
		env: Record<string, string>,
	): Promise<{ ok: boolean; error?: string }>;
}

export interface KokoroSetupOptions {
	deps?: KokoroSetupDeps;
	emit?: (event: KokoroSetupEvent) => void;
	resourceRoot?: string;
	uvRelease?: UvReleaseAsset;
}

export interface KokoroStatusOptions {
	resourceRoot?: string;
}

export interface KokoroManagedStatus {
	managedHome: string;
	installed: boolean;
	scriptPath: string;
	pythonPath: string;
	resourceScriptPath: string;
	resourceScriptExists: boolean;
	lockPath: string;
	checks: Array<{ id: string; ok: boolean; message: string }>;
}

export const KOKORO_SETUP_STEP_IDS: readonly KokoroSetupStepId[] = [
	"prepare",
	"uv-check",
	"script",
	"venv",
	"deps",
	"model",
	"smoke-test",
	"config",
];

const STEP_TITLES: Record<KokoroSetupStepId, string> = {
	prepare: "Preparing install directory",
	"uv-check": "Preparing uv",
	script: "Installing Kokoro service script",
	venv: "Creating Python environment",
	deps: "Installing Python dependencies",
	model: "Preloading Kokoro model assets",
	"smoke-test": "Verifying Kokoro service",
	config: "Saving Agent Voice config",
};

const DEFAULT_SMOKE_TEST_TIMEOUT_MS = 60 * 1000;
const KOKORO_REPO_ID = "hexgrad/Kokoro-82M";
const SMOKE_TEST_TEXT = "Agent Voice Kokoro setup smoke test.";
const KOKORO_WARNING_FILTERS = [
	"ignore:dropout option adds dropout after all but last recurrent layer:UserWarning:torch.nn.modules.rnn",
	"ignore::FutureWarning:torch.nn.utils.weight_norm",
];

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function emitStep(
	emit: (event: KokoroSetupEvent) => void,
	id: KokoroSetupStepId,
	status: KokoroSetupStepStatus,
	error?: string,
): void {
	emit({
		type: "step",
		id,
		status,
		title: STEP_TITLES[id],
		...(error ? { error } : {}),
	});
}

async function runStep<T>(
	emit: (event: KokoroSetupEvent) => void,
	id: KokoroSetupStepId,
	action: () => T | Promise<T>,
): Promise<T> {
	emitStep(emit, id, "running");
	try {
		const value = await action();
		emitStep(emit, id, "done");
		return value;
	} catch (error) {
		const message = errorMessage(error);
		emitStep(emit, id, "failed", message);
		throw error;
	}
}

export function buildKokoroStatus(
	paths: AgentVoicePaths,
	options: KokoroStatusOptions = {},
): KokoroManagedStatus {
	const managedHome = kokoroManagedHome(paths);
	const scriptPath = kokoroManagedScript(paths);
	const pythonPath = kokoroManagedPython(paths);
	const scriptExists = existsSync(scriptPath);
	const pythonExists = existsSync(pythonPath);
	const resourceRoot = options.resourceRoot ?? defaultResourceRoot();
	const bundledScriptPath = resourceScriptPath(resourceRoot);
	const resourceScriptExists = existsSync(bundledScriptPath);
	const lockPath = kokoroSetupLockPath(paths);

	return {
		managedHome,
		installed: scriptExists && pythonExists,
		scriptPath,
		pythonPath,
		resourceScriptPath: bundledScriptPath,
		resourceScriptExists,
		lockPath,
		checks: [
			{
				id: "managedHome.exists",
				ok: existsSync(managedHome),
				message: managedHome,
			},
			{
				id: "resourceScript.exists",
				ok: resourceScriptExists,
				message: bundledScriptPath,
			},
			{ id: "script.exists", ok: scriptExists, message: scriptPath },
			{ id: "python.exists", ok: pythonExists, message: pythonPath },
			{
				id: "setupLock.absent",
				ok: !existsSync(lockPath),
				message: lockPath,
			},
		],
	};
}

async function commandExists(command: string): Promise<boolean> {
	if (!/^[a-zA-Z0-9._-]+$/.test(command)) return false;
	const proc = Bun.spawn(["/usr/bin/env", "which", command], {
		stdout: "pipe",
		stderr: "pipe",
	});
	return (await proc.exited) === 0;
}

async function streamToText(
	stream: ReadableStream<Uint8Array> | number | undefined,
): Promise<string> {
	if (!stream || typeof stream === "number") return "";
	return await new Response(stream).text();
}

async function run(request: {
	cmd: string;
	args: string[];
	cwd?: string;
	env?: Record<string, string>;
	timeoutMs?: number;
}): Promise<{
	ok: boolean;
	stdout?: string;
	stderr?: string;
	exitCode?: number;
}> {
	const timeoutMs = request.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
	let timedOut = false;
	const proc = Bun.spawn([request.cmd, ...request.args], {
		...(request.cwd ? { cwd: request.cwd } : {}),
		env: { ...process.env, ...(request.env ?? {}) },
		stdout: "pipe",
		stderr: "pipe",
	});

	const timeout = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, timeoutMs);

	try {
		const [exitCode, stdout, stderr] = await Promise.all([
			proc.exited,
			streamToText(proc.stdout),
			streamToText(proc.stderr),
		]);
		return {
			ok: exitCode === 0 && !timedOut,
			stdout,
			stderr: timedOut ? `Command timed out after ${timeoutMs}ms` : stderr,
			exitCode,
		};
	} finally {
		clearTimeout(timeout);
	}
}

export async function testKokoroService(
	pythonPath: string,
	scriptPath: string,
	env: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
	const proc = Bun.spawn([pythonPath, scriptPath], {
		env: { ...process.env, ...env },
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = proc.stdout;
	if (!stdout || typeof stdout === "number") {
		proc.kill();
		return { ok: false, error: "Kokoro smoke-test stdout is not readable" };
	}

	const stderrText = streamToText(proc.stderr);
	const session = {
		readLine: createReadableLineReader(stdout),
		readStderr: async () => await stderrText,
	};

	try {
		const readyDeadline = Date.now() + DEFAULT_SMOKE_TEST_TIMEOUT_MS;
		while (true) {
			const message = await readKokoroMessageBeforeDeadline(
				session,
				readyDeadline,
				"ready",
			);
			if (message.kind === "error") return { ok: false, error: message.error };
			if (message.kind === "status" && message.status === "ready") break;
		}

		const stdin = proc.stdin;
		if (!stdin || typeof stdin === "number") {
			return { ok: false, error: "Kokoro smoke-test stdin is not writable" };
		}
		stdin.write(`${JSON.stringify({ text: SMOKE_TEST_TEXT })}\n`);
		stdin.end();

		const audioDeadline = Date.now() + DEFAULT_SMOKE_TEST_TIMEOUT_MS;
		while (true) {
			const message: KokoroMessage = await readKokoroMessageBeforeDeadline(
				session,
				audioDeadline,
				"audio",
			);
			if (message.kind === "error") return { ok: false, error: message.error };
			if (isKokoroAudioMessage(message, { requireDuration: true })) {
				return { ok: true };
			}
			if (message.kind === "status") continue;
			return {
				ok: false,
				error: "Invalid Kokoro smoke-test audio response",
			};
		}
	} catch (error) {
		return { ok: false, error: errorMessage(error) };
	} finally {
		try {
			const stdin = proc.stdin;
			if (stdin && typeof stdin !== "number") stdin.end();
		} catch {
			// Best effort cleanup only.
		}
		try {
			proc.kill();
		} catch {
			// Best effort cleanup only.
		}
	}
}

const defaultDeps: KokoroSetupDeps = {
	commandExists,
	run,
	smokeTest: testKokoroService,
};

function kokoroPythonWarnings(): string {
	const existing = process.env.PYTHONWARNINGS?.trim();
	const filters = KOKORO_WARNING_FILTERS.join(",");
	return existing ? `${existing},${filters}` : filters;
}

function kokoroChildEnv(paths: AgentVoicePaths): Record<string, string> {
	const virtualEnv = join(kokoroManagedHome(paths), ".venv");
	const pathEntries = [
		join(virtualEnv, "bin"),
		kokoroManagedBin(paths),
		process.env.PATH ?? "",
	].filter((entry) => entry.length > 0);
	return {
		HF_HOME: kokoroHuggingFaceHome(paths),
		HF_HUB_VERBOSITY: process.env.HF_HUB_VERBOSITY || "error",
		KOKORO_REPO_ID: process.env.KOKORO_REPO_ID ?? KOKORO_REPO_ID,
		KOKORO_REPO_REVISION: process.env.KOKORO_REPO_REVISION ?? "",
		PATH: pathEntries.join(delimiter),
		PYTHONUNBUFFERED: "1",
		PYTHONWARNINGS: kokoroPythonWarnings(),
		VIRTUAL_ENV: virtualEnv,
	};
}

function hasManagedPython(paths: AgentVoicePaths): boolean {
	return existsSync(kokoroManagedPython(paths));
}

function preflightLocalSetupInputs(
	paths: AgentVoicePaths,
	resourceRoot: string,
	managedHome: string,
	scriptPath: string,
): void {
	const sourceScript = resourceScriptPath(resourceRoot);
	const requirements = resourceRequirementsPath(resourceRoot);
	if (!existsSync(sourceScript)) {
		throw new Error(`Bundled Kokoro service script not found: ${sourceScript}`);
	}
	if (!existsSync(requirements)) {
		throw new Error(`Bundled Kokoro requirements not found: ${requirements}`);
	}
	assertSafeOverwrite(paths, scriptPath);
	assertSafeManagedDirectoryTarget(paths, join(managedHome, ".venv"));
}

function preloadCode(): string {
	return [
		"import os",
		"from kokoro import KPipeline",
		'kwargs = {"lang_code": "a", "repo_id": os.environ.get("KOKORO_REPO_ID", "hexgrad/Kokoro-82M")}',
		'if os.environ.get("KOKORO_REPO_REVISION"): kwargs["revision"] = os.environ["KOKORO_REPO_REVISION"]',
		"KPipeline(**kwargs)",
		'print("kokoro model ready")',
	].join("\n");
}

function stageConfig(
	paths: AgentVoicePaths,
	pythonPath: string,
	scriptPath: string,
): AgentVoiceConfig {
	const current = loadConfig(paths, { createIfMissing: false });
	return {
		...current,
		tts: {
			...current.tts,
			python: pythonPath,
			kokoroScript: scriptPath,
		},
	};
}

export async function runKokoroSetup(
	paths: AgentVoicePaths,
	options: KokoroSetupOptions = {},
): Promise<KokoroSetupRunResult> {
	const deps = options.deps ?? defaultDeps;
	const emit = options.emit ?? (() => {});
	const resourceRoot = options.resourceRoot ?? defaultResourceRoot();
	const managedHome = kokoroManagedHome(paths);
	const scriptPath = kokoroManagedScript(paths);
	const pythonPath = kokoroManagedPython(paths);
	const sourceScript = resourceScriptPath(resourceRoot);
	const requirements = resourceRequirementsPath(resourceRoot);
	const childEnv = kokoroChildEnv(paths);
	const uvRelease = resolveUvRelease(options.uvRelease);
	let uvCommand = "uv";
	let releaseLock: (() => void) | undefined;

	try {
		releaseLock = acquireSetupLock(paths);

		await runStep(emit, "prepare", () => {
			assertManagedRoot(paths);
			ensureManagedDirectory(paths, kokoroModelsHome(paths));
			ensureManagedDirectory(paths, kokoroHuggingFaceHome(paths));
			preflightLocalSetupInputs(paths, resourceRoot, managedHome, scriptPath);
		});

		uvCommand = await runStep(emit, "uv-check", async () =>
			resolveUvCommand(paths, deps, emit, uvRelease),
		);

		await runStep(emit, "script", () => {
			copyFileSync(sourceScript, scriptPath);
		});

		if (hasManagedPython(paths)) {
			emitStep(emit, "venv", "skipped");
		} else {
			await runStep(emit, "venv", async () => {
				await runUvChecked(paths, deps, emit, uvCommand, {
					args: ["venv", ".venv"],
					cwd: managedHome,
					timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
				});
			});
		}

		await runStep(emit, "deps", async () => {
			await runUvChecked(paths, deps, emit, uvCommand, {
				args: [
					"pip",
					"install",
					"--quiet",
					"--python",
					pythonPath,
					"-r",
					requirements,
				],
				cwd: managedHome,
				timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
			});
		});

		await runStep(emit, "model", async () => {
			emit({
				type: "log",
				stream: "stdout",
				message:
					"Downloading Kokoro model assets; first run can take several minutes.",
			});
			await runChecked(deps, emit, {
				cmd: pythonPath,
				args: ["-c", preloadCode()],
				cwd: managedHome,
				env: childEnv,
				timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
			});
		});

		await runStep(emit, "smoke-test", async () => {
			const smoke = await deps.smokeTest(pythonPath, scriptPath, childEnv);
			if (!smoke.ok) {
				throw new Error(smoke.error ?? "Kokoro smoke test failed");
			}
		});

		await runStep(emit, "config", () => {
			saveConfig(paths, stageConfig(paths, pythonPath, scriptPath));
		});
		const outcome: KokoroSetupRunResult = { ok: true, pythonPath, scriptPath };
		emit({ type: "complete", ok: true });
		return outcome;
	} catch (error) {
		const message = errorMessage(error);
		emit({ type: "complete", ok: false, error: message });
		return { ok: false, error: message };
	} finally {
		if (releaseLock) releaseLock();
	}
}
