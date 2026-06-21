import type { AgentVoiceConfig } from "./config";
import type { AgentVoiceDb } from "./db";
import { runOptionalMaintenance } from "./db-adapter";
import type { AgentVoiceEvent } from "./events";
import { shouldSkipJob, type QueueJob, type SkipReason } from "./queue";

export type JobStatus =
	| "pending"
	| "processing"
	| "done"
	| "failed"
	| "skipped";

export interface StoredJob extends QueueJob {
	status: JobStatus;
	summary?: string;
	summarizerUsed?: string;
	spokenAt?: string;
}

interface JobRow {
	id: string;
	version: number;
	agent: string;
	event: string;
	text: string;
	cwd: string | null;
	session_id: string | null;
	status: string;
	attempts: number;
	created_at: string;
	enqueued_at: string;
	last_attempt_at: string | null;
	next_attempt_at: string | null;
	claimed_at: string | null;
	finished_at: string | null;
	summary: string | null;
	summarizer_used: string | null;
	spoken_at: string | null;
	skip_reason: string | null;
	last_error: string | null;
	metadata: string | null;
}

function parseMetadata(
	raw: string | null,
): Record<string, unknown> | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function rowToStoredJob(row: JobRow): StoredJob {
	const metadata = parseMetadata(row.metadata);
	return {
		id: row.id,
		version: 1,
		agent: row.agent as QueueJob["agent"],
		event: "turn_end",
		text: row.text,
		...(row.cwd ? { cwd: row.cwd } : {}),
		...(row.session_id ? { sessionId: row.session_id } : {}),
		createdAt: row.created_at,
		status: row.status as JobStatus,
		attempts: row.attempts,
		...(row.last_attempt_at ? { lastAttemptAt: row.last_attempt_at } : {}),
		...(row.next_attempt_at ? { nextAttemptAt: row.next_attempt_at } : {}),
		...(row.summary ? { summary: row.summary } : {}),
		...(row.summarizer_used ? { summarizerUsed: row.summarizer_used } : {}),
		...(row.spoken_at ? { spokenAt: row.spoken_at } : {}),
		...(metadata ? { metadata } : {}),
	};
}

export function enqueue(
	db: AgentVoiceDb,
	event: AgentVoiceEvent,
	now = new Date(),
): { inserted: boolean } {
	const res = db
		.query(
			`INSERT INTO jobs
        (id, version, agent, event, text, cwd, session_id, status, attempts, created_at, enqueued_at, metadata)
       VALUES
        ($id, $version, $agent, $event, $text, $cwd, $session_id, 'pending', 0, $created_at, $enqueued_at, $metadata)
       ON CONFLICT(id) DO NOTHING`,
		)
		.run({
			$id: event.id,
			$version: event.version,
			$agent: event.agent,
			$event: event.event,
			$text: event.text,
			$cwd: event.cwd ?? null,
			$session_id: event.sessionId ?? null,
			$created_at: event.createdAt,
			$enqueued_at: now.toISOString(),
			$metadata: event.metadata ? JSON.stringify(event.metadata) : null,
		});
	return { inserted: res.changes > 0 };
}

const STATUSES: JobStatus[] = [
	"pending",
	"processing",
	"done",
	"failed",
	"skipped",
];

export function countByStatus(db: AgentVoiceDb): Record<JobStatus, number> {
	const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<
		JobStatus,
		number
	>;
	const rows = db
		.query("SELECT status, COUNT(*) AS c FROM jobs GROUP BY status")
		.all() as { status: string; c: number }[];
	for (const row of rows) {
		if ((STATUSES as string[]).includes(row.status)) {
			counts[row.status as JobStatus] = row.c;
		}
	}
	return counts;
}

function clearQueueByStatus(db: AgentVoiceDb, statuses: JobStatus[]): number {
	const unique = Array.from(new Set(statuses));
	if (unique.length === 0) return 0;
	const placeholder = unique.map((_, index) => `$status${index}`).join(", ");
	const query = db.query(`DELETE FROM jobs WHERE status IN (${placeholder})`);
	const params: Record<string, string> = Object.fromEntries(
		unique.map((status, index) => [`$status${index}`, status]),
	) as Record<string, string>;
	const res = query.run(params);
	runOptionalMaintenance(db, "PRAGMA incremental_vacuum");
	return res.changes;
}

export function clearActiveQueue(db: AgentVoiceDb): number {
	return clearQueueByStatus(db, ["pending", "processing"]);
}

export function clearFailedJobs(db: AgentVoiceDb): number {
	return clearQueueByStatus(db, ["failed"]);
}

function markSkippedInternal(
	db: AgentVoiceDb,
	id: string,
	reason: SkipReason,
	now: Date,
): void {
	db.query(
		"UPDATE jobs SET status='skipped', skip_reason=$reason, finished_at=$now WHERE id=$id",
	).run({ $reason: reason, $now: now.toISOString(), $id: id });
}

export function claimNextDue(
	db: AgentVoiceDb,
	config: AgentVoiceConfig,
	now = new Date(),
): StoredJob | null {
	const iso = now.toISOString();
	const select = db.query(
		`SELECT * FROM jobs
       WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= $now)
       ORDER BY created_at LIMIT 1`,
	);
	const claim = db.query(
		`UPDATE jobs SET status='processing', attempts=attempts+1, last_attempt_at=$now, claimed_at=$now
       WHERE id=$id AND status='pending' RETURNING *`,
	);

	while (true) {
		const candidate = select.get({ $now: iso }) as JobRow | null;
		if (!candidate) return null;
		const job = rowToStoredJob(candidate);
		const skip = shouldSkipJob(job, config);
		if (skip.skip) {
			markSkippedInternal(db, candidate.id, skip.reason, now);
			continue;
		}
		const claimed = claim.get({
			$now: iso,
			$id: candidate.id,
		}) as JobRow | null;
		if (!claimed) continue; // lost a race (single daemon: should not happen)
		return rowToStoredJob(claimed);
	}
}

// Sentinel timestamp meaning "a NULL-next_attempt_at pending row exists, i.e.
// work is due now". Compares less than any real ISO timestamp.
const DUE_NOW_SENTINEL = "0000-01-01T00:00:00.000Z";

/**
 * Earliest due-time across pending jobs, or null when nothing is pending.
 *
 * Index-friendly form (uses `idx_jobs_inflight`): a pending row with a NULL
 * `next_attempt_at` means "due now", otherwise take the MIN of the future
 * timestamps. This matches `claimNextDue` semantics
 * (`next_attempt_at IS NULL OR next_attempt_at <= now`) exactly while avoiding a
 * non-covering `COALESCE`-in-`MIN` scan.
 */
export function getNextDueTime(db: AgentVoiceDb): string | null {
	const row = db
		.query(
			`SELECT
         CASE WHEN EXISTS(SELECT 1 FROM jobs WHERE status='pending' AND next_attempt_at IS NULL)
              THEN '${DUE_NOW_SENTINEL}'
              ELSE (SELECT MIN(next_attempt_at) FROM jobs WHERE status='pending' AND next_attempt_at IS NOT NULL)
         END AS m`,
		)
		// .get() on an aggregate ALWAYS returns a row object, never null.
		.get() as { m: string | null };
	return row.m;
}

/**
 * Milliseconds until the next pending job is due relative to `now`:
 * - `null` when nothing is pending,
 * - `0` when work is due now (sentinel), in the past, or unparseable,
 * - otherwise the positive delta in milliseconds.
 */
export function msUntilNextDue(db: AgentVoiceDb, now: Date): number | null {
	const m = getNextDueTime(db);
	if (m === null) return null;
	const dueMs = Date.parse(m);
	if (Number.isNaN(dueMs)) return 0;
	const delta = dueMs - now.getTime();
	return delta > 0 ? delta : 0;
}

export function recoverStale(
	db: AgentVoiceDb,
	config: AgentVoiceConfig,
	now = new Date(),
): string[] {
	const timeoutMs = config.spool.processingTimeoutSeconds * 1000;
	const rows = db
		.query("SELECT * FROM jobs WHERE status='processing'")
		.all() as JobRow[];
	const recovered: string[] = [];
	const reset = db.query(
		"UPDATE jobs SET status='pending', next_attempt_at=NULL WHERE id=? AND status='processing'",
	);
	for (const row of rows) {
		const ref = row.last_attempt_at ?? row.created_at;
		const refMs = Date.parse(ref);
		if (!Number.isNaN(refMs) && now.getTime() - refMs <= timeoutMs) continue;
		reset.run(row.id);
		recovered.push(row.id);
	}
	return recovered;
}

export function markSpoken(
	db: AgentVoiceDb,
	id: string,
	summary: string,
	summarizerUsed: string | null,
	now = new Date(),
): void {
	db.query(
		"UPDATE jobs SET summary=$summary, summarizer_used=$used, spoken_at=$spoken_at WHERE id=$id",
	).run({
		$summary: summary,
		$used: summarizerUsed,
		$spoken_at: now.toISOString(),
		$id: id,
	});
}

export function markDone(db: AgentVoiceDb, id: string, now = new Date()): void {
	db.query("UPDATE jobs SET status='done', finished_at=$now WHERE id=$id").run({
		$now: now.toISOString(),
		$id: id,
	});
}

export function requeueForRetry(
	db: AgentVoiceDb,
	id: string,
	nextAttemptAt: string,
	lastError: string,
): void {
	db.query(
		"UPDATE jobs SET status='pending', next_attempt_at=$next, last_error=$err, claimed_at=NULL WHERE id=$id",
	).run({ $next: nextAttemptAt, $err: lastError, $id: id });
}

export function markFailed(
	db: AgentVoiceDb,
	id: string,
	now: Date,
	lastError: string,
): void {
	db.query(
		"UPDATE jobs SET status='failed', last_error=$err, finished_at=$now WHERE id=$id",
	).run({ $err: lastError, $now: now.toISOString(), $id: id });
}

export function markSkipped(
	db: AgentVoiceDb,
	id: string,
	reason: SkipReason,
	now = new Date(),
): void {
	markSkippedInternal(db, id, reason, now);
}

export function pruneRetention(
	db: AgentVoiceDb,
	retentionDays: number,
	now = new Date(),
): number {
	if (!Number.isFinite(retentionDays) || retentionDays < 0) {
		throw new Error(`Invalid retentionDays: ${retentionDays}`);
	}
	const cutoff = new Date(
		now.getTime() - retentionDays * 24 * 60 * 60 * 1000,
	).toISOString();
	const res = db
		.query(
			`DELETE FROM jobs
         WHERE status IN ('done','failed','skipped')
           AND finished_at IS NOT NULL AND finished_at < $cutoff`,
		)
		.run({ $cutoff: cutoff });
	runOptionalMaintenance(db, "PRAGMA incremental_vacuum");
	return res.changes;
}

export interface HistoryFilter {
	agent?: string;
	since?: string;
	limit?: number;
}

export function listHistory(
	db: AgentVoiceDb,
	filter: HistoryFilter = {},
): StoredJob[] {
	const clauses = ["status IN ('done','failed','skipped')"];
	const params: Record<string, string | number> = {};
	if (filter.agent) {
		clauses.push("agent = $agent");
		params.$agent = filter.agent;
	}
	if (filter.since) {
		clauses.push("created_at >= $since");
		params.$since = filter.since;
	}
	const limit = Math.floor(Number(filter.limit ?? 200));
	if (!Number.isFinite(limit))
		throw new Error(`Invalid history limit: ${filter.limit}`);
	params.$limit = Math.max(1, Math.min(1000, limit));
	const rows = db
		.query(
			`SELECT * FROM jobs WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT $limit`,
		)
		.all(params) as JobRow[];
	return rows.map(rowToStoredJob);
}

export function runMaintenance(db: AgentVoiceDb): void {
	runOptionalMaintenance(db, "PRAGMA optimize");
}

export { rowToStoredJob };
export type { JobRow };
