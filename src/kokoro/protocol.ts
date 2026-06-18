export type KokoroReadPhase = "ready" | "audio";

export interface KokoroProtocolSession {
	readLine(): Promise<string | null>;
	readStderr?(): Promise<string>;
}

export type KokoroMessage =
	| { kind: "status"; status: string }
	| { kind: "audio"; audio: string; duration?: number }
	| { kind: "error"; error: string };

export function createReadableLineReader(
	stream: ReadableStream<Uint8Array>,
): () => Promise<string | null> {
	let buffered = "";
	const decoder = new TextDecoder();

	return async () => {
		const reader = stream.getReader();
		try {
			while (true) {
				const newlineIndex = buffered.indexOf("\n");
				if (newlineIndex !== -1) {
					const line = buffered.slice(0, newlineIndex);
					buffered = buffered.slice(newlineIndex + 1);
					return line;
				}

				const chunk = await reader.read();
				if (chunk.done) {
					if (buffered.length === 0) return null;
					const line = buffered;
					buffered = "";
					return line;
				}
				buffered += decoder.decode(chunk.value, { stream: true });
			}
		} finally {
			reader.releaseLock();
		}
	};
}

export function parseKokoroLine(line: string): KokoroMessage {
	const parsed = JSON.parse(line) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Invalid Kokoro response");
	}
	const record = parsed as Record<string, unknown>;
	if (typeof record.error === "string" && record.error.trim().length > 0) {
		return { kind: "error", error: record.error };
	}
	if (typeof record.audio === "string" && record.audio.length > 0) {
		return {
			kind: "audio",
			audio: record.audio,
			...(typeof record.duration === "number"
				? { duration: record.duration }
				: {}),
		};
	}
	if (typeof record.status === "string" && record.status.trim().length > 0) {
		return { kind: "status", status: record.status };
	}
	throw new Error("Invalid Kokoro response");
}

export function messageToAudio(message: KokoroMessage): Buffer | null {
	if (message.kind !== "audio") return null;
	const audio = Buffer.from(message.audio, "base64");
	return audio.length > 0 ? audio : null;
}

export function isKokoroAudioMessage(
	message: KokoroMessage,
	options: { requireDuration?: boolean } = {},
): boolean {
	if (!messageToAudio(message)) return false;
	if (!options.requireDuration) return true;
	return (
		message.kind === "audio" &&
		typeof message.duration === "number" &&
		Number.isFinite(message.duration) &&
		message.duration >= 0
	);
}

async function readLineBeforeDeadline(
	session: KokoroProtocolSession,
	deadline: number,
	phase: KokoroReadPhase,
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

export async function exitedBeforeMessage(
	session: KokoroProtocolSession,
	phase: KokoroReadPhase,
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

export async function readKokoroMessageBeforeDeadline(
	session: KokoroProtocolSession,
	deadline: number,
	phase: KokoroReadPhase,
): Promise<KokoroMessage> {
	while (true) {
		const line = await readLineBeforeDeadline(session, deadline, phase);
		if (line === null) throw new Error(await exitedBeforeMessage(session, phase));
		if (line.trim().length === 0) continue;
		return parseKokoroLine(line);
	}
}
