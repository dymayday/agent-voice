import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

function makeExecutable(path: string, content: string): void {
	writeFileSync(path, content, { mode: 0o755 });
}

function withFakeNvmBun<T>(fn: (home: string) => T): T {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-shim-test-"));
	try {
		const bunDir = join(home, ".nvm", "versions", "node", "v24.15.0", "bin");
		mkdirSync(bunDir, { recursive: true });
		makeExecutable(
			join(bunDir, "bun.exe"),
			`#!/usr/bin/env bash\nprintf '%s\n' "$@"\n`,
		);
		symlinkSync("bun.exe", join(bunDir, "bun"));
		return fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

describe("agent-voice bin shim", () => {
	test("bin shims source one shared Bun lookup helper", () => {
		expect(existsSync("bin/lib/find-bun.sh")).toBe(true);
		const helper = readFileSync("bin/lib/find-bun.sh", "utf8");
		expect(helper).toContain("find_agent_voice_bun()");

		for (const shim of [
			"bin/agent-voice",
			"bin/voice-codex",
			"bin/voice-opencode",
		]) {
			const source = readFileSync(shim, "utf8");
			expect(source).toContain('. "$SCRIPT_DIR/lib/find-bun.sh"');
			expect(source).not.toContain("find_bun()");
		}
	});

	test("macOS bundle script copies the shared Bun lookup helper", () => {
		const source = readFileSync("scripts/build-macos-app.sh", "utf8");
		expect(source).toContain(
			'mkdir -p "$MACOS_DIR" "$RESOURCES_DIR" "$CLI_DIR/bin" "$CLI_DIR/bin/lib"',
		);
		expect(source).toContain('cp -R "$ROOT_DIR/bin/lib/." "$CLI_DIR/bin/lib/"');
	});

	test("macOS bundle script exposes cache cleaning and retries stale Swift caches", () => {
		const source = readFileSync("scripts/build-macos-app.sh", "utf8");
		expect(source).toContain("clean-cache");
		expect(source).toContain('rm -rf "$PACKAGE_DIR/.build"');
		expect(source).toContain("was compiled with module cache path");
		expect(source).toContain("missing required module 'SwiftShims'");
	});

	test("package scripts expose macOS build and cache clean commands", () => {
		const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
		expect(packageJson.scripts["build:macos"]).toBe(
			"bash scripts/build-macos-app.sh",
		);
		expect(packageJson.scripts["clean:cache"]).toBe(
			"bash scripts/build-macos-app.sh clean-cache",
		);
	});

	test("finds nvm-installed bun when launched with a GUI-like PATH", () => {
		withFakeNvmBun((home) => {
			const result = Bun.spawnSync({
				cmd: ["bash", "bin/agent-voice", "--shim-smoke"],
				env: {
					HOME: home,
					PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
				},
				stdout: "pipe",
				stderr: "pipe",
			});

			expect(result.exitCode).toBe(0);
			expect(result.stderr.toString()).toBe("");
			expect(result.stdout.toString()).toContain("src/index.ts");
			expect(result.stdout.toString()).toContain("--shim-smoke");
		});
	});

	test("voice-codex and voice-opencode shims use the same GUI-safe bun lookup", () => {
		withFakeNvmBun((home) => {
			for (const [shim, command] of [
				["bin/voice-codex", "voice-codex"],
				["bin/voice-opencode", "voice-opencode"],
			]) {
				const result = Bun.spawnSync({
					cmd: ["bash", shim, "--shim-smoke"],
					env: {
						HOME: home,
						PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
					},
					stdout: "pipe",
					stderr: "pipe",
				});

				expect(result.exitCode, shim).toBe(0);
				expect(result.stderr.toString()).toBe("");
				expect(result.stdout.toString()).toContain("src/index.ts");
				expect(result.stdout.toString()).toContain(command);
				expect(result.stdout.toString()).toContain("--shim-smoke");
			}
		});
	});
});
