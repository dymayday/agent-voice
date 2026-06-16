import type { Database } from "bun:sqlite";
import type { AgentVoiceConfig } from "./config";
import type { AgentVoiceEvent } from "./events";
import { scheduleRetry } from "./queue";
import {
	claimNextDue,
	markDone,
	markFailed,
	markSpoken,
	recoverStale,
	requeueForRetry,
	type StoredJob,
} from "./store";

export interface ProcessorDeps {
	summarize: (event: AgentVoiceEvent, config: AgentVoiceConfig) => Promise<string>;
	speak: (summary: string, voice: string, event: AgentVoiceEvent) => Promise<void>;
	prewarm?: () => Promise<void>;
}

export type ProcessNextJobResult =
	| { kind: "idle"; recovered: string[] }
	| { kind: "processed"; id: string }
	| { kind: "retry_scheduled"; id: string }
	| { kind: "failed"; id: string };

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function summarizerName(config: AgentVoiceConfig): string {
	return config.summarizer.priority[0] ?? "heuristic";
}

export async function processNextJob(
	db: Database,
	config: AgentVoiceConfig,
	deps: ProcessorDeps,
	now: () => Date = () => new Date(),
): Promise<ProcessNextJobResult> {
	const claimNow = now();
	const recovered = recoverStale(db, config, claimNow);
	const claimed: StoredJob | null = claimNextDue(db, config, claimNow);
	if (!claimed) return { kind: "idle", recovered };

	// Resume after a crash that happened post-speak: summary already persisted.
	if (claimed.summary) {
		markDone(db, claimed.id, now());
		return { kind: "processed", id: claimed.id };
	}

	let summary: string;
	try {
		summary = await deps.summarize(claimed, config);
	} catch (error) {
		const failNow = now();
		const lastError = errorMessage(error);
		const retry = scheduleRetry(claimed, config, failNow, lastError);
		if (retry.state === "incoming" && retry.job.nextAttemptAt) {
			requeueForRetry(db, claimed.id, retry.job.nextAttemptAt, lastError);
			return { kind: "retry_scheduled", id: claimed.id };
		}
		markFailed(db, claimed.id, failNow, lastError);
		return { kind: "failed", id: claimed.id };
	}

	try {
		await deps.speak(summary, config.tts.voice, claimed);
	} catch (error) {
		// TTS failure is terminal: the summary is computed but cannot be spoken.
		// Do not enter retry backoff — a broken Kokoro must never stall the queue.
		markFailed(db, claimed.id, now(), `speak failed: ${errorMessage(error)}`);
		return { kind: "failed", id: claimed.id };
	}

	markSpoken(db, claimed.id, summary, summarizerName(config));
	markDone(db, claimed.id, now());
	return { kind: "processed", id: claimed.id };
}
