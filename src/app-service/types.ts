import type { AgentName, SummarizerName, SummarizerThinking } from "../config";
import type { JobStatus } from "../store";
import type { SummarizerMode } from "../summarizer-mode";

export const APP_SERVICE_ERROR_CODES = [
	"BAD_INPUT",
	"NOT_FOUND",
	"UNAVAILABLE",
	"INTERNAL",
	"TIMEOUT",
	"CONFLICT",
] as const;

export type AppServiceErrorCode = (typeof APP_SERVICE_ERROR_CODES)[number];

export interface AppServiceError {
	code: AppServiceErrorCode;
	message: string;
	details?: unknown;
	recoverable: boolean;
}

export type AppServiceResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: AppServiceError };

export type IsoDateString = string;

export type QueueCounts = Record<JobStatus, number>;

export interface LatestEventSummary {
	id: string;
	agent: AgentName | string;
	text: string;
	createdAt: IsoDateString;
	summary?: string;
	summarizerUsed?: SummarizerName | string;
}

export interface SystemStatus {
	version: 1;
	buildId: string | null;
	daemon: {
		state: "running" | "stale" | "stopped";
		running: boolean;
		pid: number | null;
	};
	kokoro: {
		state: "ready" | "missing" | "installing" | "error";
		voice?: string;
		message?: string;
	};
	playback: {
		state: "available" | "missing" | "error";
		backend?: "paplay" | "aplay" | "afplay" | string;
		checked?: string[];
		message?: string;
	};
	queue: QueueCounts;
	attention: string[];
	latestEvent?: LatestEventSummary;
}

export interface QueueJobSummary {
	id: string;
	agent: AgentName | string;
	status: JobStatus;
	text: string;
	cwd?: string;
	createdAt: IsoDateString;
	finishedAt?: IsoDateString;
	summary?: string;
	summarizerUsed?: SummarizerName | string;
	skipReason?: string;
	lastError?: string;
	attempts: number;
}

export interface QueuePageInfo {
	limit: number;
	hasMore: boolean;
	nextCursor: string | null;
}

export interface QueueSnapshot {
	version: 1;
	counts: QueueCounts;
	jobs: QueueJobSummary[];
	pageInfo: QueuePageInfo;
}

export interface VoiceBenchResult {
	text: string;
	voice: string;
	summarizer: {
		mode: SummarizerMode;
		privacy: "local" | "provider";
		model?: string | null;
		thinking?: SummarizerThinking;
	};
	playback: {
		backend: "paplay" | "aplay" | "afplay" | string;
		durationMs?: number;
	};
}

export interface AppConfigDraft {
	enabled?: boolean;
	summarizer?: {
		mode?: SummarizerMode;
		priority?: SummarizerName[];
		codexModel?: string;
		piModel?: string;
		opencodeModel?: string | null;
		thinking?: SummarizerThinking;
		timeoutSeconds?: number;
		maxInputChars?: number;
		maxSummaryChars?: number;
	};
	tts?: {
		voice?: string;
		timeoutSeconds?: number;
	};
	ui?: {
		desktopCapsule?: {
			enabled?: boolean;
		};
	};
}
