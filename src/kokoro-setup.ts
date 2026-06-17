import {
	closeSync,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig, saveConfig, type AgentVoiceConfig } from "./config";
import type { AgentVoicePaths } from "./paths";

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

export interface KokoroSetupRunResult {
	ok: boolean;
	error?: string;
	pythonPath?: string;
	scriptPath?: string;
}

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
	"uv-check": "Checking uv",
	script: "Installing Kokoro service script",
	venv: "Creating Python environment",
	deps: "Installing Python dependencies",
	model: "Preloading Kokoro model assets",
	"smoke-test": "Verifying Kokoro service",
	config: "Saving Agent Voice config",
};

const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_SMOKE_TEST_TIMEOUT_MS = 60 * 1000;
const KOKORO_REPO_ID = "hexgrad/Kokoro-82M";
const SMOKE_TEST_TEXT = "Agent Voice Kokoro setup smoke test.";

export function kokoroManagedHome(paths: AgentVoicePaths): string {
	return join(paths.home, "kokoro");
}

export function kokoroManagedScript(paths: AgentVoicePaths): string {
	return join(kokoroManagedHome(paths), "kokoro_tts_service.py");
}

export function kokoroManagedPython(paths: AgentVoicePaths): string {
	return join(kokoroManagedHome(paths), ".venv", "bin", "python");
}

export function kokoroSetupLockPath(paths: AgentVoicePaths): string {
	return join(kokoroManagedHome(paths), "setup.lock");
}

function kokoroModelsHome(paths: AgentVoicePaths): string {
	return join(kokoroManagedHome(paths), "models");
}

function kokoroHuggingFaceHome(paths: AgentVoicePaths): string {
	return join(kokoroModelsHome(paths), "huggingface");
}

function defaultResourceRoot(): string {
	return resolve(import.meta.dir, "..", "resources", "kokoro");
}

function resourcePath(root: string, ...parts: string[]): string {
	return resolve(root, ...parts);
}

function resourceScriptPath(root: string): string {
	return resourcePath(root, "kokoro_tts_service.py");
}

function resourceRequirementsPath(root: string): string {
	return resourcePath(root, "requirements.txt");
}

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

function assertManagedChild(paths: AgentVoicePaths, target: string): void {
	const home = resolve(kokoroManagedHome(paths));
	const resolved = resolve(target);
	if (resolved !== home && !resolved.startsWith(`${home}/`)) {
		throw new Error(`Refusing to write outside managed Kokoro home: ${target}`);
	}
}

function lstatIfExists(path: string): ReturnType<typeof lstatSync> | undefined {
	try {
		return lstatSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function assertExistingPathSafe(path: string): void {
	const stat = lstatIfExists(path);
	if (!stat) return;
	if (stat.isSymbolicLink()) {
		throw new Error(`Refusing to use unsafe managed path: ${path}`);
	}
}

function assertManagedRoot(paths: AgentVoicePaths): void {
	const managedHome = kokoroManagedHome(paths);
	assertManagedChild(paths, managedHome);
	const stat = lstatIfExists(managedHome);
	if (stat) {
		if (stat.isSymbolicLink() || !stat.isDirectory()) {
			throw new Error(`Refusing to use unsafe managed path: ${managedHome}`);
		}
		return;
	}
	mkdirSync(managedHome, { recursive: true });
}

function assertSafeOverwrite(paths: AgentVoicePaths, target: string): void {
	assertManagedChild(paths, target);
	const stat = lstatIfExists(target);
	if (!stat) return;
	if (stat.isSymbolicLink() || !stat.isFile()) {
		throw new Error(`Refusing to overwrite unsafe managed path: ${target}`);
	}
}

function ensureManagedDirectory(paths: AgentVoicePaths, target: string): void {
	assertManagedChild(paths, target);
	assertExistingPathSafe(target);
	const stat = lstatIfExists(target);
	if (stat) {
		if (!stat.isDirectory()) {
			throw new Error(`Refusing to use unsafe managed path: ${target}`);
		}
		return;
	}
	mkdirSync(target, { recursive: true });
}

function assertSafeManagedDirectoryTarget(
	paths: AgentVoicePaths,
	target: string,
): void {
	assertManagedChild(paths, target);
	const stat = lstatIfExists(target);
	if (!stat) return;
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error(`Refusing to use unsafe managed path: ${target}`);
	}
}

function processExists(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ESRCH") return false;
		if (code === "EPERM") return true;
		return true;
	}
}

function removeStaleSetupLock(lockPath: string): boolean {
	const stat = lstatIfExists(lockPath);
	if (!stat || stat.isSymbolicLink() || !stat.isFile()) return false;

	const pidText = readFileSync(lockPath, "utf8").trim();
	if (!pidText) {
		rmSync(lockPath, { force: true });
		return true;
	}

	const pid = Number(pidText);
	if (!Number.isInteger(pid) || processExists(pid)) return false;

	rmSync(lockPath, { force: true });
	return true;
}

function openSetupLock(lockPath: string): number {
	try {
		return openSync(lockPath, "wx");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "EEXIST") {
			throw new Error(
				"Kokoro setup is already running for this Agent Voice home",
			);
		}
		throw error;
	}
}

function acquireSetupLock(paths: AgentVoicePaths): () => void {
	assertManagedRoot(paths);
	const lockPath = kokoroSetupLockPath(paths);
	assertManagedChild(paths, lockPath);
	let fd: number;
	try {
		fd = openSetupLock(lockPath);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.includes("already running") &&
			removeStaleSetupLock(lockPath)
		) {
			fd = openSetupLock(lockPath);
		} else {
			throw error;
		}
	}

	let closed = false;
	try {
		writeFileSync(fd, `${process.pid}\n`, "utf8");
	} catch (error) {
		closeSync(fd);
		rmSync(lockPath, { force: true });
		throw error;
	}

	return () => {
		if (!closed) {
			closed = true;
			closeSync(fd);
		}
		rmSync(lockPath, { force: true });
	};
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

interface KokoroServiceMessage {
	status?: string;
	error?: string;
	audio?: unknown;
	duration?: unknown;
}

function parseServiceLine(line: string): KokoroServiceMessage | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	const parsed = JSON.parse(trimmed) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid Kokoro smoke-test response: ${trimmed}`);
	}
	return parsed as KokoroServiceMessage;
}

async function readServiceLine(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	buffer: { value: string },
	decoder: TextDecoder,
): Promise<string | null> {
	while (true) {
		const newlineIndex = buffer.value.indexOf("\n");
		if (newlineIndex !== -1) {
			const line = buffer.value.slice(0, newlineIndex);
			buffer.value = buffer.value.slice(newlineIndex + 1);
			return line;
		}

		const chunk = await reader.read();
		if (chunk.done) {
			if (!buffer.value) return null;
			const line = buffer.value;
			buffer.value = "";
			return line;
		}
		buffer.value += decoder.decode(chunk.value, { stream: true });
	}
}

async function readServiceMessage(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	buffer: { value: string },
	decoder: TextDecoder,
	timeoutMessage: string,
): Promise<KokoroServiceMessage | null> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const line = await Promise.race([
			readServiceLine(reader, buffer, decoder),
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(
					() => reject(new Error(timeoutMessage)),
					DEFAULT_SMOKE_TEST_TIMEOUT_MS,
				);
			}),
		]);
		return line === null ? null : parseServiceLine(line);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

function isSmokeTestAudio(message: KokoroServiceMessage): boolean {
	return (
		typeof message.audio === "string" &&
		message.audio.length > 0 &&
		typeof message.duration === "number" &&
		Number.isFinite(message.duration) &&
		message.duration >= 0
	);
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
	const reader = stdout.getReader();
	const decoder = new TextDecoder();
	const buffer = { value: "" };

	try {
		while (true) {
			const message = await readServiceMessage(
				reader,
				buffer,
				decoder,
				"Timed out waiting for Kokoro ready",
			);
			if (message === null) {
				const stderr = (await stderrText).trim();
				return {
					ok: false,
					error: stderr
						? `Kokoro exited before ready: ${stderr}`
						: "Kokoro exited before ready",
				};
			}
			if (message.error) return { ok: false, error: message.error };
			if (message.status === "ready") break;
		}

		const stdin = proc.stdin;
		if (!stdin || typeof stdin === "number") {
			return { ok: false, error: "Kokoro smoke-test stdin is not writable" };
		}
		stdin.write(`${JSON.stringify({ text: SMOKE_TEST_TEXT })}\n`);
		stdin.end();

		while (true) {
			const message = await readServiceMessage(
				reader,
				buffer,
				decoder,
				"Timed out waiting for Kokoro audio",
			);
			if (message === null) {
				const stderr = (await stderrText).trim();
				return {
					ok: false,
					error: stderr
						? `Kokoro exited before audio: ${stderr}`
						: "Kokoro exited before audio",
				};
			}
			if (message.error) return { ok: false, error: message.error };
			if (isSmokeTestAudio(message)) return { ok: true };
			if (message.status) continue;
			return {
				ok: false,
				error: "Invalid Kokoro smoke-test audio response",
			};
		}
	} catch (error) {
		return { ok: false, error: errorMessage(error) };
	} finally {
		try {
			reader.releaseLock();
		} catch {
			// Best effort cleanup only.
		}
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

function emitLogs(
	emit: (event: KokoroSetupEvent) => void,
	stream: "stdout" | "stderr",
	text: string | undefined,
): void {
	if (!text) return;
	for (const line of text.split(/\r?\n/)) {
		if (line.length > 0) emit({ type: "log", stream, message: line });
	}
}

function commandDescription(cmd: string, args: string[]): string {
	return [cmd, ...args].join(" ");
}

async function runChecked(
	deps: KokoroSetupDeps,
	emit: (event: KokoroSetupEvent) => void,
	request: Parameters<KokoroSetupDeps["run"]>[0],
): Promise<void> {
	const outcome = await deps.run(request);
	emitLogs(emit, "stdout", outcome.stdout);
	emitLogs(emit, "stderr", outcome.stderr);
	if (!outcome.ok) {
		const details = (outcome.stderr || outcome.stdout || "").trim();
		throw new Error(
			`${commandDescription(request.cmd, request.args)} failed${
				details ? `: ${details}` : ""
			}`,
		);
	}
}

function kokoroChildEnv(paths: AgentVoicePaths): Record<string, string> {
	return {
		HF_HOME: kokoroHuggingFaceHome(paths),
		KOKORO_REPO_ID: process.env.KOKORO_REPO_ID ?? KOKORO_REPO_ID,
		KOKORO_REPO_REVISION: process.env.KOKORO_REPO_REVISION ?? "",
		PYTHONUNBUFFERED: "1",
	};
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
	let releaseLock: (() => void) | undefined;

	try {
		releaseLock = acquireSetupLock(paths);

		await runStep(emit, "prepare", () => {
			assertManagedRoot(paths);
			ensureManagedDirectory(paths, kokoroModelsHome(paths));
			ensureManagedDirectory(paths, kokoroHuggingFaceHome(paths));
		});

		await runStep(emit, "uv-check", async () => {
			if (!(await deps.commandExists("uv"))) {
				throw new Error(
					"uv is required for automatic Kokoro setup. Install uv, then rerun agent-voice kokoro setup.",
				);
			}
		});

		await runStep(emit, "script", () => {
			if (!existsSync(sourceScript)) {
				throw new Error(
					`Bundled Kokoro service script not found: ${sourceScript}`,
				);
			}
			assertSafeOverwrite(paths, scriptPath);
			copyFileSync(sourceScript, scriptPath);
		});

		await runStep(emit, "venv", async () => {
			assertSafeManagedDirectoryTarget(paths, join(managedHome, ".venv"));
			await runChecked(deps, emit, {
				cmd: "uv",
				args: ["venv", ".venv"],
				cwd: managedHome,
				timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
			});
		});

		await runStep(emit, "deps", async () => {
			if (!existsSync(requirements)) {
				throw new Error(
					`Bundled Kokoro requirements not found: ${requirements}`,
				);
			}
			await runChecked(deps, emit, {
				cmd: "uv",
				args: ["pip", "install", "--python", pythonPath, "-r", requirements],
				cwd: managedHome,
				timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
			});
		});

		await runStep(emit, "model", async () => {
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
		const outcome = { ok: true, pythonPath, scriptPath };
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
