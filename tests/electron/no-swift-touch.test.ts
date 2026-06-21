import { describe, expect, test } from "bun:test";

async function changedFiles(): Promise<string[]> {
	const proc = Bun.spawn(["git", "diff", "--name-only", "master...HEAD"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	if (exitCode !== 0) throw new Error(stderr || `git diff exited ${exitCode}`);
	return stdout.split("\n").filter(Boolean);
}

describe("linux electron sibling boundaries", () => {
	test("does not touch macOS Swift app sources", async () => {
		expect(
			(await changedFiles()).filter((file) =>
				file.startsWith("macos/AgentVoiceApp/"),
			),
		).toEqual([]);
	});
});
