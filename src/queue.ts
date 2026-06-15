import { readFileSync } from "node:fs";
import type { AgentVoiceConfig } from "./config";
import type { AgentVoiceEvent } from "./events";
import type { AgentVoicePaths } from "./paths";
import { listJobs, moveJob, replaceJob, type SpoolState } from "./spool";

export type SkipReason =
	| "disabled_system"
	| "disabled_agent"
	| "ignored_cwd"
	| "duplicate_event";

export interface QueueJob extends AgentVoiceEvent {
	attempts?: number;
	lastAttemptAt?: string;
	nextAttemptAt?: string;
}

export interface ClaimedQueueJob {
	incomingPath: string;
	processingPath: string;
	event: QueueJob;
}

export type RetryDecision =
	| { state: "incoming"; job: QueueJob }
	| { state: "failed"; job: QueueJob };

function readJob(path: string): QueueJob {
	return JSON.parse(readFileSync(path, "utf8")) as QueueJob;
}

function annotateJob(
	paths: AgentVoicePaths,
	path: string,
	job: QueueJob,
): void {
	replaceJob(paths, path, job);
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

function splitPathSegments(value: string): string[] {
	return value.split("/");
}

function matchesSegment(pattern: string, value: string): boolean {
	let patternIndex = 0;
	let valueIndex = 0;
	let lastStarIndex = -1;
	let valueIndexAfterLastStar = 0;

	while (valueIndex < value.length) {
		if (
			patternIndex < pattern.length &&
			pattern[patternIndex] !== "*" &&
			pattern[patternIndex] === value[valueIndex]
		) {
			patternIndex += 1;
			valueIndex += 1;
			continue;
		}

		if (patternIndex < pattern.length && pattern[patternIndex] === "*") {
			lastStarIndex = patternIndex;
			valueIndexAfterLastStar = valueIndex;
			patternIndex += 1;
			continue;
		}

		if (lastStarIndex !== -1) {
			patternIndex = lastStarIndex + 1;
			valueIndexAfterLastStar += 1;
			valueIndex = valueIndexAfterLastStar;
			continue;
		}

		return false;
	}

	while (patternIndex < pattern.length && pattern[patternIndex] === "*") {
		patternIndex += 1;
	}
	return patternIndex === pattern.length;
}

function matchesSegments(
	patternSegments: string[],
	cwdSegments: string[],
	patternIndex = 0,
	cwdIndex = 0,
	seen = new Set<string>(),
): boolean {
	const key = `${patternIndex}:${cwdIndex}`;
	if (seen.has(key)) return false;
	seen.add(key);

	if (patternIndex === patternSegments.length) {
		return cwdIndex === cwdSegments.length;
	}

	const patternSegment = patternSegments[patternIndex];
	if (patternSegment === "**") {
		return (
			matchesSegments(
				patternSegments,
				cwdSegments,
				patternIndex + 1,
				cwdIndex,
				seen,
			) ||
			(cwdIndex < cwdSegments.length &&
				matchesSegments(
					patternSegments,
					cwdSegments,
					patternIndex,
					cwdIndex + 1,
					seen,
				))
		);
	}

	return (
		cwdIndex < cwdSegments.length &&
		matchesSegment(patternSegment, cwdSegments[cwdIndex]) &&
		matchesSegments(
			patternSegments,
			cwdSegments,
			patternIndex + 1,
			cwdIndex + 1,
			seen,
		)
	);
}

function matchesPattern(pattern: string, cwd: string): boolean {
	return matchesSegments(splitPathSegments(pattern), splitPathSegments(cwd));
}

export function shouldSkipJob(
	event: AgentVoiceEvent,
	config: AgentVoiceConfig,
): { skip: false } | { skip: true; reason: Exclude<SkipReason, "duplicate_event"> } {
	if (!config.enabled) return { skip: true, reason: "disabled_system" };
	if (!config.agents[event.agent]?.enabled) {
		return { skip: true, reason: "disabled_agent" };
	}
	if (
		event.cwd &&
		config.ignoreCwdPatterns.some((pattern) => matchesPattern(pattern, event.cwd!))
	) {
		return { skip: true, reason: "ignored_cwd" };
	}
	return { skip: false };
}

export function markAttempt(job: QueueJob, now = new Date()): QueueJob {
	const { nextAttemptAt: _nextAttemptAt, ...rest } = job;
	return {
		...rest,
		attempts: (job.attempts ?? 0) + 1,
		lastAttemptAt: now.toISOString(),
	};
}

export function isDue(job: QueueJob, now = new Date()): boolean {
	if (!job.nextAttemptAt) return true;
	const dueAt = Date.parse(job.nextAttemptAt);
	return Number.isNaN(dueAt) || dueAt <= now.getTime();
}

export function scheduleRetry(
	job: QueueJob,
	config: AgentVoiceConfig,
	now = new Date(),
	error: string,
): RetryDecision {
	const withError = withMetadata(job, { lastError: error });
	if ((job.attempts ?? 0) >= config.spool.maxAttempts) {
		const { nextAttemptAt: _nextAttemptAt, ...failedJob } = withError;
		return { state: "failed", job: failedJob };
	}

	const attempts = Math.max(1, job.attempts ?? 1);
	const delaySeconds = Math.min(
		config.spool.retryBackoffSeconds * attempts,
		config.spool.processingTimeoutSeconds,
	);
	return {
		state: "incoming",
		job: {
			...withError,
			nextAttemptAt: new Date(now.getTime() + delaySeconds * 1000).toISOString(),
		},
	};
}

function markSkipped(
	paths: AgentVoicePaths,
	jobPath: string,
	job: QueueJob,
	reason: SkipReason,
): string {
	const skippedPath = moveJob(paths, jobPath, "skipped");
	annotateJob(paths, skippedPath, withMetadata(job, { skipReason: reason }));
	return skippedPath;
}

export function dedupeSeenEvent(
	paths: AgentVoicePaths,
	eventId: string,
	excludePath?: string,
): { seen: false } | { seen: true; path: string } {
	const states: SpoolState[] = ["done", "processing", "failed", "skipped"];
	for (const state of states) {
		for (const path of listJobs(paths, state)) {
			if (path === excludePath) continue;
			try {
				if (readJob(path).id === eventId) return { seen: true, path };
			} catch {
				// Ignore unreadable records for dedupe; validation/failure handling owns them.
			}
		}
	}
	return { seen: false };
}

export function claimNextDueJob(
	paths: AgentVoicePaths,
	config: AgentVoiceConfig,
	now = new Date(),
): ClaimedQueueJob | null {
	for (const incomingPath of listJobs(paths, "incoming")) {
		let job: QueueJob;
		try {
			job = readJob(incomingPath);
		} catch {
			moveJob(paths, incomingPath, "failed");
			continue;
		}

		if (!isDue(job, now)) continue;

		const skip = shouldSkipJob(job, config);
		if (skip.skip) {
			markSkipped(paths, incomingPath, job, skip.reason);
			continue;
		}

		const duplicate = dedupeSeenEvent(paths, job.id, incomingPath);
		if (duplicate.seen) {
			markSkipped(paths, incomingPath, job, "duplicate_event");
			continue;
		}

		const attempted = markAttempt(job, now);
		const processingPath = moveJob(paths, incomingPath, "processing");
		annotateJob(paths, processingPath, attempted);
		return { incomingPath, processingPath, event: attempted };
	}
	return null;
}

export function recoverStaleProcessing(
	paths: AgentVoicePaths,
	config: AgentVoiceConfig,
	now = new Date(),
): string[] {
	const recovered: string[] = [];
	const timeoutMs = config.spool.processingTimeoutSeconds * 1000;

	for (const processingPath of listJobs(paths, "processing")) {
		let job: QueueJob;
		try {
			job = readJob(processingPath);
		} catch {
			moveJob(paths, processingPath, "failed");
			continue;
		}

		const lastAttemptAt = job.lastAttemptAt
			? Date.parse(job.lastAttemptAt)
			: Date.parse(job.createdAt);
		if (!Number.isNaN(lastAttemptAt) && now.getTime() - lastAttemptAt <= timeoutMs) {
			continue;
		}

		const recoveredPath = moveJob(paths, processingPath, "incoming");
		annotateJob(
			paths,
			recoveredPath,
			withMetadata(job, { recoveredFrom: "stale_processing" }),
		);
		recovered.push(recoveredPath);
	}

	return recovered;
}
