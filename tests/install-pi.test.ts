import { describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCli } from "../src/cli";
import { buildPiExtensionSource } from "../src/install";

async function withTempHome<T>(
	fn: (home: string) => T | Promise<T>,
): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-install-pi-test-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

function envFor(home: string): Record<string, string> {
	return {
		HOME: home,
		AGENT_VOICE_HOME: join(home, ".agent-voice"),
		AGENT_VOICE_EXECUTABLE: "/repo/bin/agent-voice",
	};
}

function piExtensionPath(home: string): string {
	return join(home, ".pi", "agent", "extensions", "agent-voice.ts");
}

async function runGeneratedExtension(
	source: string,
	home: string,
	scenario = `
if (handlers.turn_end) {
  await handlers.turn_end({ message: { text: "Intermediate tool turn." } }, {});
}
if (!handlers.agent_end) throw new Error("agent_end handler was not registered");
await handlers.agent_end({
  messages: [
    { role: "assistant", content: [{ type: "text", text: "Pi finished a test turn." }] },
  ],
}, {});
`,
	env: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const extensionPath = join(home, "agent-voice-extension-under-test.ts");
	writeFileSync(extensionPath, source, "utf8");
	const script = `
import extension from ${JSON.stringify(extensionPath)};
const handlers = {};
extension({
  on(name, nextHandler) {
    handlers[name] = nextHandler;
  }
});
${scenario}
await new Promise((resolve) => setTimeout(resolve, 150));
console.log("extension callback returned");
`;
	const proc = Bun.spawn([process.execPath, "--eval", script], {
		env: {
			...process.env,
			...env,
			AGENT_VOICE_HOME: join(home, ".agent-voice"),
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

function writeCaptureExecutable(path: string): void {
	writeFileSync(
		path,
		`#!/bin/sh
{
  printf 'ARGS:%s\n' "$*"
  cat
  printf '\n---\n'
} >> "$AGENT_VOICE_CAPTURE"
`,
		"utf8",
	);
	chmodSync(path, 0o755);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readEventually(path: string): Promise<string> {
	const deadline = Date.now() + 1000;
	let latest = "";
	while (Date.now() < deadline) {
		if (existsSync(path)) {
			latest = readFileSync(path, "utf8");
			if (latest.includes("---")) return latest;
		}
		await sleep(25);
	}
	return latest || readFileSync(path, "utf8");
}

describe("agent-voice Pi installer", () => {
	test("install --agents pi writes an owned Pi extension", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(["install", "--agents", "pi"], {
				env: envFor(home),
			});

			expect(result.exitCode).toBe(0);
			const extension = readFileSync(piExtensionPath(home), "utf8");
			expect(extension).toContain(
				"agent-voice pi extension managed by agent-voice",
			);
			expect(extension).toContain('pi.on("agent_end"');
			expect(extension).not.toContain('pi.on("turn_end"');
			expect(extension).toContain("enqueue");
			expect(extension).toContain("--agent");
			expect(extension).toContain('"pi"');
			expect(extension).toContain("/repo/bin/agent-voice");
		});
	});

	test("install --agents pi is idempotent for owned extension", async () => {
		await withTempHome(async (home) => {
			const env = envFor(home);
			expect(
				(await runCli(["install", "--agents", "pi"], { env })).exitCode,
			).toBe(0);
			const first = readFileSync(piExtensionPath(home), "utf8");
			expect(
				(await runCli(["install", "--agents", "pi"], { env })).exitCode,
			).toBe(0);
			const second = readFileSync(piExtensionPath(home), "utf8");
			expect(second).toBe(first);
		});
	});

	test("generated Pi extension ignores a missing agent-voice executable", async () => {
		await withTempHome(async (home) => {
			const source = buildPiExtensionSource({
				HOME: home,
				AGENT_VOICE_EXECUTABLE: join(home, "missing-agent-voice"),
			});

			const result = await runGeneratedExtension(source, home);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("extension callback returned");
			expect(result.stderr).toBe("");
		});
	});

	test("generated Pi extension enqueues only after agent_end", async () => {
		await withTempHome(async (home) => {
			const capturePath = join(home, "enqueue.log");
			const executablePath = join(home, "fake-agent-voice");
			writeCaptureExecutable(executablePath);
			const source = buildPiExtensionSource({
				HOME: home,
				AGENT_VOICE_EXECUTABLE: executablePath,
			});

			const result = await runGeneratedExtension(
				source,
				home,
				`
if (handlers.turn_end) {
  await handlers.turn_end({ message: { text: "Intermediate tool turn." } }, {});
  await handlers.turn_end({ message: { text: "Another intermediate turn." } }, {});
}
if (!handlers.agent_end) throw new Error("agent_end handler was not registered");
await handlers.agent_end({
  messages: [
    { role: "assistant", content: [{ type: "text", text: "Pi completed the requested work." }] },
  ],
}, { cwd: "/project" });
`,
				{ AGENT_VOICE_CAPTURE: capturePath },
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			const capture = await readEventually(capturePath);
			expect(capture).toContain("--agent pi --cwd /project");
			expect(capture).toContain("Pi completed the requested work.");
			expect(capture).not.toContain("Intermediate tool turn.");
			expect(capture).not.toContain("Another intermediate turn.");
			expect(capture.match(/---/g)?.length).toBe(1);
		});
	});

	test("install refuses to overwrite unowned Pi extension", async () => {
		await withTempHome(async (home) => {
			const target = piExtensionPath(home);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, "// user's extension\n", "utf8");

			const result = await runCli(["install", "--agents", "pi"], {
				env: envFor(home),
			});

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("refusing to overwrite");
			expect(readFileSync(target, "utf8")).toBe("// user's extension\n");
		});
	});

	test("uninstall --agents pi removes owned extension", async () => {
		await withTempHome(async (home) => {
			const env = envFor(home);
			expect(
				(await runCli(["install", "--agents", "pi"], { env })).exitCode,
			).toBe(0);

			const result = await runCli(["uninstall", "--agents", "pi"], { env });

			expect(result.exitCode).toBe(0);
			expect(existsSync(piExtensionPath(home))).toBe(false);
		});
	});

	test("uninstall --agents pi is no-op when extension is absent", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(["uninstall", "--agents", "pi"], {
				env: envFor(home),
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("not installed");
		});
	});

	test("uninstall refuses to remove unowned extension", async () => {
		await withTempHome(async (home) => {
			const target = piExtensionPath(home);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, "// user's extension\n", "utf8");

			const result = await runCli(["uninstall", "--agents", "pi"], {
				env: envFor(home),
			});

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("not owned by agent-voice");
			expect(existsSync(target)).toBe(true);
		});
	});

	test("install and uninstall reject unsupported agents in this slice", async () => {
		await withTempHome(async (home) => {
			const env = envFor(home);
			const install = await runCli(["install", "--agents", "claude"], {
				env,
			});
			const uninstall = await runCli(["uninstall", "--agents", "codex"], {
				env,
			});

			expect(install.exitCode).toBe(2);
			expect(install.stderr).toContain("currently supports only pi");
			expect(uninstall.exitCode).toBe(2);
			expect(uninstall.stderr).toContain("currently supports only pi");
		});
	});
});
