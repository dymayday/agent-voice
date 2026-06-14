import { describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveExecutablePaths } from "../src/executable";

describe("executable path resolution", () => {
	test("resolves repo root from a bin shim path without using cwd", () => {
		const paths = resolveExecutablePaths({
			shimPath: "/opt/agent-voice/bin/agent-voice",
			cwd: "/tmp/somewhere-else",
		});

		expect(paths.rootDir).toBe("/opt/agent-voice");
		expect(paths.indexTs).toBe(join("/opt/agent-voice", "src", "index.ts"));
	});

	test("resolves repo root from a symlinked package bin", () => {
		const root = mkdtempSync(join(tmpdir(), "agent-voice-exec-test-"));
		try {
			const packageRoot = join(root, "pkg");
			const packageBin = join(packageRoot, "bin");
			const globalBin = join(root, "global-bin");
			mkdirSync(packageBin, { recursive: true });
			mkdirSync(globalBin, { recursive: true });
			writeFileSync(join(packageBin, "agent-voice"), "#!/usr/bin/env bash\n");
			symlinkSync(
				join(packageBin, "agent-voice"),
				join(globalBin, "agent-voice"),
			);

			const paths = resolveExecutablePaths({
				shimPath: join(globalBin, "agent-voice"),
				cwd: "/tmp/somewhere-else",
			});

			expect(paths.rootDir).toBe(realpathSync(packageRoot));
			expect(paths.indexTs).toBe(
				join(realpathSync(packageRoot), "src", "index.ts"),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("package bin shims exist and do not depend on caller cwd", () => {
		for (const binName of ["agent-voice", "voice-codex", "voice-opencode"]) {
			const shim = readFileSync(join("bin", binName), "utf8");

			expect(shim).toContain("while [ -L");
			expect(shim).toContain("readlink");
			expect(shim).toContain("SCRIPT_DIR=");
			expect(shim).toContain("ROOT_DIR=");
			expect(shim).not.toContain("$PWD/src/index.ts");
		}
	});
});
