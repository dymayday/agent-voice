import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

async function runBuildRenderer(): Promise<{ exitCode: number; stderr: string }> {
	const proc = Bun.spawn(["bun", "run", "build:linux-renderer"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stderr).text(),
	]);
	return { exitCode, stderr };
}

describe("electron renderer build", () => {
	test("emits relative asset URLs so Electron loadFile can render the app", async () => {
		const result = await runBuildRenderer();

		expect(result.exitCode).toBe(0);
		expect(result.stderr).not.toContain("error");

		const html = readFileSync("dist/linux-renderer/index.html", "utf8");
		expect(html).not.toContain('src="/assets/');
		expect(html).not.toContain('href="/assets/');
		expect(html).toContain('src="./assets/');
		expect(html).toContain('href="./assets/');
	});
});
