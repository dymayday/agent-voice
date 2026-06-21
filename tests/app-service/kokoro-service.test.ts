import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePaths } from "../../src/paths";
import {
	createSetupConsentToken,
	getKokoroStatus,
	normalizeKokoroSetupEvent,
	runKokoroSetupWithConsent,
} from "../../src/app-service/kokoro-service";

describe("kokoro service", () => {
	test("requires consent token shape", () => {
		const token = createSetupConsentToken();
		expect(token.id).toMatch(/^kokoro-consent-/);
		expect(token.createdAt).toEqual(expect.any(String));
	});

	test("normalizes setup events for UI", () => {
		expect(
			normalizeKokoroSetupEvent({
				type: "step",
				id: "deps",
				status: "running",
				title: "Installing Python dependencies",
			}),
		).toEqual({
			type: "step",
			id: "deps",
			status: "running",
			title: "Installing Python dependencies",
		});
		expect(
			normalizeKokoroSetupEvent({
				type: "log",
				stream: "stderr",
				message: "hello",
			}),
		).toEqual({ type: "log", stream: "stderr", message: "hello" });
		expect(normalizeKokoroSetupEvent({ type: "complete", ok: true })).toEqual({
			type: "complete",
			ok: true,
		});
	});

	test("getKokoroStatus wraps buildKokoroStatus", () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-kokoro-status-"));
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const result = getKokoroStatus(paths);
			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error(result.error.message);
			expect(result.value.managedHome).toContain(home);
			expect(result.value.checks).toEqual(expect.any(Array));
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("runKokoroSetupWithConsent rejects forged token shape without running setup", async () => {
		const home = mkdtempSync(
			join(tmpdir(), "agent-voice-kokoro-forged-consent-"),
		);
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			let calls = 0;
			const runner = async () => {
				calls += 1;
				return {
					ok: true as const,
					pythonPath: "python",
					scriptPath: "script",
				};
			};

			const forgedToken = {
				id: "kokoro-consent-forged",
				createdAt: new Date().toISOString(),
			};
			expect(
				await runKokoroSetupWithConsent(paths, {
					consentToken: forgedToken,
					runner,
				}),
			).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
			expect(calls).toBe(0);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("runKokoroSetupWithConsent consumes a real consent token once", async () => {
		const home = mkdtempSync(
			join(tmpdir(), "agent-voice-kokoro-once-consent-"),
		);
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const consentToken = createSetupConsentToken();
			let calls = 0;
			const runner = async () => {
				calls += 1;
				return {
					ok: true as const,
					pythonPath: "python",
					scriptPath: "script",
				};
			};

			expect(
				await runKokoroSetupWithConsent(paths, { consentToken, runner }),
			).toMatchObject({ ok: true });
			expect(
				await runKokoroSetupWithConsent(paths, { consentToken, runner }),
			).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
			expect(calls).toBe(1);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("runKokoroSetupWithConsent rejects expired consent token without running setup", async () => {
		const home = mkdtempSync(
			join(tmpdir(), "agent-voice-kokoro-expired-consent-"),
		);
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const issuedAt = Date.parse("2026-06-21T00:00:00.000Z");
			const consentToken = createSetupConsentToken({ now: () => issuedAt });
			let calls = 0;
			const runner = async () => {
				calls += 1;
				return {
					ok: true as const,
					pythonPath: "python",
					scriptPath: "script",
				};
			};

			expect(
				await runKokoroSetupWithConsent(paths, {
					consentToken,
					now: () => issuedAt + 10 * 60 * 1000 + 1,
					runner,
				}),
			).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
			expect(calls).toBe(0);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("runKokoroSetupWithConsent rejects missing or invalid consent without running setup", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-kokoro-consent-"));
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			let calls = 0;
			const runner = async () => {
				calls += 1;
				return {
					ok: true as const,
					pythonPath: "python",
					scriptPath: "script",
				};
			};
			expect(await runKokoroSetupWithConsent(paths, { runner })).toMatchObject({
				ok: false,
				error: { code: "BAD_INPUT" },
			});
			expect(
				await runKokoroSetupWithConsent(paths, {
					consentToken: { id: "bad", createdAt: new Date().toISOString() },
					runner,
				}),
			).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
			expect(calls).toBe(0);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("runKokoroSetupWithConsent emits normalized events and returns typed result", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-kokoro-run-"));
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const consentToken = createSetupConsentToken();
			const events: ReturnType<typeof normalizeKokoroSetupEvent>[] = [];
			const result = await runKokoroSetupWithConsent(paths, {
				consentToken,
				emit: (event) => events.push(event),
				runner: async (_paths, options) => {
					options.emit?.({
						type: "step",
						id: "deps",
						status: "running",
						title: "Installing Python dependencies",
					});
					options.emit?.({ type: "log", stream: "stdout", message: "done" });
					return { ok: true, pythonPath: "python", scriptPath: "script" };
				},
			});

			expect(result).toMatchObject({
				ok: true,
				value: { ok: true, pythonPath: "python", scriptPath: "script" },
			});
			expect(events).toEqual([
				{
					type: "step",
					id: "deps",
					status: "running",
					title: "Installing Python dependencies",
				},
				{ type: "log", stream: "stdout", message: "done" },
			]);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
