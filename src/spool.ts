import {
	closeSync,
	existsSync,
	fsyncSync,
	linkSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	renameSync,
	rmSync,
	rmdirSync,
	statSync,
	openSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { AGENT_NAMES, type AgentName } from "./config";
import type { AgentVoiceEvent } from "./events";
import type { AgentVoicePaths } from "./paths";

export type SpoolState =
	| "incoming"
	| "processing"
	| "done"
	| "failed"
	| "skipped";

const TERMINAL_STATES: SpoolState[] = ["done", "failed", "skipped"];
const JOB_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const JOB_FILENAME_PATTERN =
	/^\d{8}T\d{6}\.\d{3}Z_(claude|codex|pi|opencode)_[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}(?:_\d{3})?\.json$/;

function stateDir(paths: AgentVoicePaths, state: SpoolState): string {
	return paths.spool[state];
}

function isInsideDir(parent: string, child: string): boolean {
	const rel = relative(resolve(parent), resolve(child));
	return (
		rel === "" ||
		(!rel.startsWith("..") && !rel.startsWith("/") && rel !== "..")
	);
}

function assertNoSymlinkParentsWithin(root: string, path: string): void {
	const resolvedRoot = resolve(root);
	let cursor = dirname(resolve(path));
	const parents: string[] = [];

	while (cursor !== resolvedRoot && isInsideDir(resolvedRoot, cursor)) {
		parents.push(cursor);
		cursor = dirname(cursor);
	}

	for (const parent of parents.reverse()) {
		try {
			if (lstatSync(parent).isSymbolicLink()) {
				throw new Error(`Managed path cannot traverse a symlink: ${parent}`);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}

function assertManagedSpoolPaths(paths: AgentVoicePaths): void {
	const root = resolve(paths.spool.root);
	const stateDirs = [
		paths.spool.incoming,
		paths.spool.processing,
		paths.spool.done,
		paths.spool.failed,
		paths.spool.skipped,
	];

	if (!isInsideDir(paths.home, paths.spool.root)) {
		throw new Error(`Invalid managed spool path: ${paths.spool.root}`);
	}

	const seen = new Set<string>();
	for (const dir of stateDirs) {
		const resolved = resolve(dir);
		if (resolved === root || !isInsideDir(root, resolved)) {
			throw new Error(`Invalid managed spool path: ${dir}`);
		}
		if (seen.has(resolved)) {
			throw new Error(`Duplicate managed spool path: ${dir}`);
		}
		assertNoSymlinkParentsWithin(root, resolved);
		seen.add(resolved);
	}
}

function ensureDir(path: string): void {
	try {
		const stats = lstatSync(path);
		if (stats.isSymbolicLink()) {
			throw new Error(`Managed directory cannot be a symlink: ${path}`);
		}
		if (!stats.isDirectory()) {
			throw new Error(`Managed path is not a directory: ${path}`);
		}
		return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}

	mkdirSync(path, { recursive: true });
	const stats = lstatSync(path);
	if (stats.isSymbolicLink()) {
		throw new Error(`Managed directory cannot be a symlink: ${path}`);
	}
	if (!stats.isDirectory()) {
		throw new Error(`Managed path is not a directory: ${path}`);
	}
}

function assertManagedJobPath(paths: AgentVoicePaths, jobPath: string): void {
	const stateDirs = [
		paths.spool.incoming,
		paths.spool.processing,
		paths.spool.done,
		paths.spool.failed,
		paths.spool.skipped,
	];
	if (!stateDirs.some((dir) => resolve(dirname(jobPath)) === resolve(dir))) {
		if (stateDirs.some((dir) => isInsideDir(dir, jobPath))) {
			throw new Error(`Job path must be a direct spool job: ${jobPath}`);
		}
		throw new Error(`Job path is outside spool state directories: ${jobPath}`);
	}
	assertValidJobFilename(basename(jobPath));
}

function assertValidJobIdentity(
	agent: unknown,
	id: unknown,
): asserts agent is AgentName {
	if (typeof agent !== "string" || !AGENT_NAMES.includes(agent as AgentName)) {
		throw new Error(`Invalid job agent: ${String(agent)}`);
	}
	if (typeof id !== "string" || !JOB_ID_PATTERN.test(id)) {
		throw new Error(`Invalid job id: ${String(id)}`);
	}
}

function assertValidJobFilename(filename: string): void {
	if (!JOB_FILENAME_PATTERN.test(filename)) {
		throw new Error(`Invalid spool job filename: ${filename}`);
	}
}

function isValidJobFilename(filename: string): boolean {
	return JOB_FILENAME_PATTERN.test(filename);
}

function fsyncPathBestEffort(path: string): void {
	let fd: number | undefined;
	try {
		fd = openSync(path, "r");
		fsyncSync(fd);
	} catch {
		// Best effort only: spool writes must not fail solely because fsync is unavailable.
	} finally {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {
				// Best effort cleanup only.
			}
		}
	}
}

function removeBestEffort(path: string): void {
	try {
		unlinkSync(path);
	} catch {
		// Best effort cleanup only.
	}
}

function sortableTimestamp(date = new Date()): string {
	return date.toISOString().replace(/[-:]/g, "");
}

function filenameFor(
	event: AgentVoiceEvent,
	createdAt = event.createdAt,
	suffix = "",
): string {
	assertValidJobIdentity(event.agent, event.id);
	return `${sortableTimestamp(new Date(createdAt))}_${event.agent}_${event.id}${suffix}.json`;
}

function lockPathFor(targetPath: string): string {
	return join(dirname(targetPath), `.lock-${basename(targetPath)}`);
}

function tryAcquireJobLock(targetPath: string): string | null {
	const lockPath = lockPathFor(targetPath);
	try {
		mkdirSync(lockPath);
		return lockPath;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
		throw error;
	}
}

function publishNoClobber(
	tmpPath: string,
	dir: string,
	event: AgentVoiceEvent,
	createdAt: string,
): string {
	for (let attempt = 0; attempt < 1000; attempt += 1) {
		const suffix =
			attempt === 0 ? "" : `_${attempt.toString().padStart(3, "0")}`;
		const candidate = join(dir, filenameFor(event, createdAt, suffix));
		const lockPath = tryAcquireJobLock(candidate);
		if (!lockPath) continue;
		try {
			linkSync(tmpPath, candidate);
			fsyncPathBestEffort(dir);
			return candidate;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		} finally {
			releaseMoveLock(lockPath);
		}
	}
	throw new Error(
		`Unable to allocate unique job filename for event ${event.id}`,
	);
}

function acquireMoveLock(targetPath: string): string {
	const lockPath = tryAcquireJobLock(targetPath);
	if (!lockPath) throw new Error(`Job is locked: ${targetPath}`);
	return lockPath;
}

function releaseMoveLock(lockPath: string): void {
	try {
		rmdirSync(lockPath);
	} catch {
		// Best effort cleanup only.
	}
}

function assertRegularFile(path: string): void {
	if (!lstatSync(path).isFile()) {
		throw new Error(`Spool job must be a regular file: ${path}`);
	}
}

function moveNoClobber(sourcePath: string, targetPath: string): void {
	assertRegularFile(sourcePath);
	const lockPaths = [sourcePath, targetPath]
		.map((path) => ({ path, lockPath: lockPathFor(path) }))
		.sort((a, b) => a.lockPath.localeCompare(b.lockPath));
	const acquired: string[] = [];
	try {
		for (const { path } of lockPaths) {
			acquired.push(acquireMoveLock(path));
		}
		try {
			lstatSync(targetPath);
			throw new Error(`Target job already exists: ${targetPath}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		renameSync(sourcePath, targetPath);
		fsyncPathBestEffort(dirname(sourcePath));
		fsyncPathBestEffort(dirname(targetPath));
	} finally {
		for (const lockPath of acquired.reverse()) {
			releaseMoveLock(lockPath);
		}
	}
}

export function ensureHome(paths: AgentVoicePaths): void {
	assertManagedSpoolPaths(paths);
	ensureDir(paths.home);
	ensureDir(paths.logs);
	ensureDir(paths.backups);
	ensureDir(paths.run);
	ensureDir(paths.spool.root);
	ensureDir(paths.spool.incoming);
	ensureDir(paths.spool.processing);
	ensureDir(paths.spool.done);
	ensureDir(paths.spool.failed);
	ensureDir(paths.spool.skipped);
}

export function writeJob(
	paths: AgentVoicePaths,
	state: SpoolState,
	eventOrJob: unknown,
	options: { createdAt?: string } = {},
): string {
	ensureHome(paths);
	const targetDir = stateDir(paths, state);
	const event = eventOrJob as Partial<AgentVoiceEvent>;
	const createdAt =
		options.createdAt ?? event.createdAt ?? new Date().toISOString();
	const agent = event.agent;
	const id = event.id;
	assertValidJobIdentity(agent, id);
	const jobEvent = { ...event, agent, id, createdAt } as AgentVoiceEvent;
	const tmpPath = join(targetDir, `.tmp-${id}-${crypto.randomUUID()}.json`);
	try {
		writeFileSync(tmpPath, `${JSON.stringify(eventOrJob, null, 2)}\n`, {
			encoding: "utf8",
			flag: "wx",
		});
		fsyncPathBestEffort(tmpPath);
		return publishNoClobber(tmpPath, targetDir, jobEvent, createdAt);
	} finally {
		removeBestEffort(tmpPath);
	}
}

export function enqueueEvent(
	paths: AgentVoicePaths,
	event: AgentVoiceEvent,
): string {
	ensureHome(paths);
	assertValidJobIdentity(event.agent, event.id);
	const tmpPath = join(
		paths.spool.incoming,
		`.tmp-${event.id}-${crypto.randomUUID()}.json`,
	);

	try {
		writeFileSync(tmpPath, `${JSON.stringify(event, null, 2)}\n`, {
			encoding: "utf8",
			flag: "wx",
		});
		fsyncPathBestEffort(tmpPath);
		return publishNoClobber(
			tmpPath,
			paths.spool.incoming,
			event,
			event.createdAt,
		);
	} finally {
		removeBestEffort(tmpPath);
	}
}

export function listJobs(paths: AgentVoicePaths, state: SpoolState): string[] {
	assertManagedSpoolPaths(paths);
	const dir = stateDir(paths, state);
	ensureDir(dir);
	return readdirSync(dir)
		.filter((name) => {
			if (!isValidJobFilename(name)) return false;
			const jobPath = join(dir, name);
			try {
				if (existsSync(lockPathFor(jobPath))) return false;
				return lstatSync(jobPath).isFile();
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
				throw error;
			}
		})
		.sort()
		.map((name) => join(dir, name));
}

export function moveJob(
	paths: AgentVoicePaths,
	jobPath: string,
	targetState: SpoolState,
): string {
	ensureHome(paths);
	assertManagedJobPath(paths, jobPath);
	const targetPath = join(stateDir(paths, targetState), basename(jobPath));
	moveNoClobber(jobPath, targetPath);
	fsyncPathBestEffort(stateDir(paths, targetState));
	return targetPath;
}

export function replaceJob(
	paths: AgentVoicePaths,
	jobPath: string,
	eventOrJob: unknown,
): void {
	ensureHome(paths);
	assertManagedJobPath(paths, jobPath);
	assertRegularFile(jobPath);
	const dir = dirname(jobPath);
	const tmpPath = join(dir, `.tmp-replace-${crypto.randomUUID()}.json`);
	let lockPath: string | undefined;
	try {
		writeFileSync(tmpPath, `${JSON.stringify(eventOrJob, null, 2)}\n`, {
			encoding: "utf8",
			flag: "wx",
		});
		fsyncPathBestEffort(tmpPath);
		lockPath = acquireMoveLock(jobPath);
		assertRegularFile(jobPath);
		renameSync(tmpPath, jobPath);
		fsyncPathBestEffort(dir);
	} finally {
		if (lockPath) releaseMoveLock(lockPath);
		removeBestEffort(tmpPath);
	}
}

export function cleanupRetention(
	paths: AgentVoicePaths,
	retentionDays: number,
): string[] {
	if (!Number.isFinite(retentionDays) || retentionDays < 0) {
		throw new Error(`Invalid retentionDays: ${retentionDays}`);
	}
	ensureHome(paths);
	const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
	const removed: string[] = [];

	for (const state of TERMINAL_STATES) {
		for (const filePath of listJobs(paths, state)) {
			try {
				if (statSync(filePath).mtimeMs >= cutoff) continue;
				rmSync(filePath, { force: true });
				removed.push(filePath);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
	}

	return removed;
}
