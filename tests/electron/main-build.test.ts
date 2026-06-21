import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

async function runBuildMain(): Promise<{ exitCode: number; stderr: string }> {
	const proc = Bun.spawn(["bun", "linux/electron/build-main.ts"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stderr).text(),
	]);
	return { exitCode, stderr };
}

async function runBuiltMainWithNode(): Promise<{ exitCode: number; stderr: string }> {
	const proc = Bun.spawn(["node", "dist/linux-electron/main.js"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stderr).text(),
	]);
	return { exitCode, stderr };
}

describe("electron main build", () => {
	test("bundles Electron main and preload to JavaScript", async () => {
		const result = await runBuildMain();

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(existsSync("dist/linux-electron/main.js")).toBe(true);
		expect(existsSync("dist/linux-electron/preload.js")).toBe(true);
		expect(existsSync("dist/linux-electron/capsule-preload.js")).toBe(true);
		expect(readFileSync("dist/linux-electron/main.js", "utf8")).toContain(
			"preload.js",
		);
		expect(readFileSync("dist/linux-electron/main.js", "utf8")).toContain(
			"capsule-preload.js",
		);
	});

	test("built Electron main can load in Node without Bun-only imports", async () => {
		const build = await runBuildMain();
		expect(build.exitCode).toBe(0);

		const result = await runBuiltMainWithNode();
		expect(result.exitCode).toBe(0);
		expect(result.stderr).not.toContain("ERR_UNSUPPORTED_ESM_URL_SCHEME");
	});

	test("preload bundles are script-compatible for sandboxed Electron", async () => {
		const build = await runBuildMain();
		expect(build.exitCode).toBe(0);

		for (const file of [
			"dist/linux-electron/preload.js",
			"dist/linux-electron/capsule-preload.js",
		]) {
			const output = readFileSync(file, "utf8");
			expect(output).not.toMatch(/^import\s/m);
			expect(output).not.toMatch(/^export\s/m);
		}
	});
});
