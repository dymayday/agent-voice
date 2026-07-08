import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	openSync,
	closeSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig, type AgentVoiceConfig, type AgentName } from "./config";
import type { AgentVoicePaths } from "./paths";
import { detectAgentInstallStates, type AgentInstallState, type InstallEnv } from "./install";
import { readBuildId } from "./build-info";
import {
	processNextJob,
	type ProcessNextJobResult,
	type ProcessorDeps,
} from "./processor";
import { Database } from "bun:sqlite";
import { openDb } from "./db";
import {
	countsForSnapshot,
	msUntilNextDue,
	pruneRetention,
	runMaintenance,
	type JobStatus,
} from "./store";
import { composeStatusSnapshot, formatAppStatusJson } from "./status";

export interface DetachedDaemonRequest {
	command: string;
	args: string[];
	env: Record<string, string | undefined>;
	cwd: string;
	stdoutPath: string;
	stderrPath: string;
}

export interface DaemonCliDeps {
	processorDeps?: ProcessorDeps;
	processorDepsForConfig?: (config: AgentVoiceConfig) => ProcessorDeps;
	isPidAlive?: (pid: number) => boolean;
	startBackground?: (paths: AgentVoicePaths) => Promise<number> | number;
	spawnDetached?: (request: DetachedDaemonRequest) => Promise<number> | number;
	stopProcess?: (pid: number, paths: AgentVoicePaths) => Promise<void> | void;
	killProcess?: (pid: number, signal: NodeJS.Signals) => void;
	now?: () => Date;
	maxIterations?: number;
	pollIntervalMs?: number;
	pruneEveryIterations?: number;
	pruneIntervalMs?: number;
	waitForWork?: (timeoutMs: number) => Promise<void>;
	/** Install-detection env (HOME etc). Defaults to process.env in the loop. */
	env?: InstallEnv;
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

export function statusSnapshotPath(paths: AgentVoicePaths): string {
	return join(paths.run, "status.json");
}

/**
 * Publish the daemon's status JSON for in-process GUI reads (so the GUI does not
 * have to spawn the CLI to learn queue/daemon state). Write-temp-then-rename
 * keeps every concurrent read a complete document; the temp lives in the same
 * directory as the target so the rename stays on one filesystem (atomic).
 */
export function writeStatusSnapshotAtomic(
	paths: AgentVoicePaths,
	json: string,
): void {
	ensureRunDir(paths);
	const finalPath = statusSnapshotPath(paths);
	const tmpPath = `${finalPath}.${process.pid}.tmp`;
	writeFileSync(tmpPath, json, "utf8");
	renameSync(tmpPath, finalPath);
}

export function clearStatusSnapshot(paths: AgentVoicePaths): void {
	rmSync(statusSnapshotPath(paths), { force: true });
}

/**
 * Remove orphaned `status.json.<pid>.tmp` files left behind if a daemon was
 * killed between the write and the rename in `writeStatusSnapshotAtomic`. The
 * temp name is keyed by pid, so each crashed daemon leaves at most one; a sweep
 * at startup keeps the run directory tidy. Best-effort: never throws.
 */
export function sweepStaleSnapshotTemps(paths: AgentVoicePaths): void {
	try {
		if (!existsSync(paths.run)) return;
		for (const name of readdirSync(paths.run)) {
			if (name.startsWith("status.json.") && name.endsWith(".tmp")) {
				rmSync(join(paths.run, name), { force: true });
			}
		}
	} catch {
		// Best-effort cleanup only.
	}
}

export interface StatusPublisher {
	/** Publish the running daemon's status for the given config (best-effort). */
	publish(config: AgentVoiceConfig): void;
	/** Number of writes that actually hit disk (for diagnostics/tests). */
	readonly writes: number;
}

/**
 * Publishes the daemon's status to run/status.json for in-process GUI reads.
 * Owns the policy so the loop doesn't have to:
 *  - dedup: skip byte-identical writes, but re-publish if the file vanished;
 *  - best-effort: a cosmetic status write must NEVER crash the job-processing
 *    daemon, so write failures are swallowed;
 *  - write-then-commit: the dedup cache only advances after a successful write,
 *    so a failed write is retried next tick instead of being silently dropped.
 */
export function createStatusPublisher(
	paths: AgentVoicePaths,
	db: Database,
	env: InstallEnv,
	// Captured once, here, at daemon startup — NOT re-read per publish. This is
	// the whole mechanism: a daemon launched from an older bundle keeps reporting
	// that bundle's id even after the on-disk bundle is rebuilt, letting the app
	// spot the skew and restart it.
	buildId: string | null = readBuildId(),
): StatusPublisher {
	let lastJson: string | null = null;
	let lastWarnedError: string | null = null;
	let writes = 0;
	return {
		get writes() {
			return writes;
		},
		publish(config: AgentVoiceConfig): void {
			// The WHOLE body is best-effort: nothing here — snapshot composition,
			// the countByStatus read, the dedup stat, or the write — may crash the
			// job-processing daemon, because a status snapshot is purely cosmetic.
			try {
				const json = formatAppStatusJson(
					composeStatusSnapshot({
						daemon: { running: true, pid: process.pid },
						queues: countsForSnapshot(db),
						config: { enabled: config.enabled, agents: config.agents },
						install: detectAgentInstallStates(env),
						paths: { home: paths.home, config: paths.config, db: paths.db },
						buildId,
					}),
				);
				// Skip when content AND the on-disk file are unchanged; re-publish if
				// the file was removed out from under us. lastJson advances only after
				// a successful write, so a failed write is retried next tick.
				if (json === lastJson && existsSync(statusSnapshotPath(paths))) return;
				writeStatusSnapshotAtomic(paths, json);
				lastJson = json;
				writes += 1;
				if (lastWarnedError !== null) {
					console.warn("[agent-voice] status snapshot publishing recovered");
					lastWarnedError = null;
				}
			} catch (error) {
				// Log once per distinct error, not once per tick: a persistent
				// failure (full disk, EACCES) would otherwise flood the daemon log
				// and bury the underlying condition.
				const message = error instanceof Error ? error.message : String(error);
				if (message !== lastWarnedError) {
					console.warn(
						`[agent-voice] failed to publish status snapshot (will keep retrying): ${message}`,
					);
					lastWarnedError = message;
				}
			}
		},
	};
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
		stdoutPath: join(paths.logs, "daemon.out.log"),
		stderrPath: join(paths.logs, "daemon.err.log"),
	};
}

function defaultSpawnDetached(request: DetachedDaemonRequest): number {
	mkdirSync(dirname(request.stdoutPath), { recursive: true });
	const stdoutFd = openSync(request.stdoutPath, "a");
	const stderrFd = openSync(request.stderrPath, "a");
	try {
		const child = spawn(request.command, request.args, {
			cwd: request.cwd,
			detached: true,
			env: request.env as NodeJS.ProcessEnv,
			stdio: ["ignore", stdoutFd, stderrFd],
		});
		child.unref();
		if (child.pid === undefined) {
			throw new Error("Detached daemon did not expose a pid");
		}
		return child.pid;
	} finally {
		closeSync(stdoutFd);
		closeSync(stderrFd);
	}
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
			return countsForSnapshot(db);
		} finally {
			db.close();
		}
	}

	const db = openDb(paths.db);
	try {
		return countsForSnapshot(db);
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

function processorDepsForConfig(
	deps: DaemonCliDeps,
	config: AgentVoiceConfig,
): ProcessorDeps {
	return deps.processorDepsForConfig?.(config) ?? requireProcessorDeps(deps);
}

interface DaemonConfigCache {
	config: AgentVoiceConfig;
	mtimeMs: number | null;
}

function currentDaemonConfig(
	paths: AgentVoicePaths,
	cache: DaemonConfigCache,
): AgentVoiceConfig {
	if (!existsSync(paths.config)) {
		cache.mtimeMs = null;
		return cache.config;
	}

	let mtimeMs: number;
	try {
		mtimeMs = statSync(paths.config).mtimeMs;
	} catch {
		return cache.config;
	}
	if (cache.mtimeMs === mtimeMs) return cache.config;

	cache.mtimeMs = mtimeMs;
	try {
		cache.config = loadConfig(paths, { createIfMissing: false });
	} catch {
		// Keep serving the last known-good config until the file changes again.
	}
	return cache.config;
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
			deps.now ?? (() => new Date()),
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
	snapshotWrites: number;
}

function sleep(ms: number): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// When the idle wait is uncapped (no upcoming retry), fall back to this
// safety-net cap so a missed wakeup never strands a job indefinitely.
const DEFAULT_SAFETY_NET_MS = 30_000;
// Wall-clock cadence for retention pruning (1h) — see B9.
const DEFAULT_PRUNE_INTERVAL_MS = 3_600_000;

export async function runDaemonLoop(
	paths: AgentVoicePaths,
	config: AgentVoiceConfig,
	deps: DaemonCliDeps,
): Promise<DaemonLoopResult> {
	if (!deps.processorDeps && !deps.processorDepsForConfig) {
		throw new Error("Processor dependencies are required");
	}
	const summary: DaemonLoopResult = {
		iterations: 0,
		processed: 0,
		idle: 0,
		retryScheduled: 0,
		failed: 0,
		snapshotWrites: 0,
	};
	const maxIterations = deps.maxIterations ?? Number.POSITIVE_INFINITY;
	// `pollIntervalMs` is repurposed as the idle-wait safety-net cap.
	const safetyNetMs = deps.pollIntervalMs ?? DEFAULT_SAFETY_NET_MS;
	// Default fallback preserves the old timer-sleep behavior; the real
	// entrypoint injects a signal-driven waiter via deps.waitForWork.
	const waitForWork = deps.waitForWork ?? ((ms) => sleep(ms));
	const pruneEvery = deps.pruneEveryIterations ?? 300;
	const pruneIntervalMs = deps.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
	const configCache: DaemonConfigCache = { config, mtimeMs: null };
	let activeProcessorDeps: ProcessorDeps | null = null;
	async function getProcessorDeps(
		currentConfig: AgentVoiceConfig,
	): Promise<ProcessorDeps> {
		const nextDeps = processorDepsForConfig(deps, currentConfig);
		if (nextDeps !== activeProcessorDeps) {
			activeProcessorDeps = nextDeps;
			try {
				await activeProcessorDeps.prewarm?.();
			} catch {
				// Best-effort warm-up; the first job will retry readiness if this failed.
			}
		}
		return nextDeps;
	}

	const db = openDb(paths.db);
	try {
		const clock = deps.now ?? (() => new Date());
		let lastPruneMs = clock().getTime();
		// Clear temp files orphaned by a previously-crashed daemon, then
		// publish "running" promptly so the GUI sees it before the first wait. The
		// publisher owns the dedup/best-effort/self-heal policy; the loop just
		// announces state transitions.
		sweepStaleSnapshotTemps(paths);
		const publisher = createStatusPublisher(paths, db, deps.env ?? (process.env as InstallEnv));
		publisher.publish(currentDaemonConfig(paths, configCache));
		while (summary.iterations < maxIterations && !hasIntentionalStop(paths)) {
			const currentConfig = currentDaemonConfig(paths, configCache);
			const procDeps = await getProcessorDeps(currentConfig);
			const result = await processNextJob(
				db,
				currentConfig,
				procDeps,
				clock,
				// Publish the in-flight "processing" state as soon as the job is
				// claimed, so the GUI sees queues.processing>0 for the job's
				// duration instead of jumping pending -> done.
				() => publisher.publish(currentConfig),
			);
			summary.iterations += 1;
			if (result.kind === "processed") summary.processed += 1;
			if (result.kind === "idle") summary.idle += 1;
			if (result.kind === "retry_scheduled") summary.retryScheduled += 1;
			if (result.kind === "failed") summary.failed += 1;
			// Prune on the iteration cadence (preserves existing test triggers)
			// OR on a wall-clock schedule — the latter keeps pruning alive on a
			// mostly-idle daemon where iterations advance only ~1/30s (B9).
			const nowMs = clock().getTime();
			const iterationDue = pruneEvery > 0 && summary.iterations % pruneEvery === 0;
			const wallClockDue = nowMs - lastPruneMs >= pruneIntervalMs;
			if (iterationDue || wallClockDue) {
				pruneRetention(db, currentConfig.spool.retentionDays, clock());
				runMaintenance(db);
				lastPruneMs = nowMs;
			}
			// Publish the post-iteration state (covers processed/failed/retry/idle
			// and config hot-reload) BEFORE the daemon parks on the idle wait, so
			// the GUI sees fresh state even while the daemon sleeps.
			publisher.publish(currentConfig);
			if (result.kind === "idle") {
				// Single-writer invariant: an idle daemon has nothing in `processing`
				// that it owns, so no pending job it claimed can go stale mid-wait.
				// An orphan `processing` row from a crashed prior daemon is invisible
				// to msUntilNextDue (which counts only pending rows), so it does not
				// shorten this wait. recoverStale resets such a row to pending on the
				// first iteration AFTER it crosses processingTimeoutSeconds — which
				// can be up to safetyNetMs late, since we only re-poll when the wait
				// elapses or a poke arrives. The bound is acceptable: the orphan is a
				// crash artifact, not steady-state work.
				const dueInMs = msUntilNextDue(db, clock());
				// Direct hand-edits to config.json (outside the CLI/GUI) are only
				// observed within safetyNetMs: hot-reload now relies on the SIGUSR1
				// poke that CLI/GUI config mutations send, so an external editor's
				// change is picked up no sooner than the next safety-net wakeup.
				const waitMs =
					dueInMs === null
						? safetyNetMs
						: Math.max(0, Math.min(safetyNetMs, dueInMs));
				// waitMs === 0 is a deliberate immediate re-poll: a retry crossed its
				// due boundary between the claim's clock read and msUntilNextDue's
				// clock read, so dueInMs <= 0. It is bounded to one extra iteration —
				// the next claimNextDue will claim the now-due job.
				if (waitMs > 0) await waitForWork(waitMs);
			}
		}
		summary.snapshotWrites = publisher.writes;
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
	// Drop any snapshot left by a previously-crashed daemon so a relaunch never
	// inherits a stale running:true file before the new daemon's first publish.
	clearStatusSnapshot(paths);
	const pid = deps.startBackground
		? await deps.startBackground(paths)
		: await (deps.spawnDetached ?? defaultSpawnDetached)(
				detachedDaemonRequest(paths),
			);
	const shouldVerifyHealth =
		!deps.startBackground && (Boolean(deps.isPidAlive) || !deps.spawnDetached);
	if (shouldVerifyHealth && !(deps.isPidAlive ?? defaultIsPidAlive)(pid)) {
		clearDaemonLock(paths);
		return { ok: false, reason: "daemon exited before becoming healthy" };
	}
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
		clearDaemonLock(paths);
		// The SIGTERM'd daemon dies on its default disposition without running its
		// finally (it only handles SIGUSR1), so clear the snapshot here too —
		// otherwise a stopped daemon leaves a stale running:true file behind.
		clearStatusSnapshot(paths);
	}
	return { stopped: pid !== null, pid };
}

export function hasIntentionalStop(paths: AgentVoicePaths): boolean {
	return existsSync(intentionalStopPath(paths));
}

/**
 * Best-effort wakeup poke to a running daemon via SIGUSR1.
 *
 * Called after an enqueue insert or a config mutation so the daemon wakes from
 * its idle wait promptly instead of waiting out the safety-net cap. This must
 * never throw or block out of the success path of its caller — the entire body
 * (including `readDaemonLock`, which re-throws non-ENOENT errors like EACCES) is
 * wrapped in a try/catch.
 *
 * PID-reuse TOCTOU (accepted, documented): between `readDaemonLock` and `kill`
 * the daemon could die and the PID be reused. This is the same risk the
 * existing `stopDaemon` SIGTERM path already carries. Worst realistic case is a
 * missed wakeup (covered by the safety net) or a stray SIGUSR1.
 */
export function notifyDaemon(
	paths: AgentVoicePaths,
	deps: DaemonCliDeps = {},
): void {
	try {
		const pid = readDaemonLock(paths);
		if (pid === null) return;
		// Liveness pre-check avoids signalling a reused PID.
		if (!(deps.isPidAlive ?? defaultIsPidAlive)(pid)) return;
		try {
			(deps.killProcess ?? defaultKillProcess)(pid, "SIGUSR1");
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			// ESRCH: process gone; EPERM: not ours — both are benign for a
			// best-effort poke. Anything else is unexpected: warn, but never
			// rethrow (the caller still exits successfully).
			if (code !== "ESRCH" && code !== "EPERM") {
				console.warn(
					`[agent-voice] failed to notify daemon pid=${pid}: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
		}
	} catch {
		// readDaemonLock or anything else above threw (e.g. EACCES). Best-effort:
		// swallow so the caller's success path is never disturbed.
	}
}
