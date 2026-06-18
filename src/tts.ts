import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentVoiceConfig } from "./config";
import {
	createReadableLineReader,
	messageToAudio,
	readKokoroMessageBeforeDeadline,
	type KokoroProtocolSession,
} from "./kokoro/protocol";
import type { AgentVoicePaths } from "./paths";

export interface KokoroSession extends KokoroProtocolSession {
	writeLine(line: string): void;
	dispose(): void;
}

export interface PlaybackRunRequest {
	cmd: string;
	args: string[];
	timeoutMs: number;
}

export type PlaybackRunResult =
	| { ok: true; stdout?: string; stderr?: string; exitCode?: number }
	| { ok: false; stdout?: string; stderr?: string; exitCode?: number };

export type PlaybackRunner = (
	request: PlaybackRunRequest,
) => Promise<PlaybackRunResult>;

export type KokoroSessionFactory = () => KokoroSession;

export interface PlayWavOptions {
	timeoutMs?: number;
}

const DEFAULT_PLAYBACK_TIMEOUT_MS = 30_000;

class BunKokoroSession implements KokoroSession {
	private readonly proc: ReturnType<typeof Bun.spawn>;
	private readonly readStdoutLine: () => Promise<string | null>;
	private readonly stderrText: Promise<string>;

	constructor(config: AgentVoiceConfig) {
		this.proc = Bun.spawn([config.tts.python, config.tts.kokoroScript], {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		const stdout = this.proc.stdout;
		if (!stdout || typeof stdout === "number") {
			throw new Error("Kokoro stdout is not readable");
		}
		this.readStdoutLine = createReadableLineReader(stdout);
		this.stderrText = streamToText(this.proc.stderr);
	}

	writeLine(line: string): void {
		const stdin = this.proc.stdin;
		if (!stdin || typeof stdin === "number") {
			throw new Error("Kokoro stdin is not writable");
		}
		stdin.write(`${line}\n`);
	}

	async readLine(): Promise<string | null> {
		return await this.readStdoutLine();
	}

	async readStderr(): Promise<string> {
		return await this.stderrText;
	}

	dispose(): void {
		try {
			this.proc.kill();
		} catch {
			// Best-effort cleanup only.
		}
	}
}

function defaultSessionFactory(config: AgentVoiceConfig): KokoroSessionFactory {
	return () => new BunKokoroSession(config);
}

export class KokoroClient {
	private session: KokoroSession | null = null;
	private ready = false;

	constructor(
		private readonly config: AgentVoiceConfig,
		private readonly createSession: KokoroSessionFactory = defaultSessionFactory(
			config,
		),
		private readonly onRetry?: (message: string) => void,
	) {}

	async ensureReady(): Promise<void> {
		if (this.ready) return;
		const session = this.getSession();
		const deadline = Date.now() + this.config.tts.timeoutSeconds * 1000;

		while (true) {
			const message = await readKokoroMessageBeforeDeadline(
				session,
				deadline,
				"ready",
			);
			if (message.kind === "error") {
				throw new Error(`Kokoro error: ${message.error}`);
			}
			if (message.kind === "status" && message.status === "ready") {
				this.ready = true;
				return;
			}
		}
	}

	async speak(text: string, voice: string): Promise<Buffer> {
		try {
			return await this.speakOnce(text, voice);
		} catch (error) {
			const originalMessage = error instanceof Error ? error.message : String(error);
			this.onRetry?.(`Kokoro TTS failed; restarting once: ${originalMessage}`);
			this.restart();
			try {
				return await this.speakOnce(text, voice);
			} catch (retryError) {
				const retryMessage =
					retryError instanceof Error ? retryError.message : String(retryError);
				throw new Error(
					`${retryMessage} (original failure: ${originalMessage})`,
					{ cause: retryError },
				);
			}
		}
	}

	dispose(): void {
		this.session?.dispose();
		this.session = null;
		this.ready = false;
	}

	private getSession(): KokoroSession {
		this.session ??= this.createSession();
		return this.session;
	}

	private restart(): void {
		this.dispose();
		this.session = this.createSession();
	}

	private async speakOnce(text: string, voice: string): Promise<Buffer> {
		await this.ensureReady();
		const session = this.getSession();
		session.writeLine(JSON.stringify({ text, voice }));
		const deadline = Date.now() + this.config.tts.timeoutSeconds * 1000;

		while (true) {
			const message = await readKokoroMessageBeforeDeadline(
				session,
				deadline,
				"audio",
			);
			if (message.kind === "error") {
				throw new Error(`Kokoro error: ${message.error}`);
			}
			const audio = messageToAudio(message);
			if (audio) return audio;
		}
	}
}

function audioDir(paths: AgentVoicePaths): string {
	return join(paths.run, "audio");
}

async function streamToText(
	stream: ReadableStream<Uint8Array> | number | undefined,
): Promise<string> {
	if (!stream || typeof stream === "number") return "";
	return await new Response(stream).text();
}

async function defaultPlaybackRunner(
	request: PlaybackRunRequest,
): Promise<PlaybackRunResult> {
	let timedOut = false;
	const proc = Bun.spawn([request.cmd, ...request.args], {
		stdout: "pipe",
		stderr: "pipe",
	});

	const timeout = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, request.timeoutMs);

	try {
		const [exitCode, stdout, stderr] = await Promise.all([
			proc.exited,
			streamToText(proc.stdout),
			streamToText(proc.stderr),
		]);
		if (exitCode === 0 && !timedOut)
			return { ok: true, stdout, stderr, exitCode };
		return {
			ok: false,
			stdout,
			stderr: timedOut ? "afplay timed out" : stderr,
			exitCode,
		};
	} finally {
		clearTimeout(timeout);
	}
}

export async function playWav(
	buffer: Buffer,
	paths: AgentVoicePaths,
	runner: PlaybackRunner = defaultPlaybackRunner,
	options: PlayWavOptions = {},
): Promise<void> {
	const dir = audioDir(paths);
	mkdirSync(dir, { recursive: true });
	const wavPath = join(dir, `agent-voice-${crypto.randomUUID()}.wav`);
	try {
		writeFileSync(wavPath, buffer, { flag: "wx" });
		const result = await runner({
			cmd: "afplay",
			args: [wavPath],
			timeoutMs: options.timeoutMs ?? DEFAULT_PLAYBACK_TIMEOUT_MS,
		});
		if (!result.ok) {
			throw new Error(
				`afplay failed${result.stderr ? `: ${result.stderr}` : ""}`,
			);
		}
	} finally {
		if (existsSync(wavPath)) rmSync(wavPath, { force: true });
	}
}
