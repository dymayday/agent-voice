import type { Database } from "bun:sqlite";
import type { AgentVoiceConfig } from "./config";
import type { AgentVoiceEvent } from "./events";
import { shouldSkipJob, type QueueJob, type SkipReason } from "./queue";

export type JobStatus = "pending" | "processing" | "done" | "failed" | "skipped";

export interface StoredJob extends QueueJob {
	status: JobStatus;
	summary?: string;
	summarizerUsed?: string;
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
	skip_reason: string | null;
	last_error: string | null;
	metadata: string | null;
}

function parseMetadata(raw: string | null): Record<string, unknown> | undefined {
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
		...(parseMetadata(row.metadata) ? { metadata: parseMetadata(row.metadata) } : {}),
	};
}

export function enqueue(
	db: Database,
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

const STATUSES: JobStatus[] = ["pending", "processing", "done", "failed", "skipped"];

export function countByStatus(db: Database): Record<JobStatus, number> {
	const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
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

// Internal helpers shared by later tasks.
export { rowToStoredJob };
export type { JobRow };
