import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentVoiceConfig } from "./config";
import type { AgentVoicePaths } from "./paths";

export interface KokoroSession {
	writeLine(line: string): void;
	readLine(): Promise<string | null>;
	readStderr?(): Promise<string>;
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

interface KokoroMessage {
	status?: string;
	audio?: string;
	duration?: number;
	error?: string;
}

class BunKokoroSession implements KokoroSession {
	private readonly proc: ReturnType<typeof Bun.spawn>;
	private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
	private readonly stderrText: Promise<string>;
	private buffered = "";
	private decoder = new TextDecoder();

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
		this.reader = stdout.getReader();
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
		while (true) {
			const newlineIndex = this.buffered.indexOf("\n");
			if (newlineIndex !== -1) {
				const line = this.buffered.slice(0, newlineIndex);
				this.buffered = this.buffered.slice(newlineIndex + 1);
				return line;
			}

			const chunk = await this.reader.read();
			if (chunk.done) {
				if (this.buffered.length === 0) return null;
				const line = this.buffered;
				this.buffered = "";
				return line;
			}
			this.buffered += this.decoder.decode(chunk.value, { stream: true });
		}
	}

	async readStderr(): Promise<string> {
		return await this.stderrText;
	}

	dispose(): void {
		try {
			this.reader.releaseLock();
		} catch {
			// Best-effort cleanup only.
		}
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

function parseKokoroLine(line: string): KokoroMessage {
	const parsed = JSON.parse(line) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Invalid Kokoro response");
	}
	return parsed as KokoroMessage;
}

function messageToAudio(message: KokoroMessage): Buffer | null {
	if (typeof message.audio !== "string" || message.audio.length === 0) {
		return null;
	}
	return Buffer.from(message.audio, "base64");
}

async function readLineBeforeDeadline(
	session: KokoroSession,
	deadline: number,
	phase: "ready" | "audio",
): Promise<string | null> {
	const remainingMs = deadline - Date.now();
	if (remainingMs <= 0) {
		throw new Error(`Timed out waiting for Kokoro ${phase}`);
	}

	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			session.readLine(),
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(
					() => reject(new Error(`Timed out waiting for Kokoro ${phase}`)),
					remainingMs,
				);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

async function exitedBeforeMessage(
	session: KokoroSession,
	phase: "ready" | "audio",
): Promise<string> {
	if (!session.readStderr) return `Kokoro exited before ${phase}`;
	try {
		const stderr = (await session.readStderr()).trim();
		if (stderr.length > 0) return `Kokoro exited before ${phase}: ${stderr}`;
	} catch {
		// Preserve the original protocol-level failure if stderr collection fails.
	}
	return `Kokoro exited before ${phase}`;
}

export class KokoroClient {
	private session: KokoroSession | null = null;
	private ready = false;

	constructor(
		private readonly config: AgentVoiceConfig,
		private readonly createSession: KokoroSessionFactory = defaultSessionFactory(
			config,
		),
	) {}

	async ensureReady(): Promise<void> {
		if (this.ready) return;
		const session = this.getSession();
		const deadline = Date.now() + this.config.tts.timeoutSeconds * 1000;

		while (true) {
			const line = await readLineBeforeDeadline(session, deadline, "ready");
			if (line === null)
				throw new Error(await exitedBeforeMessage(session, "ready"));
			if (line.trim().length === 0) continue;

			const message = parseKokoroLine(line);
			if (message.error) throw new Error(`Kokoro error: ${message.error}`);
			if (message.status === "ready") {
				this.ready = true;
				return;
			}
		}
	}

	async speak(text: string, voice: string): Promise<Buffer> {
		try {
			return await this.speakOnce(text, voice);
		} catch {
			this.restart();
			return await this.speakOnce(text, voice);
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
			const line = await readLineBeforeDeadline(session, deadline, "audio");
			if (line === null)
				throw new Error(await exitedBeforeMessage(session, "audio"));
			if (line.trim().length === 0) continue;

			const message = parseKokoroLine(line);
			if (message.error) throw new Error(`Kokoro error: ${message.error}`);
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
