import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const tsconfig = JSON.parse(readFileSync("tsconfig.json", "utf8"));
const viteConfig = readFileSync("linux/electron/vite.config.ts", "utf8");
const devRunner = readFileSync("linux/electron/dev-runner.ts", "utf8");

describe("linux electron tooling", () => {
	test("package exposes linux electron dev/test scripts", () => {
		expect(pkg.scripts["dev:linux"]).toContain("linux/electron/dev-runner.ts");
		expect(pkg.scripts["dev:linux"]).toContain("electron");
		expect(pkg.scripts["build:linux-renderer"]).toContain("vite");
		expect(pkg.scripts["test:renderer"]).toContain("vitest");
		expect(pkg.scripts["check:renderer"]).toContain("svelte-check");
	});

	test("typecheck includes linux electron TypeScript files", () => {
		expect(tsconfig.include).toContain("linux/electron/**/*.ts");
	});

	test("linux electron main entry and build script exist", () => {
		expect(existsSync("linux/electron/main.ts")).toBe(true);
		expect(existsSync("linux/electron/build-main.ts")).toBe(true);
		expect(existsSync("linux/electron/service-bridge.ts")).toBe(true);
		expect(pkg.scripts["build:linux-main"]).toContain(
			"linux/electron/build-main.ts",
		);
	});

	test("dev runner launches built electron main JavaScript", () => {
		expect(devRunner).toContain("build-main.ts");
		expect(devRunner).toContain("dist/linux-electron/main.js");
		expect(devRunner).not.toContain("electron\", \"linux/electron/main.ts");
	});

	test("renderer Vitest tests stay out of Bun root test discovery", () => {
		expect(viteConfig).toContain("renderer/src/**/*.vitest.ts");
		expect(existsSync("linux/electron/renderer/src/App.vitest.ts")).toBe(true);
		expect(existsSync("linux/electron/renderer/src/App.test.ts")).toBe(false);
	});
});
