import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db";
import { createEvent } from "../../src/events";
import type { InstallEnv } from "../../src/install";
import { resolvePaths } from "../../src/paths";
import { enqueue, markFailed, markSkipped } from "../../src/store";
import {
	DEFAULT_DIAGNOSTICS_TEXT_LIMIT,
	MAX_DIAGNOSTICS_TEXT_LIMIT,
	getDiagnosticsPreview,
	previewDiagnosticsSnapshot,
	truncateSensitiveText,
} from "../../src/app-service/diagnostics-service";

function fixture() {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-diagnostics-service-"));
	const paths = resolvePaths({ AGENT_VOICE_HOME: home });
	const db = openDb(paths.db);
	return { home, paths, db };
}

function addFailedJobWithLongSensitiveText(db: ReturnType<typeof openDb>) {
	const longText = "secret job text ".repeat(400);
	const longError = "very long failure log ".repeat(400);
	const failed = createEvent({ agent: "codex", text: longText });
	enqueue(db, failed);
	markFailed(db, failed.id, new Date("2026-06-21T00:00:00.000Z"), longError);
	return { longText, longError };
}

describe("diagnostics service", () => {
	test("truncates long sensitive text", () => {
		const truncated = truncateSensitiveText("x".repeat(5000), 100);
		expect(truncated).toHaveLength(103);
		expect(truncated.endsWith("...")).toBe(true);
	});

	test("preview labels local paths job text provider model and playback diagnostics as sensitive", () => {
		const preview = previewDiagnosticsSnapshot({
			status: {
				paths: { home: "/home/me/.agent-voice" },
				config: { agents: { pi: { enabled: true, mode: "native" } } },
			},
			failedJobs: [
				{ text: "secret token maybe", summarizerUsed: "codex-fast" },
			],
			playback: { checked: ["paplay", "aplay"] },
		});
		const ids = preview.sensitivity.map((item) => item.id);
		expect(ids).toContain("local-paths");
		expect(ids).toContain("job-text");
		expect(ids).toContain("provider-model");
		expect(ids).toContain("playback-diagnostics");
	});

	test("getDiagnosticsPreview caps invalid and oversized maxTextLength values", () => {
		const cases = [
			{
				name: "NaN",
				maxTextLength: Number.NaN,
				cap: DEFAULT_DIAGNOSTICS_TEXT_LIMIT,
			},
			{
				name: "Infinity",
				maxTextLength: Infinity,
				cap: DEFAULT_DIAGNOSTICS_TEXT_LIMIT,
			},
			{ name: "zero", maxTextLength: 0, cap: 1 },
			{ name: "negative", maxTextLength: -100, cap: 1 },
			{
				name: "huge finite",
				maxTextLength: Number.MAX_SAFE_INTEGER,
				cap: MAX_DIAGNOSTICS_TEXT_LIMIT,
			},
		];

		for (const { name, maxTextLength, cap } of cases) {
			const { home, paths, db } = fixture();
			try {
				addFailedJobWithLongSensitiveText(db);
				db.close();

				const result = getDiagnosticsPreview(paths, {
					daemonDeps: { isPidAlive: () => false },
					installEnv: { HOME: home } as unknown as InstallEnv,
					maxTextLength,
				});

				expect(result.ok, name).toBe(true);
				if (!result.ok) throw new Error(result.error.message);
				const failedJob = result.value.snapshot.failedJobs[0];
				expect(failedJob.text.length, name).toBeLessThanOrEqual(cap + 3);
				expect(failedJob.lastError?.length, name).toBeLessThanOrEqual(cap + 3);
				expect(failedJob.text.endsWith("..."), name).toBe(true);
				expect(failedJob.lastError?.endsWith("..."), name).toBe(true);
			} finally {
				rmSync(home, { recursive: true, force: true });
			}
		}
	});

	test("getDiagnosticsPreview returns privacy-safe typed snapshot", () => {
		const { home, paths, db } = fixture();
		try {
			addFailedJobWithLongSensitiveText(db);
			const skipped = createEvent({ agent: "pi", text: "skipped text" });
			enqueue(db, skipped);
			markSkipped(
				db,
				skipped.id,
				"disabled_agent",
				new Date("2026-06-21T00:01:00.000Z"),
			);
			db.close();

			const installEnv = {
				HOME: home,
				AGENT_VOICE_SECRET: "must-not-leak",
			} as unknown as InstallEnv;
			const result = getDiagnosticsPreview(paths, {
				daemonDeps: { isPidAlive: () => false },
				installEnv,
				maxTextLength: 100,
				playback: { platform: "linux", commandExists: (cmd) => cmd === "aplay" },
			});

			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error(result.error.message);
			expect(result.value.snapshot).toMatchObject({
				version: 1,
				doctor: { version: 1 },
				status: { version: 1 },
				checks: expect.any(Array),
			});
			expect(result.value.snapshot.failedJobs[0].text).toHaveLength(103);
			expect(result.value.snapshot.failedJobs[0].lastError).toHaveLength(103);
			expect(result.value.snapshot.skippedJobs[0].text).toBe("skipped text");
			expect(result.value.snapshot.playback).toMatchObject({
				state: "available",
				backend: "aplay",
				checked: ["paplay", "aplay"],
			});
			expect(JSON.stringify(result.value.snapshot)).not.toContain(
				"must-not-leak",
			);
			expect(JSON.stringify(result.value)).not.toContain("AGENT_VOICE_SECRET");
			const ids = result.value.sensitivity.map((item) => item.id);
			expect(ids).toContain("local-paths");
			expect(ids).toContain("job-text");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
