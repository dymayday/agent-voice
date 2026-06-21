import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readJustfile(): string {
	return readFileSync("Justfile", "utf8");
}

describe("Justfile developer workflow", () => {
	test("exposes native platform targets and explicit app targets", () => {
		const justfile = readJustfile();

		for (const target of [
			"dev",
			"build",
			"run",
			"ship",
			"verify",
			"dev-electron",
			"build-electron",
			"run-electron",
			"ship-electron",
			"verify-electron",
			"dev-swift",
			"build-swift",
			"run-swift",
			"test-swift",
			"ship-swift",
			"verify-swift",
		]) {
			expect(justfile).toContain(`\n${target}:`);
		}
	});

	test("native targets choose Swift on macOS and Electron on Linux", () => {
		const justfile = readJustfile();

		expect(justfile).toContain('case "$(uname -s)" in');
		expect(justfile).toContain("Darwin) just dev-swift ;;");
		expect(justfile).toContain("Linux) just dev-electron ;;");
		expect(justfile).toContain("Darwin) just build-swift ;;");
		expect(justfile).toContain("Linux) just build-electron ;;");
		expect(justfile).toContain("Darwin) just run-swift ;;");
		expect(justfile).toContain("Linux) just run-electron ;;");
		expect(justfile).toContain("Darwin) just ship-swift ;;");
		expect(justfile).toContain("Linux) just ship-electron ;;");
	});

	test("electron targets build renderer and main before running built Electron", () => {
		const justfile = readJustfile();

		expect(justfile).toContain("bun run build:linux-renderer");
		expect(justfile).toContain("bun run build:linux-main");
		expect(justfile).toContain("bun x electron dist/linux-electron/main.js");
	});
});
