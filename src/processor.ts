import type { Database } from "bun:sqlite";
import type { AgentVoiceConfig } from "./config";
import type { AgentVoiceEvent } from "./events";
import type { SummarizeOutcome } from "./summarizers";
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
	// Returns either the summary text or a {summary, summarizerUsed} record. The
	// production summarizer returns the record so the actual summarizer (often the
	// heuristic fallback) is labeled accurately; test doubles may return a string.
	summarize: (
		event: AgentVoiceEvent,
		config: AgentVoiceConfig,
	) => Promise<string | SummarizeOutcome>;
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

// Label used only when a test double returns a bare summary string; the
// production summarizer reports its own `summarizerUsed`.
function fallbackSummarizerLabel(config: AgentVoiceConfig): string {
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

	// Resume after a crash that happened after speech completed: only the
	// explicit spoken marker means it is safe to skip replaying audio.
	if (claimed.spokenAt) {
		markDone(db, claimed.id, now());
		return { kind: "processed", id: claimed.id };
	}

	let summary: string;
	let summarizerUsed: string;
	try {
		const outcome = await deps.summarize(claimed, config);
		summary =
			typeof outcome === "string" ? outcome : outcome.summary;
		summarizerUsed =
			typeof outcome === "string"
				? fallbackSummarizerLabel(config)
				: outcome.summarizerUsed;
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

	markSpoken(db, claimed.id, summary, summarizerUsed, now());
	markDone(db, claimed.id, now());
	return { kind: "processed", id: claimed.id };
}
