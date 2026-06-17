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

export interface AppHistoryPageInfo {
	limit: number;
	hasMore: boolean;
	nextCursor: string | null;
}

export interface AppHistorySnapshot {
	version: 1;
	jobs: AppHistoryJob[];
	pageInfo: AppHistoryPageInfo;
}

export interface HistoryCursor {
	sortAt: string;
	createdAt: string;
	id: string;
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
	sort_at: string;
}

export function encodeHistoryCursor(row: HistoryRow): string {
	const cursor: HistoryCursor = {
		sortAt: row.sort_at,
		createdAt: row.created_at,
		id: row.id,
	};
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeHistoryCursor(raw: string): HistoryCursor | null {
	try {
		const decoded = Buffer.from(raw, "base64url").toString("utf8");
		const parsed = JSON.parse(decoded) as Partial<HistoryCursor>;
		if (
			typeof parsed.sortAt !== "string" ||
			typeof parsed.createdAt !== "string" ||
			typeof parsed.id !== "string" ||
			parsed.sortAt.length === 0 ||
			parsed.createdAt.length === 0 ||
			parsed.id.length === 0
		) {
			return null;
		}
		return {
			sortAt: parsed.sortAt,
			createdAt: parsed.createdAt,
			id: parsed.id,
		};
	} catch {
		return null;
	}
}

export function buildHistorySnapshot(
	paths: AgentVoicePaths,
	limit = 50,
	before?: HistoryCursor,
): AppHistorySnapshot {
	const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit || 50)));
	if (!existsSync(paths.db)) {
		return emptyHistorySnapshot(boundedLimit);
	}

	const db = new Database(paths.db, { readonly: true });
	try {
		const params: Record<string, string | number> = {
			$limit: boundedLimit + 1,
		};
		let cursorPredicate = "";
		if (before) {
			params.$sortAt = before.sortAt;
			params.$createdAt = before.createdAt;
			params.$id = before.id;
			cursorPredicate = `
				 AND (
					COALESCE(finished_at, created_at) < $sortAt
					OR (COALESCE(finished_at, created_at) = $sortAt AND created_at < $createdAt)
					OR (COALESCE(finished_at, created_at) = $sortAt AND created_at = $createdAt AND id < $id)
				 )`;
		}
		const rows = db
			.query(
				`SELECT id, agent, status, text, cwd, created_at, finished_at, summary, summarizer_used, skip_reason, last_error, attempts,
				        COALESCE(finished_at, created_at) AS sort_at
				 FROM jobs
				 WHERE status IN ('done', 'failed', 'skipped')${cursorPredicate}
				 ORDER BY COALESCE(finished_at, created_at) DESC, created_at DESC, id DESC
				 LIMIT $limit`,
			)
			.all(params) as HistoryRow[];
		const pageRows = rows.slice(0, boundedLimit);
		const hasMore = rows.length > boundedLimit;
		const lastPageRow = pageRows.at(-1);
		return {
			version: 1,
			jobs: pageRows.map(rowToHistoryJob),
			pageInfo: {
				limit: boundedLimit,
				hasMore,
				nextCursor: hasMore && lastPageRow ? encodeHistoryCursor(lastPageRow) : null,
			},
		};
	} finally {
		db.close();
	}
}

function emptyHistorySnapshot(limit: number): AppHistorySnapshot {
	return {
		version: 1,
		jobs: [],
		pageInfo: { limit, hasMore: false, nextCursor: null },
	};
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
