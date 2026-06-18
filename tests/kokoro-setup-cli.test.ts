import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli";
import type { KokoroSetupDeps } from "../src/kokoro-setup";

function tempHome(): string {
	return mkdtempSync(join(tmpdir(), "agent-voice-kokoro-setup-"));
}

function fakeDeps(overrides: Partial<KokoroSetupDeps> = {}): KokoroSetupDeps {
	return {
		commandExists: async (cmd) => cmd === "uv",
		run: async (request) => {
			if (request.cmd === "uv" && request.args[0] === "venv" && request.cwd) {
				const binDir = join(request.cwd, ".venv", "bin");
				mkdirSync(binDir, { recursive: true });
				writeFileSync(join(binDir, "python"), "#!/bin/sh\n", "utf8");
			}
			return { ok: true, stdout: "ok", stderr: "" };
		},
		smokeTest: async () => ({ ok: true }),
		...overrides,
	};
}

describe("Kokoro setup CLI", () => {
	test("CLI kokoro status returns managed status json", async () => {
		const home = tempHome();
		try {
			const result = await runCli(["kokoro", "status", "--json"], {
				env: { AGENT_VOICE_HOME: home },
			});
			expect(result.exitCode).toBe(0);
			const payload = JSON.parse(result.stdout);
			expect(payload.managedHome).toBe(join(home, "kokoro"));
			expect(payload.installed).toBe(false);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("CLI kokoro setup --jsonl emits json lines", async () => {
		const home = tempHome();
		try {
			const result = await runCli(["kokoro", "setup", "--jsonl"], {
				env: { AGENT_VOICE_HOME: home },
				kokoroSetupDeps: fakeDeps(),
			});
			expect(result.exitCode).toBe(0);
			const lines = result.stdout
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(lines.at(-1)).toMatchObject({ type: "complete", ok: true });
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("CLI kokoro setup --jsonl streams only parseable JSON lines", async () => {
		const home = tempHome();
		try {
			const chunks: string[] = [];
			const result = await runCli(["kokoro", "setup", "--jsonl"], {
				env: { AGENT_VOICE_HOME: home },
				kokoroSetupDeps: fakeDeps({
					run: async (request) => {
						if (
							request.cmd === "uv" &&
							request.args[0] === "venv" &&
							request.cwd
						) {
							const binDir = join(request.cwd, ".venv", "bin");
							mkdirSync(binDir, { recursive: true });
							writeFileSync(join(binDir, "python"), "#!/bin/sh\n", "utf8");
						}
						return {
							ok: true,
							stdout: "raw child stdout that is not JSON",
							stderr: "raw child stderr that is not JSON",
						};
					},
				}),
				writeStdout: async (chunk) => {
					chunks.push(chunk);
				},
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe("");
			const events = chunks
				.join("")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(events.some((event) => event.type === "log")).toBe(true);
			expect(events.at(-1)).toMatchObject({ type: "complete", ok: true });
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("CLI kokoro setup --jsonl exits 1 on setup failure", async () => {
		const home = tempHome();
		try {
			const result = await runCli(["kokoro", "setup", "--jsonl"], {
				env: { AGENT_VOICE_HOME: home },
				kokoroSetupDeps: fakeDeps({
					commandExists: async () => false,
					run: async (request) => {
						if (request.cmd === "curl") {
							return {
								ok: false,
								stdout: "",
								stderr: "network down",
								exitCode: 1,
							};
						}
						return { ok: true, stdout: "ok", stderr: "" };
					},
				}),
			});
			expect(result.exitCode).toBe(1);
			const lines = result.stdout
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(lines.at(-1)).toMatchObject({
				type: "complete",
				ok: false,
			});
			expect(lines.at(-1).error).toContain("network down");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
