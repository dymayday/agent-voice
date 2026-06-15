import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { AgentVoiceConfig } from "./config";
import type { AgentVoicePaths } from "./paths";
import {
	processNextJob,
	type ProcessNextJobResult,
	type ProcessorDeps,
} from "./processor";
import { Database } from "bun:sqlite";
import { openDb } from "./db";
import {
	countByStatus,
	pruneRetention,
	runMaintenance,
	type JobStatus,
} from "./store";

export interface DetachedDaemonRequest {
	command: string;
	args: string[];
	env: Record<string, string | undefined>;
	cwd: string;
}

export interface DaemonCliDeps {
	processorDeps?: ProcessorDeps;
	isPidAlive?: (pid: number) => boolean;
	startBackground?: (paths: AgentVoicePaths) => Promise<number> | number;
	spawnDetached?: (request: DetachedDaemonRequest) => Promise<number> | number;
	stopProcess?: (pid: number, paths: AgentVoicePaths) => Promise<void> | void;
	killProcess?: (pid: number, signal: NodeJS.Signals) => void;
	now?: () => Date;
	maxIterations?: number;
	pollIntervalMs?: number;
	pruneEveryIterations?: number;
}

export interface DaemonStatus {
	running: boolean;
	pid: number | null;
	queues: Record<JobStatus, number>;
}

export interface DaemonStatusOptions {
	readOnly?: boolean;
}

export function daemonLockPath(paths: AgentVoicePaths): string {
	return join(paths.run, "daemon.pid");
}

export function intentionalStopPath(paths: AgentVoicePaths): string {
	return join(paths.run, "intentional-stop");
}

function ensureRunDir(paths: AgentVoicePaths): void {
	mkdirSync(paths.run, { recursive: true });
}

export function writeDaemonLock(paths: AgentVoicePaths, pid: number): void {
	ensureRunDir(paths);
	writeFileSync(daemonLockPath(paths), `${pid}\n`, "utf8");
}

export function readDaemonLock(paths: AgentVoicePaths): number | null {
	try {
		const value = Number(readFileSync(daemonLockPath(paths), "utf8").trim());
		return Number.isInteger(value) && value > 0 ? value : null;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

export function clearDaemonLock(paths: AgentVoicePaths): void {
	rmSync(daemonLockPath(paths), { force: true });
}

export function clearIntentionalStop(paths: AgentVoicePaths): void {
	rmSync(intentionalStopPath(paths), { force: true });
}

function defaultIsPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function defaultKillProcess(pid: number, signal: NodeJS.Signals): void {
	process.kill(pid, signal);
}

function daemonEntrypointPath(): string {
	return join(import.meta.dir, "index.ts");
}

function detachedDaemonRequest(paths: AgentVoicePaths): DetachedDaemonRequest {
	return {
		command: process.execPath,
		args: [daemonEntrypointPath(), "daemon", "--foreground"],
		env: {
			...process.env,
			AGENT_VOICE_HOME: paths.home,
		},
		cwd: paths.home,
	};
}

function defaultSpawnDetached(request: DetachedDaemonRequest): number {
	const child = spawn(request.command, request.args, {
		cwd: request.cwd,
		detached: true,
		env: request.env as NodeJS.ProcessEnv,
		stdio: "ignore",
	});
	child.unref();
	if (child.pid === undefined) {
		throw new Error("Detached daemon did not expose a pid");
	}
	return child.pid;
}

const STATUS_ORDER: JobStatus[] = [
	"pending",
	"processing",
	"done",
	"failed",
	"skipped",
];

function emptyQueueCounts(): Record<JobStatus, number> {
	return Object.fromEntries(
		STATUS_ORDER.map((status) => [status, 0]),
	) as Record<JobStatus, number>;
}

function readQueueCounts(
	paths: AgentVoicePaths,
	options: DaemonStatusOptions,
): Record<JobStatus, number> {
	if (options.readOnly) {
		if (!existsSync(paths.db)) return emptyQueueCounts();
		const db = new Database(paths.db, { readonly: true });
		try {
			return countByStatus(db);
		} finally {
			db.close();
		}
	}

	const db = openDb(paths.db);
	try {
		return countByStatus(db);
	} finally {
		db.close();
	}
}

export function getDaemonStatus(
	paths: AgentVoicePaths,
	deps: DaemonCliDeps = {},
	options: DaemonStatusOptions = {},
): DaemonStatus {
	const pid = readDaemonLock(paths);
	const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive;
	return {
		pid,
		running: pid !== null && isPidAlive(pid),
		queues: readQueueCounts(paths, options),
	};
}

export function formatDaemonStatus(status: DaemonStatus): string {
	let state = "stopped";
	if (status.running) {
		state = `running pid=${status.pid}`;
	} else if (status.pid) {
		state = `stale pid=${status.pid}`;
	}
	const queues = STATUS_ORDER.map((key) => `${key}=${status.queues[key]}`).join(
		" ",
	);
	return `${state}\n${queues}\n`;
}

function requireProcessorDeps(deps: DaemonCliDeps): ProcessorDeps {
	if (!deps.processorDeps) {
		throw new Error("Processor dependencies are required");
	}
	return deps.processorDeps;
}

export async function runDaemonOnce(
	paths: AgentVoicePaths,
	config: AgentVoiceConfig,
	deps: DaemonCliDeps,
): Promise<ProcessNextJobResult> {
	const db = openDb(paths.db);
	try {
		return await processNextJob(
			db,
			config,
			requireProcessorDeps(deps),
			deps.now?.() ?? new Date(),
		);
	} finally {
		db.close();
	}
}

export interface DaemonLoopResult {
	iterations: number;
	processed: number;
	idle: number;
	retryScheduled: number;
	failed: number;
}

function sleep(ms: number): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDaemonLoop(
	paths: AgentVoicePaths,
	config: AgentVoiceConfig,
	deps: DaemonCliDeps,
): Promise<DaemonLoopResult> {
	requireProcessorDeps(deps);
	const summary: DaemonLoopResult = {
		iterations: 0,
		processed: 0,
		idle: 0,
		retryScheduled: 0,
		failed: 0,
	};
	const maxIterations = deps.maxIterations ?? Number.POSITIVE_INFINITY;
	const pollIntervalMs = deps.pollIntervalMs ?? 1000;
	const pruneEvery = deps.pruneEveryIterations ?? 300;
	const db = openDb(paths.db);
	try {
		while (summary.iterations < maxIterations && !hasIntentionalStop(paths)) {
			const now = deps.now?.() ?? new Date();
			const result = await processNextJob(
				db,
				config,
				requireProcessorDeps(deps),
				now,
			);
			summary.iterations += 1;
			if (result.kind === "processed") summary.processed += 1;
			if (result.kind === "idle") summary.idle += 1;
			if (result.kind === "retry_scheduled") summary.retryScheduled += 1;
			if (result.kind === "failed") summary.failed += 1;
			if (summary.iterations % pruneEvery === 0) {
				pruneRetention(db, config.spool.retentionDays, now);
				runMaintenance(db);
			}
			if (result.kind === "idle") await sleep(pollIntervalMs);
		}
	} finally {
		db.close();
	}
	return summary;
}

export async function startDaemon(
	paths: AgentVoicePaths,
	deps: DaemonCliDeps = {},
): Promise<{ ok: true; pid: number } | { ok: false; reason: string }> {
	const status = getDaemonStatus(paths, deps);
	if (status.running && status.pid !== null) {
		return { ok: false, reason: `daemon already running pid=${status.pid}` };
	}

	clearDaemonLock(paths);
	clearIntentionalStop(paths);
	const pid = deps.startBackground
		? await deps.startBackground(paths)
		: await (deps.spawnDetached ?? defaultSpawnDetached)(
				detachedDaemonRequest(paths),
			);
	writeDaemonLock(paths, pid);
	return { ok: true, pid };
}

export function enterForegroundDaemon(
	paths: AgentVoicePaths,
	deps: DaemonCliDeps = {},
): { ok: true; pid: number } | { ok: false; reason: string } {
	const lockedPid = readDaemonLock(paths);
	if (lockedPid === process.pid) return { ok: true, pid: process.pid };

	const status = getDaemonStatus(paths, deps);
	if (status.running && status.pid !== null) {
		return { ok: false, reason: `daemon already running pid=${status.pid}` };
	}

	clearDaemonLock(paths);
	writeDaemonLock(paths, process.pid);
	return { ok: true, pid: process.pid };
}

export function writeIntentionalStop(paths: AgentVoicePaths): void {
	ensureRunDir(paths);
	writeFileSync(
		intentionalStopPath(paths),
		`${new Date().toISOString()}\n`,
		"utf8",
	);
}

export async function stopDaemon(
	paths: AgentVoicePaths,
	deps: DaemonCliDeps = {},
): Promise<{ stopped: boolean; pid: number | null }> {
	const pid = readDaemonLock(paths);
	writeIntentionalStop(paths);
	if (pid !== null) {
		if (deps.stopProcess) {
			await deps.stopProcess(pid, paths);
		} else if ((deps.isPidAlive ?? defaultIsPidAlive)(pid)) {
			(deps.killProcess ?? defaultKillProcess)(pid, "SIGTERM");
		}
	}
	return { stopped: pid !== null, pid };
}

export function hasIntentionalStop(paths: AgentVoicePaths): boolean {
	return existsSync(intentionalStopPath(paths));
}
