import { describe, expect, test } from "bun:test";
import { APP_SERVICE_ERROR_CODES } from "../../src/app-service/types";
import type {
	AppConfigDraft,
	AppServiceErrorCode,
	QueueSnapshot,
	SystemStatus,
	VoiceBenchResult,
} from "../../src/app-service/types";
import { fail, ok } from "../../src/app-service/errors";

function acceptsErrorCode(code: AppServiceErrorCode): AppServiceErrorCode {
	return code;
}

describe("app-service contracts", () => {
	test("ok wraps a successful value", () => {
		expect(ok({ value: 1 })).toEqual({ ok: true, value: { value: 1 } });
	});

	test("fail wraps typed errors with optional details", () => {
		expect(
			fail("BAD_INPUT", "Nope", {
				details: { field: "voice" },
				recoverable: false,
			}),
		).toEqual({
			ok: false,
			error: {
				code: "BAD_INPUT",
				message: "Nope",
				details: { field: "voice" },
				recoverable: false,
			},
		});

		expect(fail("BAD_INPUT", "Nope")).toEqual({
			ok: false,
			error: {
				code: "BAD_INPUT",
				message: "Nope",
				recoverable: true,
			},
		});
	});

	test("error codes are available as a runtime list", () => {
		const required = [
			"BAD_INPUT",
			"NOT_FOUND",
			"UNAVAILABLE",
			"INTERNAL",
			"TIMEOUT",
			"CONFLICT",
		] as const;
		for (const code of required) {
			expect(APP_SERVICE_ERROR_CODES).toContain(code);
			expect(acceptsErrorCode(code)).toBe(code);
		}
	});

	test("public DTOs accept representative fixtures", () => {
		const status: SystemStatus = {
			version: 1,
			buildId: null,
			daemon: { state: "running", running: true, pid: 1234 },
			kokoro: { state: "ready", voice: "af_heart" },
			playback: { state: "available", backend: "paplay" },
			queue: { pending: 1, processing: 0, done: 2, failed: 0, skipped: 0 },
			attention: [],
			latestEvent: {
				id: "evt-1",
				agent: "codex",
				text: "Build passed",
				createdAt: "2026-06-21T00:00:00.000Z",
			},
		};

		const queue: QueueSnapshot = {
			version: 1,
			counts: { pending: 1, processing: 0, done: 2, failed: 0, skipped: 0 },
			jobs: [
				{
					id: "job-1",
					agent: "codex",
					status: "done",
					text: "Finished task",
					createdAt: "2026-06-21T00:00:00.000Z",
					finishedAt: "2026-06-21T00:00:01.000Z",
					summary: "Done",
					attempts: 1,
				},
			],
			pageInfo: { limit: 25, hasMore: false, nextCursor: null },
		};

		const voiceBench: VoiceBenchResult = {
			text: "Hello",
			voice: "af_heart",
			summarizer: { mode: "heuristic", privacy: "local" },
			playback: { backend: "paplay", durationMs: 500 },
		};

		const draft: AppConfigDraft = {
			enabled: true,
			summarizer: {
				mode: "heuristic",
				codexModel: "gpt-5.3-codex",
				piModel: "openai-codex/gpt-5.5",
				opencodeModel: null,
				thinking: "low",
			},
			tts: { voice: "af_heart", timeoutSeconds: 30 },
			ui: { desktopCapsule: { enabled: false } },
		};

		expect(status.daemon.state).toBe("running");
		expect(queue.jobs[0]?.status).toBe("done");
		expect(voiceBench.summarizer.privacy).toBe("local");
		expect(draft.ui?.desktopCapsule?.enabled).toBe(false);
	});
});
