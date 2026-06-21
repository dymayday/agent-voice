import { describe, expect, test } from "bun:test";
import {
	detectPlaybackBackend,
	limitPlaybackDiagnostic,
	playbackCommandForPlatform,
	type CommandExists,
} from "../src/platform/playback";

function exists(names: string[]): CommandExists {
	return async (name) => names.includes(name);
}

describe("playback backend detection", () => {
	test("linux prefers paplay before aplay", async () => {
		const backend = await detectPlaybackBackend({
			platform: "linux",
			commandExists: exists(["aplay", "paplay"]),
		});
		expect(backend).toEqual({
			kind: "tool",
			name: "paplay",
			command: "paplay",
			checked: ["paplay"],
		});
	});

	test("linux falls back to aplay", async () => {
		const backend = await detectPlaybackBackend({
			platform: "linux",
			commandExists: exists(["aplay"]),
		});
		expect(backend).toEqual({
			kind: "tool",
			name: "aplay",
			command: "aplay",
			checked: ["paplay", "aplay"],
		});
	});

	test("linux reports missing backend", async () => {
		const backend = await detectPlaybackBackend({
			platform: "linux",
			commandExists: exists([]),
		});
		expect(backend.kind).toBe("missing");
		if (backend.kind === "missing")
			expect(backend.checked).toEqual(["paplay", "aplay"]);
	});

	test("darwin preserves afplay", async () => {
		const backend = await detectPlaybackBackend({
			platform: "darwin",
			commandExists: exists(["afplay"]),
		});
		expect(backend).toEqual({
			kind: "tool",
			name: "afplay",
			command: "afplay",
			checked: ["afplay"],
		});
	});

	test("playbackCommandForPlatform builds arg-array commands with no shell", () => {
		expect(playbackCommandForPlatform("paplay", "/tmp/a.wav")).toEqual({
			cmd: "paplay",
			args: ["/tmp/a.wav"],
		});
		expect(playbackCommandForPlatform("aplay", "/tmp/a.wav")).toEqual({
			cmd: "aplay",
			args: ["/tmp/a.wav"],
		});
		expect(playbackCommandForPlatform("afplay", "/tmp/a.wav")).toEqual({
			cmd: "afplay",
			args: ["/tmp/a.wav"],
		});
	});

	test("limitPlaybackDiagnostic bounds diagnostic output", () => {
		const text = "x".repeat(5000);
		expect(limitPlaybackDiagnostic(text, 100)).toHaveLength(103);
	});
});
