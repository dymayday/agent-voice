import { loadConfig, type AgentVoiceConfig } from "../config";
import type { AgentVoicePaths } from "../paths";
import {
	detectPlaybackBackend,
	limitPlaybackDiagnostic,
	type CommandExists,
	type PlaybackBackend,
} from "../platform/playback";
import type { SummarizerMode } from "../summarizer-mode";
import {
	KokoroClient,
	playWav,
	type PlaybackRunner,
	type PlayWavOptions,
} from "../tts";
import { fail, ok } from "./errors";
import type { AppServiceResult, VoiceBenchResult } from "./types";

export interface TestSpeechInput {
	text: unknown;
	voice?: unknown;
	play?: boolean;
}

export interface VoiceServiceDeps {
	loadConfig?: (paths: AgentVoicePaths) => AgentVoiceConfig;
	synthesize?: (
		text: string,
		voice: string,
		config: AgentVoiceConfig,
	) => Promise<Buffer>;
	playWav?: (
		buffer: Buffer,
		paths: AgentVoicePaths,
		runner?: PlaybackRunner,
		options?: PlayWavOptions,
	) => Promise<void>;
	detectPlaybackBackend?: typeof detectPlaybackBackend;
	playbackRunner?: PlaybackRunner;
	platform?: NodeJS.Platform;
	commandExists?: CommandExists;
	now?: () => number;
}

const DEFAULT_MAX_TEST_TEXT_CHARS = 2_000;
const MAX_ERROR_MESSAGE_CHARS = 500;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function boundedMessage(message: string): string {
	return limitPlaybackDiagnostic(message, MAX_ERROR_MESSAGE_CHARS);
}

function summarizerMode(config: AgentVoiceConfig): SummarizerMode {
	return config.summarizer.priority.length === 1 &&
		config.summarizer.priority[0] === "heuristic"
		? "heuristic"
		: "default";
}

function summarizerPrivacy(config: AgentVoiceConfig): "local" | "provider" {
	return summarizerMode(config) === "heuristic" ? "local" : "provider";
}

function backendName(backend: PlaybackBackend | null): string {
	return backend?.kind === "tool" ? backend.name : "none";
}

function validateText(
	text: unknown,
	maxChars: number,
): AppServiceResult<string> {
	if (typeof text !== "string") {
		return fail("BAD_INPUT", "Voice test text must be a string", {
			recoverable: true,
		});
	}
	const trimmed = text.trim();
	if (!trimmed) {
		return fail("BAD_INPUT", "Voice test text cannot be blank", {
			recoverable: true,
		});
	}
	if (trimmed.length > maxChars) {
		return fail(
			"BAD_INPUT",
			`Voice test text is too long (maximum ${maxChars} characters)`,
			{ recoverable: true },
		);
	}
	return ok(trimmed);
}

async function defaultSynthesize(
	text: string,
	voice: string,
	config: AgentVoiceConfig,
): Promise<Buffer> {
	const client = new KokoroClient(config);
	try {
		return await client.speak(text, voice);
	} finally {
		client.dispose();
	}
}

export async function testSpeech(
	input: TestSpeechInput,
	paths: AgentVoicePaths,
	deps: VoiceServiceDeps = {},
): Promise<AppServiceResult<VoiceBenchResult>> {
	try {
		const config = (deps.loadConfig ?? loadConfig)(paths);
		const maxChars = Math.max(
			1,
			config.summarizer.maxInputChars || DEFAULT_MAX_TEST_TEXT_CHARS,
		);
		const text = validateText(input.text, maxChars);
		if (!text.ok) return text;

		const voice =
			typeof input.voice === "string" && input.voice.trim()
				? input.voice.trim()
				: config.tts.voice;
		const shouldPlay = input.play ?? true;
		const detect = deps.detectPlaybackBackend ?? detectPlaybackBackend;
		const playbackOptions: PlayWavOptions = {
			platform: deps.platform,
			commandExists: deps.commandExists,
			timeoutMs: config.tts.timeoutSeconds * 1000,
		};

		let backend: PlaybackBackend | null = null;
		if (shouldPlay) {
			try {
				backend = await detect({
					platform: deps.platform,
					commandExists: deps.commandExists,
				});
			} catch (error) {
				return fail(
					"UNAVAILABLE",
					boundedMessage(
						`Playback backend detection failed: ${errorMessage(error)}`,
					),
					{ recoverable: true },
				);
			}
			if (backend.kind === "missing") {
				return fail("UNAVAILABLE", boundedMessage(backend.message), {
					details: { checked: backend.checked },
					recoverable: true,
				});
			}
		}

		const started = deps.now?.() ?? Date.now();
		const synthesize = deps.synthesize ?? defaultSynthesize;
		const audio = await synthesize(text.value, voice, config);
		if (shouldPlay) {
			await (deps.playWav ?? playWav)(
				audio,
				paths,
				deps.playbackRunner,
				playbackOptions,
			);
		}
		const durationMs = Math.max(0, (deps.now?.() ?? Date.now()) - started);
		const name = backendName(backend);
		const result: VoiceBenchResult = {
			text: text.value,
			voice,
			backend: name,
			status: shouldPlay ? "played" : "synthesized",
			durationMs,
			summarizer: {
				mode: summarizerMode(config),
				privacy: summarizerPrivacy(config),
				model: config.summarizer.piModel,
				thinking: config.summarizer.thinking,
			},
			playback: {
				backend: name,
				durationMs,
			},
		};
		return ok(result);
	} catch (error) {
		return fail("INTERNAL", boundedMessage(errorMessage(error)), {
			recoverable: true,
		});
	}
}
