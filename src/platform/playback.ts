import { spawn } from "node:child_process";

export type PlaybackToolName = "afplay" | "paplay" | "aplay";

export type PlaybackBackend =
	| { kind: "tool"; name: PlaybackToolName; command: string }
	| { kind: "missing"; checked: PlaybackToolName[]; message: string };

export type CommandExists = (command: string) => Promise<boolean>;

export interface DetectPlaybackOptions {
	platform?: NodeJS.Platform;
	commandExists?: CommandExists;
}

export function limitPlaybackDiagnostic(text = "", max = 4000): string {
	return text.length > max ? `${text.slice(0, max)}...` : text;
}

export async function defaultCommandExists(command: string): Promise<boolean> {
	return await new Promise((resolve) => {
		const child = spawn("/usr/bin/env", ["which", command], {
			stdio: "ignore",
		});
		child.on("error", () => resolve(false));
		child.on("exit", (code) => resolve(code === 0));
	});
}

export async function detectPlaybackBackend(
	options: DetectPlaybackOptions = {},
): Promise<PlaybackBackend> {
	const platform = options.platform ?? process.platform;
	const commandExists = options.commandExists ?? defaultCommandExists;
	const candidates: PlaybackToolName[] =
		platform === "linux" ? ["paplay", "aplay"] : ["afplay"];

	for (const name of candidates) {
		if (await commandExists(name)) return { kind: "tool", name, command: name };
	}

	return {
		kind: "missing",
		checked: candidates,
		message: `No supported audio playback tool found (${candidates.join(", ")})`,
	};
}

export function playbackCommandForPlatform(
	tool: PlaybackToolName,
	wavPath: string,
): { cmd: string; args: string[] } {
	return { cmd: tool, args: [wavPath] };
}
