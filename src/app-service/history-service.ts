import {
	buildHistorySnapshot,
	decodeHistoryCursor,
	type AppHistorySnapshot,
} from "../history";
import { openDb } from "../db";
import { clearActiveQueue, clearFailedJobs } from "../store";
import type { AgentVoicePaths } from "../paths";
import { fail, ok } from "./errors";
import type { AppServiceResult } from "./types";

export interface GetHistoryOptions {
	limit?: number;
	before?: string;
}

function parseLimit(limit: number | undefined): number | null {
	if (limit === undefined) return 50;
	if (!Number.isInteger(limit) || limit < 1 || limit > 200) return null;
	return limit;
}

export function getHistory(
	options: GetHistoryOptions = {},
	paths: AgentVoicePaths,
): AppServiceResult<AppHistorySnapshot> {
	const limit = parseLimit(options.limit);
	if (limit === null) {
		return fail("BAD_INPUT", "limit must be an integer between 1 and 200", {
			recoverable: true,
		});
	}

	const before = options.before
		? decodeHistoryCursor(options.before)
		: undefined;
	if (options.before && !before) {
		return fail("BAD_INPUT", "before must be a valid history cursor", {
			recoverable: true,
		});
	}

	try {
		return ok(buildHistorySnapshot(paths, limit, before ?? undefined));
	} catch (error) {
		return fail(
			"INTERNAL",
			error instanceof Error ? error.message : String(error),
		);
	}
}

export function clearActive(
	paths: AgentVoicePaths,
): AppServiceResult<{ cleared: number }> {
	try {
		const db = openDb(paths.db);
		try {
			return ok({ cleared: clearActiveQueue(db) });
		} finally {
			db.close();
		}
	} catch (error) {
		return fail(
			"INTERNAL",
			error instanceof Error ? error.message : String(error),
		);
	}
}

export function clearFailed(
	paths: AgentVoicePaths,
): AppServiceResult<{ cleared: number }> {
	try {
		const db = openDb(paths.db);
		try {
			return ok({ cleared: clearFailedJobs(db) });
		} finally {
			db.close();
		}
	} catch (error) {
		return fail(
			"INTERNAL",
			error instanceof Error ? error.message : String(error),
		);
	}
}
