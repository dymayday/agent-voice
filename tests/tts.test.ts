import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, type AgentVoiceConfig } from "../src/config";
import { resolvePaths } from "../src/paths";
import {
	KokoroClient,
	playWav,
	type KokoroSession,
	type PlaybackRunRequest,
} from "../src/tts";

async function withTempHome<T>(
	fn: (home: string) => T | Promise<T>,
): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-tts-test-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

class FakeKokoroSession implements KokoroSession {
	readonly writes: string[] = [];
	disposed = false;
	constructor(private readonly lines: string[]) {}

	writeLine(line: string): void {
		this.writes.push(line);
	}

	async readLine(): Promise<string | null> {
		return this.lines.shift() ?? null;
	}

	dispose(): void {
		this.disposed = true;
	}
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

function wavBuffer(): Buffer {
	return Buffer.from("UklGRgAAAAAA", "base64");
}

describe("agent-voice Kokoro TTS bridge", () => {
	test("sends Kokoro JSON lines and tolerates ready/progress before audio", async () => {
		const fixtureLines = readFileSync(
			join(import.meta.dir, "../fixtures/kokoro-ready-audio.jsonl"),
			"utf8",
		)
			.trim()
			.split("\n");
		const sessions: FakeKokoroSession[] = [];
		const client = new KokoroClient(defaultConfig, () => {
			const session = new FakeKokoroSession([...fixtureLines]);
			sessions.push(session);
			return session;
		});

		const audio = await client.speak("Hello world", "af_heart");

		expect(audio.equals(wavBuffer())).toBe(true);
		expect(sessions).toHaveLength(1);
		expect(sessions[0].writes).toEqual([
			JSON.stringify({ text: "Hello world", voice: "af_heart" }),
		]);
	});

	test("reuses a warm Kokoro session without waiting for a second ready line", async () => {
		const sessions: FakeKokoroSession[] = [];
		const client = new KokoroClient(defaultConfig, () => {
			const session = new FakeKokoroSession([
				JSON.stringify({ status: "ready" }),
				JSON.stringify({
					audio: wavBuffer().toString("base64"),
					duration: 0.1,
				}),
				JSON.stringify({
					audio: wavBuffer().toString("base64"),
					duration: 0.1,
				}),
			]);
			sessions.push(session);
			return session;
		});

		await client.speak("First", "af_heart");
		const secondAudio = await client.speak("Second", "af_heart");

		expect(secondAudio.equals(wavBuffer())).toBe(true);
		expect(sessions).toHaveLength(1);
		expect(sessions[0].writes).toEqual([
			JSON.stringify({ text: "First", voice: "af_heart" }),
			JSON.stringify({ text: "Second", voice: "af_heart" }),
		]);
	});

	test("playWav writes a temp WAV under run/audio, calls afplay with args and timeout, and deletes it", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const calls: PlaybackRunRequest[] = [];
			let playedPath = "";

			await playWav(
				wavBuffer(),
				paths,
				async (request) => {
					calls.push(request);
					playedPath = request.args[0];
					expect(request.cmd).toBe("afplay");
					expect(request.args).toHaveLength(1);
					expect(request.timeoutMs).toBe(1234);
					expect(playedPath.startsWith(join(paths.run, "audio"))).toBe(true);
					expect(existsSync(playedPath)).toBe(true);
					expect(readFileSync(playedPath).equals(wavBuffer())).toBe(true);
					return { ok: true };
				},
				{ timeoutMs: 1234 },
			);

			expect(calls).toHaveLength(1);
			expect(existsSync(playedPath)).toBe(false);
		});
	});

	test("playWav deletes the temp file after playback failure", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			let playedPath = "";

			await expect(
				playWav(wavBuffer(), paths, async (request) => {
					playedPath = request.args[0];
					expect(existsSync(playedPath)).toBe(true);
					return { ok: false, exitCode: 1, stderr: "speaker busy" };
				}),
			).rejects.toThrow("afplay failed");

			expect(existsSync(playedPath)).toBe(false);
		});
	});

	test("playWav deletes the temp file when playback times out", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			let playedPath = "";

			await expect(
				playWav(
					wavBuffer(),
					paths,
					async (request) => {
						playedPath = request.args[0];
						expect(request.timeoutMs).toBe(5);
						expect(existsSync(playedPath)).toBe(true);
						throw new Error("afplay timed out");
					},
					{ timeoutMs: 5 },
				),
			).rejects.toThrow("afplay timed out");

			expect(existsSync(playedPath)).toBe(false);
		});
	});

	test("Kokoro readiness wait respects configured timeout", async () => {
		class HangingKokoroSession extends FakeKokoroSession {
			async readLine(): Promise<string | null> {
				return await new Promise<string | null>(() => {});
			}
		}
		const client = new KokoroClient(
			config({ tts: { ...defaultConfig.tts, timeoutSeconds: 0.01 } }),
			() => new HangingKokoroSession([]),
		);

		const outcome = await Promise.race([
			client.speak("This should timeout", "af_heart").then(
				() => "resolved",
				() => "rejected",
			),
			Bun.sleep(100).then(() => "hung"),
		]);

		expect(outcome).toBe("rejected");
	});

	test("Kokoro readiness error includes subprocess stderr", async () => {
		await withTempHome(async (home) => {
			const scriptPath = join(home, "kokoro-fails.sh");
			writeFileSync(
				scriptPath,
				"printf 'ModuleNotFoundError: No module named tqdm\\n' >&2\nexit 1\n",
			);
			const client = new KokoroClient(
				config({
					tts: {
						...defaultConfig.tts,
						python: "bash",
						kokoroScript: scriptPath,
					},
				}),
			);

			await client.ensureReady().then(
				() => {
					throw new Error("Expected Kokoro readiness to fail");
				},
				(error) => {
					expect(String(error)).toContain("ModuleNotFoundError");
				},
			);
		});
	});

	test("Kokoro restarts once after invalid JSON and retries the job", async () => {
		const sessions: FakeKokoroSession[] = [];
		const lineSets = [
			[JSON.stringify({ status: "ready" }), "not json"],
			[
				JSON.stringify({ status: "ready" }),
				JSON.stringify({
					audio: wavBuffer().toString("base64"),
					duration: 0.1,
				}),
			],
		];
		const client = new KokoroClient(defaultConfig, () => {
			const session = new FakeKokoroSession(lineSets[sessions.length]);
			sessions.push(session);
			return session;
		});

		const audio = await client.speak("Retry this", "af_heart");

		expect(audio.equals(wavBuffer())).toBe(true);
		expect(sessions).toHaveLength(2);
		expect(sessions[0].disposed).toBe(true);
		expect(sessions[1].writes).toEqual([
			JSON.stringify({ text: "Retry this", voice: "af_heart" }),
		]);
	});

	test("Kokoro retry failure includes the original failure context", async () => {
		const sessions: FakeKokoroSession[] = [];
		const lineSets = [
			[JSON.stringify({ status: "ready" }), JSON.stringify({ error: "first boom" })],
			[JSON.stringify({ status: "ready" }), JSON.stringify({ error: "second boom" })],
		];
		const client = new KokoroClient(defaultConfig, () => {
			const session = new FakeKokoroSession(lineSets[sessions.length]);
			sessions.push(session);
			return session;
		});

		await expect(client.speak("Retry and fail", "af_heart")).rejects.toThrow(
			"original failure: Kokoro error: first boom",
		);
		expect(sessions).toHaveLength(2);
		expect(sessions[0].disposed).toBe(true);
	});

	test("Kokoro restarts once after an error response", async () => {
		const sessions: FakeKokoroSession[] = [];
		const lineSets = [
			[
				JSON.stringify({ status: "ready" }),
				JSON.stringify({ error: "No audio generated" }),
			],
			[
				JSON.stringify({ status: "ready" }),
				JSON.stringify({
					audio: wavBuffer().toString("base64"),
					duration: 0.1,
				}),
			],
		];
		const client = new KokoroClient(defaultConfig, () => {
			const session = new FakeKokoroSession(lineSets[sessions.length]);
			sessions.push(session);
			return session;
		});

		const audio = await client.speak("Retry after error", "af_heart");

		expect(audio.equals(wavBuffer())).toBe(true);
		expect(sessions).toHaveLength(2);
		expect(sessions[0].disposed).toBe(true);
	});
});
