import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { openDb } from "../../src/db";
import { createEvent } from "../../src/events";
import { enqueue } from "../../src/store";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, type AgentVoiceConfig } from "../../src/config";
import { resolvePaths, type AgentVoicePaths } from "../../src/paths";
import type { PlaybackRunRequest } from "../../src/tts";
import {
	findLatestSpeakableSummary,
	speakLatest,
	testSpeech,
} from "../../src/app-service/voice-service";

function fixture() {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-voice-service-"));
	const paths = resolvePaths({ AGENT_VOICE_HOME: home });
	return { home, paths };
}

function config(overrides: Partial<AgentVoiceConfig> = {}): AgentVoiceConfig {
	return {
		...defaultConfig,
		...overrides,
		agents: { ...defaultConfig.agents, ...overrides.agents },
		spool: { ...defaultConfig.spool, ...overrides.spool },
		summarizer: { ...defaultConfig.summarizer, ...overrides.summarizer },
		tts: { ...defaultConfig.tts, ...overrides.tts },
	};
}

const wav = Buffer.from("RIFF voice bench wav");

function insertJob(
	paths: AgentVoicePaths,
	input: {
		id: string;
		status: "pending" | "processing" | "done" | "failed" | "skipped";
		createdAt: string;
		finishedAt?: string;
		summary?: string | null;
		summarizerUsed?: string | null;
	},
): void {
	const db = openDb(paths.db);
	try {
		enqueue(db, {
			...createEvent({ agent: "pi", text: `${input.id} raw text` }),
			id: input.id,
			createdAt: input.createdAt,
		});
		db.query(
			`UPDATE jobs
			 SET status=$status, finished_at=$finishedAt, summary=$summary, summarizer_used=$summarizerUsed
			 WHERE id=$id`,
		).run({
			$status: input.status,
			$finishedAt: input.finishedAt ?? null,
			$summary: input.summary ?? null,
			$summarizerUsed: input.summarizerUsed ?? null,
			$id: input.id,
		});
	} finally {
		db.close();
	}
}

describe("voice app service", () => {
	test("findLatestSpeakableSummary selects newest done job with nonblank stored summary", () => {
		const { home, paths } = fixture();
		try {
			insertJob(paths, {
				id: "old-done",
				status: "done",
				createdAt: "2026-06-15T00:00:01.000Z",
				finishedAt: "2026-06-15T00:01:00.000Z",
				summary: "Older stored summary",
				summarizerUsed: "heuristic",
			});
			insertJob(paths, {
				id: "newest-failed",
				status: "failed",
				createdAt: "2026-06-15T00:00:02.000Z",
				finishedAt: "2026-06-15T00:05:00.000Z",
				summary: "Do not speak failed",
			});
			insertJob(paths, {
				id: "newest-skipped",
				status: "skipped",
				createdAt: "2026-06-15T00:00:03.000Z",
				finishedAt: "2026-06-15T00:06:00.000Z",
				summary: "Do not speak skipped",
			});
			insertJob(paths, {
				id: "pending-summary",
				status: "pending",
				createdAt: "2026-06-15T00:00:04.000Z",
				summary: "Do not speak pending",
			});
			insertJob(paths, {
				id: "processing-summary",
				status: "processing",
				createdAt: "2026-06-15T00:00:05.000Z",
				summary: "Do not speak processing",
			});
			insertJob(paths, {
				id: "blank-done",
				status: "done",
				createdAt: "2026-06-15T00:00:06.000Z",
				finishedAt: "2026-06-15T00:07:00.000Z",
				summary: "   ",
			});
			insertJob(paths, {
				id: "latest-done",
				status: "done",
				createdAt: "2026-06-15T00:00:07.000Z",
				finishedAt: "2026-06-15T00:04:00.000Z",
				summary: "Latest stored summary",
				summarizerUsed: "pi",
			});

			expect(findLatestSpeakableSummary(paths)).toEqual({
				jobId: "latest-done",
				summary: "Latest stored summary",
				summarizerUsed: "pi",
				finishedAt: "2026-06-15T00:04:00.000Z",
			});
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("findLatestSpeakableSummary returns null when no speakable summary exists or DB is missing", () => {
		const missing = fixture();
		try {
			expect(findLatestSpeakableSummary(missing.paths)).toBeNull();
		} finally {
			rmSync(missing.home, { recursive: true, force: true });
		}

		const { home, paths } = fixture();
		try {
			insertJob(paths, {
				id: "failed-only",
				status: "failed",
				createdAt: "2026-06-15T00:00:01.000Z",
				finishedAt: "2026-06-15T00:01:00.000Z",
				summary: "not speakable",
			});
			insertJob(paths, {
				id: "blank-only",
				status: "done",
				createdAt: "2026-06-15T00:00:02.000Z",
				finishedAt: "2026-06-15T00:02:00.000Z",
				summary: "\t ",
			});
			expect(findLatestSpeakableSummary(paths)).toBeNull();
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("speakLatest plays the stored summary only without invoking summarizer providers", async () => {
		const { home, paths } = fixture();
		try {
			insertJob(paths, {
				id: "done-to-replay",
				status: "done",
				createdAt: "2026-06-15T00:00:01.000Z",
				finishedAt: "2026-06-15T00:01:00.000Z",
				summary: "Stored replay summary",
				summarizerUsed: "codex",
			});
			const played: Array<{ text: string; jobId: string }> = [];

			const result = await speakLatest(paths, {
				loadConfig: () =>
					config({
						summarizer: {
							...defaultConfig.summarizer,
							priority: ["codex-fast"],
						},
					}),
				synthesizeAndPlay: async (text, summary) => {
					played.push({ text, jobId: summary.jobId });
				},
			});

			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error(result.error.message);
			expect(played).toEqual([
				{ text: "Stored replay summary", jobId: "done-to-replay" },
			]);
			expect(result.value.summary).toBe("Stored replay summary");
			expect(result.value.summarizerUsed).toBe("codex");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("speakLatest returns NOT_FOUND when no summary exists and does not call playback", async () => {
		const { home, paths } = fixture();
		try {
			let playCount = 0;
			const result = await speakLatest(paths, {
				synthesizeAndPlay: async () => {
					playCount += 1;
				},
			});

			expect(result).toMatchObject({
				ok: false,
				error: { code: "NOT_FOUND" },
			});
			expect(playCount).toBe(0);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("speakLatest maps playback-backend-missing errors to UNAVAILABLE with bounded diagnostics", async () => {
		const { home, paths } = fixture();
		try {
			insertJob(paths, {
				id: "done-to-replay",
				status: "done",
				createdAt: "2026-06-15T00:00:01.000Z",
				finishedAt: "2026-06-15T00:01:00.000Z",
				summary: "Stored replay summary",
			});
			const result = await speakLatest(paths, {
				synthesizeAndPlay: async () => {
					throw new Error(`No playback backend found: ${"x".repeat(10_000)}`);
				},
			});

			expect(result.ok).toBe(false);
			if (result.ok) throw new Error("expected failure");
			expect(result.error.code).toBe("UNAVAILABLE");
			expect(result.error.message.length).toBeLessThan(600);
			expect(JSON.stringify(result.error).length).toBeLessThan(1200);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("speakLatest always resolves typed failures when synthesis or playback throws", async () => {
		const { home, paths } = fixture();
		try {
			insertJob(paths, {
				id: "done-to-replay",
				status: "done",
				createdAt: "2026-06-15T00:00:01.000Z",
				finishedAt: "2026-06-15T00:01:00.000Z",
				summary: "Stored replay summary",
			});
			const result = await speakLatest(paths, {
				synthesizeAndPlay: async () => {
					throw new Error("speaker exploded");
				},
			}).catch((error) => ({ rejected: true, error }));

			expect(result).toMatchObject({
				ok: false,
				error: { code: "INTERNAL" },
			});
			expect(JSON.stringify(result)).toContain("speaker exploded");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("testSpeech synthesizes through injectable TTS and plays WAV on Linux", async () => {
		const { home, paths } = fixture();
		try {
			const synthCalls: Array<{ text: string; voice: string }> = [];
			const playCalls: Array<{
				buffer: Buffer;
				paths: AgentVoicePaths;
				options?: { platform?: NodeJS.Platform };
				runner?: (request: PlaybackRunRequest) => Promise<{ ok: boolean }>;
			}> = [];

			const result = await testSpeech(
				{ text: "Hello from Voice Bench", voice: "af_bella", play: true },
				paths,
				{
					loadConfig: () =>
						config({
							tts: { ...defaultConfig.tts, voice: "af_heart" },
							summarizer: {
								...defaultConfig.summarizer,
								priority: ["heuristic"],
							},
						}),
					detectPlaybackBackend: async () => ({
						kind: "tool",
						name: "paplay",
						command: "paplay",
						checked: ["paplay"],
					}),
					synthesize: async (text, voice) => {
						synthCalls.push({ text, voice });
						return wav;
					},
					playWav: async (buffer, playPaths, runner, options) => {
						playCalls.push({ buffer, paths: playPaths, runner, options });
					},
					platform: "linux",
					commandExists: async (command) => command === "paplay",
					now: (() => {
						let tick = 10;
						return () => (tick += 25);
					})(),
				},
			);

			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error(result.error.message);
			expect(synthCalls).toEqual([
				{ text: "Hello from Voice Bench", voice: "af_bella" },
			]);
			expect(playCalls).toHaveLength(1);
			expect(playCalls[0].buffer).toBe(wav);
			expect(playCalls[0].paths).toBe(paths);
			expect(playCalls[0].options?.platform).toBe("linux");
			expect(result.value).toMatchObject({
				text: "Hello from Voice Bench",
				voice: "af_bella",
				backend: "paplay",
				status: "played",
				durationMs: 25,
			});
			expect(result.value.playback.backend).toBe("paplay");
			expect(result.value.summarizer.mode).toBe("heuristic");
			expect(result.value.summarizer.privacy).toBe("local");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("blank or too-long text returns BAD_INPUT without synthesizing", async () => {
		const { home, paths } = fixture();
		try {
			let synthCount = 0;
			const deps = {
				loadConfig: () =>
					config({
						summarizer: { ...defaultConfig.summarizer, maxInputChars: 12 },
					}),
				synthesize: async () => {
					synthCount += 1;
					return wav;
				},
			};

			const blank = await testSpeech({ text: "   " }, paths, deps);
			expect(blank).toMatchObject({
				ok: false,
				error: { code: "BAD_INPUT" },
			});

			const long = await testSpeech({ text: "x".repeat(13) }, paths, deps);
			expect(long).toMatchObject({
				ok: false,
				error: { code: "BAD_INPUT" },
			});
			expect(synthCount).toBe(0);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("loadConfig failures return INTERNAL without rejecting", async () => {
		const { home, paths } = fixture();
		try {
			const result = await testSpeech({ text: "Hello" }, paths, {
				loadConfig: () => {
					throw new Error("config exploded");
				},
			}).catch((error) => ({ rejected: true, error }));

			expect(result).toMatchObject({
				ok: false,
				error: { code: "INTERNAL" },
			});
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("playback backend detection failures return UNAVAILABLE without rejecting", async () => {
		const { home, paths } = fixture();
		try {
			let synthCount = 0;
			const result = await testSpeech({ text: "Hello", play: true }, paths, {
				loadConfig: () => config(),
				detectPlaybackBackend: async () => {
					throw new Error("probe exploded");
				},
				synthesize: async () => {
					synthCount += 1;
					return wav;
				},
				platform: "linux",
			}).catch((error) => ({ rejected: true, error }));

			expect(result).toMatchObject({
				ok: false,
				error: { code: "UNAVAILABLE" },
			});
			expect(JSON.stringify(result)).toContain("probe exploded");
			expect(synthCount).toBe(0);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("malformed text returns BAD_INPUT without synthesizing or playing", async () => {
		const { home, paths } = fixture();
		try {
			let synthCount = 0;
			let playCount = 0;
			const result = await testSpeech({ text: 123 }, paths, {
				loadConfig: () => config(),
				detectPlaybackBackend: async () => ({
					kind: "tool",
					name: "paplay",
					command: "paplay",
					checked: ["paplay"],
				}),
				synthesize: async () => {
					synthCount += 1;
					return wav;
				},
				playWav: async () => {
					playCount += 1;
				},
				platform: "linux",
			}).catch((error) => ({ rejected: true, error }));

			expect(result).toMatchObject({
				ok: false,
				error: { code: "BAD_INPUT" },
			});
			expect(synthCount).toBe(0);
			expect(playCount).toBe(0);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("missing playback backend returns UNAVAILABLE without huge diagnostics", async () => {
		const { home, paths } = fixture();
		try {
			let synthCount = 0;
			const result = await testSpeech({ text: "Hello", play: true }, paths, {
				loadConfig: () => config(),
				detectPlaybackBackend: async () => ({
					kind: "missing",
					checked: ["paplay", "aplay"],
					message: `missing ${"x".repeat(10_000)}`,
				}),
				synthesize: async () => {
					synthCount += 1;
					return wav;
				},
				platform: "linux",
			});

			expect(result.ok).toBe(false);
			if (result.ok) throw new Error("expected failure");
			expect(result.error.code).toBe("UNAVAILABLE");
			expect(result.error.message.length).toBeLessThan(600);
			expect(JSON.stringify(result.error).length).toBeLessThan(1200);
			expect(synthCount).toBe(0);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("playback failures are typed and delegate temp cleanup to playWav", async () => {
		const { home, paths } = fixture();
		try {
			let cleaned = false;
			const result = await testSpeech(
				{ text: "Cleanup check", play: true },
				paths,
				{
					loadConfig: () => config(),
					detectPlaybackBackend: async () => ({
						kind: "tool",
						name: "aplay",
						command: "aplay",
						checked: ["paplay", "aplay"],
					}),
					synthesize: async () => wav,
					playWav: async () => {
						try {
							throw new Error("speaker busy");
						} finally {
							cleaned = true;
						}
					},
					platform: "linux",
				},
			);

			expect(result.ok).toBe(false);
			if (result.ok) throw new Error("expected failure");
			expect(result.error.code).toBe("INTERNAL");
			expect(result.error.message).toContain("speaker busy");
			expect(cleaned).toBe(true);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
