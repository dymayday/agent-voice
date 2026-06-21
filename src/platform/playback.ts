import { spawn, spawnSync } from "node:child_process";

export type PlaybackToolName = "afplay" | "paplay" | "aplay";

export type PlaybackBackend =
	| {
			kind: "tool";
			name: PlaybackToolName;
			command: string;
			checked: PlaybackToolName[];
	  }
	| { kind: "missing"; checked: PlaybackToolName[]; message: string };

export type CommandExists = (command: string) => Promise<boolean>;

export interface DetectPlaybackOptions {
	platform?: NodeJS.Platform;
	commandExists?: CommandExists;
}

export type CommandExistsSync = (command: string) => boolean;

export interface DetectPlaybackSyncOptions {
	platform?: NodeJS.Platform;
	commandExists?: CommandExistsSync;
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

export function defaultCommandExistsSync(command: string): boolean {
	const result = spawnSync("/usr/bin/env", ["which", command], {
		stdio: "ignore",
	});
	return result.status === 0;
}

function candidatesForPlatform(platform: NodeJS.Platform): PlaybackToolName[] {
	return platform === "linux" ? ["paplay", "aplay"] : ["afplay"];
}

function missingBackend(candidates: PlaybackToolName[]): PlaybackBackend {
	return {
		kind: "missing",
		checked: candidates,
		message: `No supported audio playback tool found (${candidates.join(", ")})`,
	};
}

export async function detectPlaybackBackend(
	options: DetectPlaybackOptions = {},
): Promise<PlaybackBackend> {
	const platform = options.platform ?? process.platform;
	const commandExists = options.commandExists ?? defaultCommandExists;
	const candidates = candidatesForPlatform(platform);

	const checked: PlaybackToolName[] = [];
	for (const name of candidates) {
		checked.push(name);
		if (await commandExists(name))
			return { kind: "tool", name, command: name, checked };
	}

	return missingBackend(candidates);
}

export function detectPlaybackBackendSync(
	options: DetectPlaybackSyncOptions = {},
): PlaybackBackend {
	const platform = options.platform ?? process.platform;
	const commandExists = options.commandExists ?? defaultCommandExistsSync;
	const candidates = candidatesForPlatform(platform);

	const checked: PlaybackToolName[] = [];
	for (const name of candidates) {
		checked.push(name);
		if (commandExists(name)) return { kind: "tool", name, command: name, checked };
	}

	return missingBackend(candidates);
}

export function playbackCommandForPlatform(
	tool: PlaybackToolName,
	wavPath: string,
): { cmd: string; args: string[] } {
	return { cmd: tool, args: [wavPath] };
}
