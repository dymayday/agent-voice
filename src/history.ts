import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import type { AgentVoicePaths } from "./paths";
import type { JobStatus } from "./store";

export interface AppHistoryJob {
	id: string;
	agent: string;
	status: Extract<JobStatus, "done" | "failed" | "skipped">;
	text: string;
	cwd?: string;
	createdAt: string;
	finishedAt?: string;
	summary?: string;
	summarizerUsed?: string;
	skipReason?: string;
	lastError?: string;
	attempts: number;
}

export interface AppHistorySnapshot {
	version: 1;
	jobs: AppHistoryJob[];
}

interface HistoryRow {
	id: string;
	agent: string;
	status: "done" | "failed" | "skipped";
	text: string;
	cwd: string | null;
	created_at: string;
	finished_at: string | null;
	summary: string | null;
	summarizer_used: string | null;
	skip_reason: string | null;
	last_error: string | null;
	attempts: number;
}

export function buildHistorySnapshot(paths: AgentVoicePaths, limit = 50): AppHistorySnapshot {
	if (!existsSync(paths.db)) return { version: 1, jobs: [] };

	const db = new Database(paths.db, { readonly: true });
	try {
		const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit || 50)));
		const rows = db
			.query(
				`SELECT id, agent, status, text, cwd, created_at, finished_at, summary, summarizer_used, skip_reason, last_error, attempts
				 FROM jobs
				 WHERE status IN ('done', 'failed', 'skipped')
				 ORDER BY COALESCE(finished_at, created_at) DESC, created_at DESC
				 LIMIT $limit`,
			)
			.all({ $limit: boundedLimit }) as HistoryRow[];
		return { version: 1, jobs: rows.map(rowToHistoryJob) };
	} finally {
		db.close();
	}
}

function rowToHistoryJob(row: HistoryRow): AppHistoryJob {
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
	};
}

export function formatHistoryJson(snapshot: AppHistorySnapshot): string {
	return `${JSON.stringify(snapshot, null, 2)}\n`;
}
