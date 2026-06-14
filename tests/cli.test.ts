import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";

describe("agent-voice CLI", () => {
	test("prints help with core commands", async () => {
		const result = await runCli(["--help"], { stdout: "", stderr: "" });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("agent-voice install");
		expect(result.stdout).toContain("agent-voice uninstall");
		expect(result.stdout).toContain("agent-voice start");
		expect(result.stdout).toContain("agent-voice stop");
		expect(result.stdout).toContain("agent-voice status");
		expect(result.stdout).toContain("agent-voice enqueue --format");
		expect(result.stdout).toContain("agent-voice test");
		expect(result.stdout).toContain("agent-voice enable");
		expect(result.stdout).toContain("agent-voice disable");
		expect(result.stdout).toContain("agent-voice config get");
		expect(result.stdout).toContain("agent-voice daemon --foreground");
	});
});
