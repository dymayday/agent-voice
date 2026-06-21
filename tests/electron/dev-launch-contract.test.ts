import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const devRunner = readFileSync("linux/electron/dev-runner.ts", "utf8");
const main = readFileSync("linux/electron/main.ts", "utf8");

describe("linux electron dev launch contract", () => {
	test("dev:linux launches the dev runner", () => {
		expect(pkg.scripts["dev:linux"]).toContain("linux/electron/dev-runner.ts");
		expect(pkg.scripts["dev:linux"]).toContain("electron");
	});

	test("dev runner builds main, starts Vite, and launches built Electron main", () => {
		expect(devRunner).toContain("linux/electron/build-main.ts");
		expect(devRunner).toContain("vite");
		expect(devRunner).toContain("linux/electron/vite.config.ts");
		expect(devRunner).toContain("dist/linux-electron/main.js");
		expect(devRunner).toContain("AGENT_VOICE_RENDERER_URL");
	});

	test("main uses dev renderer URL when provided and built renderer otherwise", () => {
		expect(main).toContain("process.env.AGENT_VOICE_RENDERER_URL");
		expect(main).toContain("window.loadURL(rendererUrl)");
		expect(main).toContain("dist/linux-renderer/index.html");
		expect(main).toContain("preload.js");
	});
});
