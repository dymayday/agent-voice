import type { AgentVoiceConfig } from "./config";
import type { AgentVoiceEvent } from "./events";

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

export type RetryDecision =
	| { state: "incoming"; job: QueueJob }
	| { state: "failed"; job: QueueJob };

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
):
	| { skip: false }
	| { skip: true; reason: Exclude<SkipReason, "duplicate_event"> } {
	if (!config.enabled) return { skip: true, reason: "disabled_system" };
	if (!config.agents[event.agent]?.enabled) {
		return { skip: true, reason: "disabled_agent" };
	}
	if (
		event.cwd &&
		config.ignoreCwdPatterns.some((pattern) =>
			matchesPattern(pattern, event.cwd!),
		)
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
			nextAttemptAt: new Date(
				now.getTime() + delaySeconds * 1000,
			).toISOString(),
		},
	};
}
