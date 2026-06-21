import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { buildAppStatusSnapshot, type AppStatusSnapshot } from "../status";
import { buildKokoroStatus } from "../kokoro-setup";
import type { AgentVoicePaths } from "../paths";
import {
	detectPlaybackBackendSync,
	type CommandExistsSync,
	type PlaybackBackend,
} from "../platform/playback";
import type { JobStatus } from "../store";
import type { DaemonCliDeps } from "../daemon";
import type { InstallEnv } from "../install";
import { fail, ok } from "./errors";
import type { AppServiceResult, QueueJobSummary, SystemStatus } from "./types";
export {
	deriveFirstRunActions,
	FIRST_RUN_ACTIONS,
	type FirstRunAction,
	type FirstRunProbeState,
} from "./first-run-actions";

export interface StatusServiceOptions {
	daemonDeps?: DaemonCliDeps;
	installEnv?: InstallEnv;
	playback?: {
		platform?: NodeJS.Platform;
		commandExists?: CommandExistsSync;
	};
}

export interface QueueSnapshotJob extends QueueJobSummary {
	claimedAt?: string;
	nextAttemptAt?: string;
}

export interface UiQueueSnapshot {
	version: 1;
	counts: Record<JobStatus, number>;
	pending: QueueSnapshotJob[];
	processing: QueueSnapshotJob[];
	recent: QueueSnapshotJob[];
}

interface QueueRow {
	id: string;
	agent: string;
	status: JobStatus;
	text: string;
	cwd: string | null;
	created_at: string;
	finished_at: string | null;
	summary: string | null;
	summarizer_used: string | null;
	skip_reason: string | null;
	last_error: string | null;
	attempts: number;
	claimed_at: string | null;
	next_attempt_at: string | null;
}

const STATUS_ORDER: JobStatus[] = [
	"pending",
	"processing",
	"done",
	"failed",
	"skipped",
];

function emptyCounts(): Record<JobStatus, number> {
	return Object.fromEntries(
		STATUS_ORDER.map((status) => [status, 0]),
	) as Record<JobStatus, number>;
}

function mapPlayback(backend: PlaybackBackend): SystemStatus["playback"] {
	if (backend.kind === "tool") {
		return {
			state: "available",
			backend: backend.name,
			checked: backend.checked,
		};
	}
	return {
		state: "missing",
		checked: backend.checked,
		message: backend.message,
	};
}

function mapStatus(
	snapshot: AppStatusSnapshot,
	paths: AgentVoicePaths,
	playbackBackend: PlaybackBackend,
): SystemStatus {
	const kokoro = buildKokoroStatus(paths);
	return {
		version: 1,
		buildId: snapshot.buildId,
		daemon: snapshot.daemon,
		kokoro: kokoro.installed
			? { state: "ready" }
			: { state: "missing", message: "Managed Kokoro voice is not installed." },
		playback: mapPlayback(playbackBackend),
		queue: snapshot.queues,
		attention: snapshot.ui.attention,
		install: snapshot.install,
		paths: snapshot.paths,
		config: snapshot.config,
	};
}

export function getStatus(
	paths: AgentVoicePaths,
	options: StatusServiceOptions = {},
): AppServiceResult<SystemStatus> {
	try {
		const snapshot = buildAppStatusSnapshot(
			paths,
			options.daemonDeps ?? {},
			options.installEnv ?? (process.env as InstallEnv),
		);
		const playbackBackend = detectPlaybackBackendSync(options.playback ?? {});
		return ok(mapStatus(snapshot, paths, playbackBackend));
	} catch (error) {
		return fail(
			"INTERNAL",
			error instanceof Error ? error.message : String(error),
		);
	}
}

function rowToQueueJob(row: QueueRow): QueueSnapshotJob {
	return {
		id: row.id,
		agent: row.agent,
		status: row.status,
		text: row.text,
		...(row.cwd ? { cwd: row.cwd } : {}),
		createdAt: row.created_at,
		...(row.finished_at ? { finishedAt: row.finished_at } : {}),
		...(row.summary ? { summary: row.summary } : {}),
		...(row.summarizer_used ? { summarizerUsed: row.summarizer_used } : {}),
		...(row.skip_reason ? { skipReason: row.skip_reason } : {}),
		...(row.last_error ? { lastError: row.last_error } : {}),
		attempts: row.attempts,
		...(row.claimed_at ? { claimedAt: row.claimed_at } : {}),
		...(row.next_attempt_at ? { nextAttemptAt: row.next_attempt_at } : {}),
	};
}

function readCounts(db: Database): Record<JobStatus, number> {
	const counts = emptyCounts();
	const rows = db
		.query("SELECT status, COUNT(*) AS c FROM jobs GROUP BY status")
		.all() as { status: string; c: number }[];
	for (const row of rows) {
		if ((STATUS_ORDER as string[]).includes(row.status)) {
			counts[row.status as JobStatus] = row.c;
		}
	}
	return counts;
}

export function getQueueSnapshot(
	paths: AgentVoicePaths,
	options: { activeLimit?: number; recentLimit?: number } = {},
): AppServiceResult<UiQueueSnapshot> {
	const activeLimit = Math.max(
		1,
		Math.min(200, Math.trunc(options.activeLimit ?? 50)),
	);
	const recentLimit = Math.max(
		1,
		Math.min(200, Math.trunc(options.recentLimit ?? 50)),
	);
	if (!existsSync(paths.db)) {
		return ok({
			version: 1,
			counts: emptyCounts(),
			pending: [],
			processing: [],
			recent: [],
		});
	}

	try {
		const db = new Database(paths.db, { readonly: true });
		try {
			const pending = db
				.query(
					`SELECT id, agent, status, text, cwd, created_at, finished_at, summary, summarizer_used, skip_reason, last_error, attempts, claimed_at, next_attempt_at
					 FROM jobs WHERE status='pending'
					 ORDER BY created_at ASC, id ASC LIMIT $limit`,
				)
				.all({ $limit: activeLimit }) as QueueRow[];
			const processing = db
				.query(
					`SELECT id, agent, status, text, cwd, created_at, finished_at, summary, summarizer_used, skip_reason, last_error, attempts, claimed_at, next_attempt_at
					 FROM jobs WHERE status='processing'
					 ORDER BY COALESCE(claimed_at, created_at) ASC, created_at ASC, id ASC LIMIT $limit`,
				)
				.all({ $limit: activeLimit }) as QueueRow[];
			const recent = db
				.query(
					`SELECT id, agent, status, text, cwd, created_at, finished_at, summary, summarizer_used, skip_reason, last_error, attempts, claimed_at, next_attempt_at
					 FROM jobs WHERE status IN ('done', 'failed', 'skipped')
					 ORDER BY COALESCE(finished_at, created_at) DESC, created_at DESC, id DESC LIMIT $limit`,
				)
				.all({ $limit: recentLimit }) as QueueRow[];
			return ok({
				version: 1,
				counts: readCounts(db),
				pending: pending.map(rowToQueueJob),
				processing: processing.map(rowToQueueJob),
				recent: recent.map(rowToQueueJob),
			});
		} finally {
			db.close();
		}
	} catch (error) {
		return fail(
			"INTERNAL",
			error instanceof Error ? error.message : String(error),
		);
	}
}
