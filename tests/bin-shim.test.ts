import {
	mkdtempSync,
	mkdirSync,
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

describe("agent-voice bin shim", () => {
	test("finds nvm-installed bun when launched with a GUI-like PATH", () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-shim-test-"));
		try {
			const bunDir = join(home, ".nvm", "versions", "node", "v24.15.0", "bin");
			mkdirSync(bunDir, { recursive: true });
			makeExecutable(
				join(bunDir, "bun.exe"),
				`#!/usr/bin/env bash\nprintf '%s\n' "$@"\n`,
			);
			symlinkSync("bun.exe", join(bunDir, "bun"));

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
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
