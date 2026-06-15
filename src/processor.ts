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
	now = new Date(),
): Promise<ProcessNextJobResult> {
	const recovered = recoverStale(db, config, now);
	const claimed: StoredJob | null = claimNextDue(db, config, now);
	if (!claimed) return { kind: "idle", recovered };

	try {
		// Resume after a crash that happened post-speak: summary already persisted.
		if (claimed.summary) {
			markDone(db, claimed.id, now);
			return { kind: "processed", id: claimed.id };
		}

		const summary = await deps.summarize(claimed, config);
		await deps.speak(summary, config.tts.voice, claimed);
		markSpoken(db, claimed.id, summary, summarizerName(config));
		markDone(db, claimed.id, now);
		return { kind: "processed", id: claimed.id };
	} catch (error) {
		const lastError = errorMessage(error);
		const retry = scheduleRetry(claimed, config, now, lastError);
		if (retry.state === "incoming" && retry.job.nextAttemptAt) {
			requeueForRetry(db, claimed.id, retry.job.nextAttemptAt, lastError);
			return { kind: "retry_scheduled", id: claimed.id };
		}
		markFailed(db, claimed.id, now, lastError);
		return { kind: "failed", id: claimed.id };
	}
}
