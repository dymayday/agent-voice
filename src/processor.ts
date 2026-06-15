import { readFileSync } from "node:fs";
import type { AgentVoiceConfig } from "./config";
import type { AgentVoiceEvent } from "./events";
import type { AgentVoicePaths } from "./paths";
import {
	claimNextDueJob,
	recoverStaleProcessing,
	scheduleRetry,
	type QueueJob,
} from "./queue";
import { moveJob, replaceJob } from "./spool";

export interface ProcessorDeps {
	summarize: (
		event: AgentVoiceEvent,
		config: AgentVoiceConfig,
	) => Promise<string>;
	speak: (
		summary: string,
		voice: string,
		event: AgentVoiceEvent,
	) => Promise<void>;
}

export type ProcessNextJobResult =
	| { kind: "idle"; recovered: string[] }
	| { kind: "processed"; processingPath: string; donePath: string }
	| { kind: "retry_scheduled"; processingPath: string; incomingPath: string }
	| { kind: "failed"; processingPath: string; failedPath: string };

function readJob(path: string): QueueJob {
	return JSON.parse(readFileSync(path, "utf8")) as QueueJob;
}

function withMetadata(
	job: QueueJob,
	metadata: Record<string, unknown>,
): QueueJob {
	return {
		...job,
		metadata: {
			...(job.metadata ?? {}),
			...metadata,
		},
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function spokenSummary(job: QueueJob): string | null {
	const summary = job.metadata?.summary;
	const spokenAt = job.metadata?.spokenAt;
	return typeof summary === "string" && typeof spokenAt === "string"
		? summary
		: null;
}

function finishJob(
	paths: AgentVoicePaths,
	processingPath: string,
	job: QueueJob,
	metadata: Record<string, unknown>,
): { processingPath: string; donePath: string } {
	const donePath = moveJob(paths, processingPath, "done");
	if (Object.keys(metadata).length > 0) {
		replaceJob(paths, donePath, withMetadata(job, metadata));
	}
	return { processingPath, donePath };
}

function failJob(
	paths: AgentVoicePaths,
	processingPath: string,
	job: QueueJob,
	metadata: Record<string, unknown>,
): { processingPath: string; failedPath: string } {
	const failedPath = moveJob(paths, processingPath, "failed");
	replaceJob(paths, failedPath, withMetadata(job, metadata));
	return { processingPath, failedPath };
}

export async function processNextJob(
	paths: AgentVoicePaths,
	config: AgentVoiceConfig,
	deps: ProcessorDeps,
	now = new Date(),
): Promise<ProcessNextJobResult> {
	const recovered = recoverStaleProcessing(paths, config, now);
	const claimed = claimNextDueJob(paths, config, now);
	if (!claimed) return { kind: "idle", recovered };

	let latestJob = readJob(claimed.processingPath);
	let spokenJobForFailure: QueueJob | null = null;
	try {
		const existingSummary = spokenSummary(latestJob);
		if (existingSummary) {
			return {
				kind: "processed",
				...finishJob(paths, claimed.processingPath, latestJob, {
					summary: existingSummary,
				}),
			};
		}

		const summary = await deps.summarize(latestJob, config);
		await deps.speak(summary, config.tts.voice, latestJob);
		latestJob = readJob(claimed.processingPath);
		const spokenJob = withMetadata(latestJob, {
			summary,
			spokenAt: now.toISOString(),
		});
		spokenJobForFailure = spokenJob;
		replaceJob(paths, claimed.processingPath, spokenJob);
		return {
			kind: "processed",
			...finishJob(paths, claimed.processingPath, spokenJob, {}),
		};
	} catch (error) {
		latestJob = readJob(claimed.processingPath);
		const lastError = errorMessage(error);
		const alreadySpokenSummary = spokenSummary(latestJob);
		const spokenFailureSummary = spokenJobForFailure
			? spokenSummary(spokenJobForFailure)
			: null;
		const failedSpokenSummary = alreadySpokenSummary ?? spokenFailureSummary;
		if (failedSpokenSummary) {
			return {
				kind: "failed",
				...failJob(
					paths,
					claimed.processingPath,
					spokenJobForFailure ?? latestJob,
					{ summary: failedSpokenSummary, lastError },
				),
			};
		}

		const retry = scheduleRetry(latestJob, config, now, lastError);
		if (retry.state === "incoming") {
			const incomingPath = moveJob(paths, claimed.processingPath, "incoming");
			replaceJob(paths, incomingPath, retry.job);
			return {
				kind: "retry_scheduled",
				processingPath: claimed.processingPath,
				incomingPath,
			};
		}

		return {
			kind: "failed",
			...failJob(paths, claimed.processingPath, retry.job, {}),
		};
	}
}

export function requeueProcessingJob(
	paths: AgentVoicePaths,
	processingPath: string,
	reason: string,
): string {
	const job = readJob(processingPath);
	const incomingPath = moveJob(paths, processingPath, "incoming");
	replaceJob(
		paths,
		incomingPath,
		withMetadata(job, { requeuedReason: reason }),
	);
	return incomingPath;
}
