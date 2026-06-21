import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { buildDoctorReport, type DoctorReport } from "../doctor";
import type { DaemonCliDeps } from "../daemon";
import type { InstallEnv } from "../install";
import type { AgentVoicePaths } from "../paths";
import { buildAppStatusSnapshot, type AppStatusSnapshot } from "../status";
import type { JobStatus } from "../store";
import { fail, ok } from "./errors";
import type { AppServiceResult } from "./types";

export interface SensitivityItem {
	id: string;
	label: string;
	detail: string;
}

export interface DiagnosticsJobContext {
	id: string;
	agent: string;
	status: Extract<JobStatus, "failed" | "skipped">;
	text: string;
	cwd?: string;
	createdAt: string;
	finishedAt?: string;
	summarizerUsed?: string;
	skipReason?: string;
	lastError?: string;
	attempts: number;
}

export interface DiagnosticsSnapshot {
	version: 1;
	createdAt: string;
	doctor: DoctorReport;
	status: AppStatusSnapshot;
	checks: DoctorReport["checks"];
	failedJobs: DiagnosticsJobContext[];
	skippedJobs: DiagnosticsJobContext[];
	hooks: AppStatusSnapshot["install"];
	paths: AppStatusSnapshot["paths"];
	config: AppStatusSnapshot["config"];
	build: { buildId: string | null; runtime: "bun" | "node" | string };
	playback: { state: "not_probed"; checked: string[]; message: string };
}

export interface DiagnosticsPreview<T = unknown> {
	snapshot: T;
	sensitivity: SensitivityItem[];
}

export const DEFAULT_DIAGNOSTICS_TEXT_LIMIT = 2000;
export const MAX_DIAGNOSTICS_TEXT_LIMIT = 2000;

export interface DiagnosticsPreviewOptions {
	daemonDeps?: DaemonCliDeps;
	installEnv?: InstallEnv;
	maxTextLength?: number;
	jobLimit?: number;
}

interface JobRow {
	id: string;
	agent: string;
	status: "failed" | "skipped";
	text: string;
	cwd: string | null;
	created_at: string;
	finished_at: string | null;
	summarizer_used: string | null;
	skip_reason: string | null;
	last_error: string | null;
	attempts: number;
}

function sanitizeDiagnosticsTextLimit(
	value: number | undefined,
	fallback = DEFAULT_DIAGNOSTICS_TEXT_LIMIT,
): number {
	const raw = value ?? fallback;
	if (!Number.isFinite(raw)) return fallback;
	return Math.max(1, Math.min(MAX_DIAGNOSTICS_TEXT_LIMIT, Math.trunc(raw)));
}

export function truncateSensitiveText(
	text: string,
	max = DEFAULT_DIAGNOSTICS_TEXT_LIMIT,
): string {
	const sanitizedMax = sanitizeDiagnosticsTextLimit(max);
	return text.length > sanitizedMax
		? `${text.slice(0, sanitizedMax)}...`
		: text;
}

function hasPathLikeValue(value: unknown): boolean {
	if (typeof value === "string")
		return value.startsWith("/") || value.includes("\\");
	if (!value || typeof value !== "object") return false;
	return Object.values(value).some(hasPathLikeValue);
}

function hasKey(value: unknown, matcher: (key: string) => boolean): boolean {
	if (!value || typeof value !== "object") return false;
	for (const [key, child] of Object.entries(value)) {
		if (matcher(key) || hasKey(child, matcher)) return true;
	}
	return false;
}

export function previewDiagnosticsSnapshot<T>(
	snapshot: T,
): DiagnosticsPreview<T> {
	const sensitivity: SensitivityItem[] = [];
	if (
		hasKey(snapshot, (key) =>
			["paths", "path", "home", "cwd", "target"].includes(key),
		) ||
		hasPathLikeValue(snapshot)
	) {
		sensitivity.push({
			id: "local-paths",
			label: "Local filesystem paths",
			detail:
				"Snapshot may include Agent Voice Home, queue cwd, and hook target paths.",
		});
	}
	if (
		hasKey(snapshot, (key) =>
			[
				"text",
				"summary",
				"lastError",
				"skipReason",
				"failedJobs",
				"skippedJobs",
			].includes(key),
		)
	) {
		sensitivity.push({
			id: "job-text",
			label: "Job text and logs",
			detail:
				"Failed/skipped job text and error logs may contain sensitive project context and are truncated.",
		});
	}
	if (
		hasKey(snapshot, (key) =>
			["summarizer", "summarizerUsed", "model", "provider", "config"].includes(
				key,
			),
		)
	) {
		sensitivity.push({
			id: "provider-model",
			label: "Provider and model names",
			detail:
				"Snapshot may include configured summarizer providers and model names, never credentials.",
		});
	}
	if (
		hasKey(snapshot, (key) => ["playback", "backend", "checked"].includes(key))
	) {
		sensitivity.push({
			id: "playback-diagnostics",
			label: "Playback diagnostics",
			detail: "Snapshot may include local playback backend detection details.",
		});
	}
	return { snapshot, sensitivity };
}

function rowToJob(row: JobRow, maxTextLength: number): DiagnosticsJobContext {
	return {
		id: row.id,
		agent: row.agent,
		status: row.status,
		text: truncateSensitiveText(row.text, maxTextLength),
		...(row.cwd ? { cwd: row.cwd } : {}),
		createdAt: row.created_at,
		...(row.finished_at ? { finishedAt: row.finished_at } : {}),
		...(row.summarizer_used ? { summarizerUsed: row.summarizer_used } : {}),
		...(row.skip_reason ? { skipReason: row.skip_reason } : {}),
		...(row.last_error
			? { lastError: truncateSensitiveText(row.last_error, maxTextLength) }
			: {}),
		attempts: row.attempts,
	};
}

function readJobs(
	paths: AgentVoicePaths,
	status: "failed" | "skipped",
	limit: number,
	maxTextLength: number,
): DiagnosticsJobContext[] {
	if (!existsSync(paths.db)) return [];
	const db = new Database(paths.db, { readonly: true });
	try {
		const rows = db
			.query(
				`SELECT id, agent, status, text, cwd, created_at, finished_at, summarizer_used, skip_reason, last_error, attempts
				 FROM jobs WHERE status=$status
				 ORDER BY COALESCE(finished_at, created_at) DESC, created_at DESC, id DESC LIMIT $limit`,
			)
			.all({ $status: status, $limit: limit }) as JobRow[];
		return rows.map((row) => rowToJob(row, maxTextLength));
	} finally {
		db.close();
	}
}

function runtimeName(): string {
	return typeof Bun === "object" ? "bun" : "node";
}

export function getDiagnosticsPreview(
	paths: AgentVoicePaths,
	options: DiagnosticsPreviewOptions = {},
): AppServiceResult<DiagnosticsPreview<DiagnosticsSnapshot>> {
	try {
		const env = options.installEnv ?? (process.env as InstallEnv);
		const daemonDeps = options.daemonDeps ?? {};
		const maxTextLength = sanitizeDiagnosticsTextLimit(options.maxTextLength);
		const jobLimit = Math.max(
			1,
			Math.min(100, Math.trunc(options.jobLimit ?? 20)),
		);
		const doctor = buildDoctorReport(paths, daemonDeps, env);
		const status = buildAppStatusSnapshot(paths, daemonDeps, env);
		const snapshot: DiagnosticsSnapshot = {
			version: 1,
			createdAt: new Date().toISOString(),
			doctor,
			status,
			checks: doctor.checks,
			failedJobs: readJobs(paths, "failed", jobLimit, maxTextLength),
			skippedJobs: readJobs(paths, "skipped", jobLimit, maxTextLength),
			hooks: status.install,
			paths: status.paths,
			config: status.config,
			build: { buildId: status.buildId, runtime: runtimeName() },
			playback: {
				state: "not_probed",
				checked: [],
				message: "Playback backend has not been probed by diagnostics preview.",
			},
		};
		return ok(previewDiagnosticsSnapshot(snapshot));
	} catch (error) {
		return fail(
			"INTERNAL",
			error instanceof Error ? error.message : String(error),
		);
	}
}
