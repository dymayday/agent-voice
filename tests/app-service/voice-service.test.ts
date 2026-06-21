import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, type AgentVoiceConfig } from "../../src/config";
import { resolvePaths, type AgentVoicePaths } from "../../src/paths";
import type { PlaybackRunRequest } from "../../src/tts";
import { testSpeech } from "../../src/app-service/voice-service";

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

describe("voice app service", () => {
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
