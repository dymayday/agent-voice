import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { readBuildId } from "../src/build-info";

function withTempDir<T>(fn: (dir: string) => T): T {
	const dir = mkdtempSync(join(tmpdir(), "agent-voice-buildinfo-"));
	try {
		return fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function writeBuildInfo(dir: string, contents: string): void {
	writeFileSync(join(dir, "build-info.json"), contents, "utf8");
}

describe("readBuildId", () => {
	test("returns null when build-info.json is absent (dev / source tree)", () => {
		withTempDir((dir) => {
			expect(readBuildId(dir)).toBeNull();
		});
	});

	test("returns the buildId when the file is present and valid", () => {
		withTempDir((dir) => {
			writeBuildInfo(
				dir,
				JSON.stringify({
					buildId: "ab12cd34ef56+1750000000",
					commit: "ab12cd34ef56",
					version: "0.1.0",
					builtAt: "2026-06-19T22:22:17Z",
				}),
			);
			expect(readBuildId(dir)).toBe("ab12cd34ef56+1750000000");
		});
	});

	test("returns null when build-info.json cannot be parsed", () => {
		withTempDir((dir) => {
			writeBuildInfo(dir, "{ not valid json");
			expect(readBuildId(dir)).toBeNull();
		});
	});

	test("returns null when buildId is missing, empty, or not a string", () => {
		withTempDir((dir) => {
			writeBuildInfo(dir, JSON.stringify({ commit: "abc" }));
			expect(readBuildId(dir)).toBeNull();
			writeBuildInfo(dir, JSON.stringify({ buildId: "" }));
			expect(readBuildId(dir)).toBeNull();
			writeBuildInfo(dir, JSON.stringify({ buildId: 42 }));
			expect(readBuildId(dir)).toBeNull();
		});
	});
});
