import { describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
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

function claudeSettingsPath(home: string): string {
	return join(home, ".claude", "settings.json");
}

function claudeSuspendedHooksPath(home: string): string {
	return join(
		home,
		".agent-voice",
		"install",
		"claude-suspended-stop-hooks.json",
	);
}

function writeClaudeSettings(
	home: string,
	settings: Record<string, unknown>,
): void {
	const target = claudeSettingsPath(home);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function readClaudeSettings(home: string): Record<string, any> {
	return JSON.parse(readFileSync(claudeSettingsPath(home), "utf8"));
}

function stopHookHandlers(
	settings: Record<string, any>,
): Record<string, any>[] {
	const groups = settings.hooks?.Stop;
	if (!Array.isArray(groups)) return [];
	return groups.flatMap((group) =>
		Array.isArray(group?.hooks) ? group.hooks : [],
	);
}

function agentVoiceClaudeHooks(
	settings: Record<string, any>,
): Record<string, any>[] {
	return stopHookHandlers(settings).filter((hook) => {
		const args = Array.isArray(hook.args) ? hook.args : [];
		return (
			hook.statusMessage === "Agent Voice: queue Claude turn summary" ||
			(hook.type === "command" &&
				args.includes("enqueue") &&
				args.includes("claude-stop-hook") &&
				args.includes("claude")) ||
			(typeof hook.command === "string" &&
				hook.command.includes("enqueue --format claude-stop-hook") &&
				hook.command.includes("--agent claude"))
		);
	});
}

function countAgentVoiceClaudeHooks(settings: Record<string, any>): number {
	return agentVoiceClaudeHooks(settings).length;
}

function preToolUseGroups(
	settings: Record<string, any>,
): Record<string, any>[] {
	const groups = settings.hooks?.PreToolUse;
	return Array.isArray(groups) ? groups : [];
}

function agentVoiceClaudeQuestionHooks(
	settings: Record<string, any>,
): Record<string, any>[] {
	return preToolUseGroups(settings)
		.flatMap((group) => (Array.isArray(group?.hooks) ? group.hooks : []))
		.filter(
			(hook) =>
				hook.statusMessage === "Agent Voice: queue Claude question" ||
				(typeof hook.command === "string" &&
					hook.command.includes("claude-pretooluse-hook")),
		);
}

function countPeonStopHooks(settings: Record<string, any>): number {
	return stopHookHandlers(settings).filter(
		(hook) =>
			typeof hook.command === "string" && hook.command.includes("peon.sh"),
	).length;
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

	test("generated Pi extension reports a missing agent-voice executable without blocking", async () => {
		await withTempHome(async (home) => {
			const source = buildPiExtensionSource({
				HOME: home,
				AGENT_VOICE_EXECUTABLE: join(home, "missing-agent-voice"),
			});

			const result = await runGeneratedExtension(source, home);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("extension callback returned");
			expect(result.stderr).toContain("agent-voice executable not found");
		});
	});

	test("generated Pi extension launches enqueue failures without observing child stderr", async () => {
		await withTempHome(async (home) => {
			const executablePath = join(home, "failing-agent-voice");
			writeFileSync(
				executablePath,
				`#!/bin/sh\necho 'database unavailable' >&2\nexit 1\n`,
				"utf8",
			);
			chmodSync(executablePath, 0o755);
			const source = buildPiExtensionSource({
				HOME: home,
				AGENT_VOICE_EXECUTABLE: executablePath,
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

	test("generated Pi extension stays silent when agent_end has no prose", async () => {
		await withTempHome(async (home) => {
			const capturePath = join(home, "enqueue.log");
			const executablePath = join(home, "fake-agent-voice");
			writeCaptureExecutable(executablePath);
			const source = buildPiExtensionSource({
				HOME: home,
				AGENT_VOICE_EXECUTABLE: executablePath,
			});

			// A tool-only / subagent / aborted run: the assistant messages carry
			// only thinking and toolCall parts, never a text part to narrate.
			const result = await runGeneratedExtension(
				source,
				home,
				`
if (!handlers.agent_end) throw new Error("agent_end handler was not registered");
await handlers.agent_end({
  messages: [
    { role: "assistant", content: [{ type: "thinking", thinking: "deciding" }, { type: "toolCall", id: "t1", name: "bash", input: {} }] },
    { role: "toolResult", content: [{ type: "text", text: "command output" }] },
    { role: "assistant", content: [{ type: "toolCall", id: "t2", name: "edit", input: {} }] },
    { role: "toolResult", content: [{ type: "text", text: "ok" }] },
  ],
}, { cwd: "/project" });
`,
				{ AGENT_VOICE_CAPTURE: capturePath },
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			// Give a detached enqueue ample time to land; assert it never does.
			const deadline = Date.now() + 1000;
			let captured = "";
			while (Date.now() < deadline) {
				if (existsSync(capturePath))
					captured = readFileSync(capturePath, "utf8");
				if (captured.includes("---")) break;
				await sleep(25);
			}
			expect(captured).toBe("");
		});
	});

	test("generated Pi extension still speaks when blocked asking for human review", async () => {
		await withTempHome(async (home) => {
			const capturePath = join(home, "enqueue.log");
			const executablePath = join(home, "fake-agent-voice");
			writeCaptureExecutable(executablePath);
			const source = buildPiExtensionSource({
				HOME: home,
				AGENT_VOICE_EXECUTABLE: executablePath,
			});

			// Blocked-for-review: pi ends the turn by asking the human a question.
			// That request is prose, so it must remain audible.
			const result = await runGeneratedExtension(
				source,
				home,
				`
if (!handlers.agent_end) throw new Error("agent_end handler was not registered");
await handlers.agent_end({
  messages: [
    { role: "assistant", content: [{ type: "thinking", thinking: "need approval" }, { type: "text", text: "I drafted the migration. Can you review it before I apply it?" }] },
  ],
}, { cwd: "/project" });
`,
				{ AGENT_VOICE_CAPTURE: capturePath },
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			const capture = await readEventually(capturePath);
			expect(capture).toContain("Can you review it before I apply it?");
		});
	});

	test("generated Pi extension no longer fabricates a finished-responding fallback", () => {
		const source = buildPiExtensionSource({
			HOME: "/home/test",
			AGENT_VOICE_EXECUTABLE: "/repo/bin/agent-voice",
		});
		expect(source).not.toContain("Pi finished responding.");
	});

	test("generated Pi extension does not keep child stderr open", () => {
		const source = buildPiExtensionSource({
			HOME: "/home/test",
			AGENT_VOICE_EXECUTABLE: "/repo/bin/agent-voice",
		});
		expect(source).toContain('stdio: ["pipe", "ignore", "ignore"]');
		expect(source).not.toContain("child.stderr");
		expect(source).not.toContain("stderr +=");
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

	test("install --agents claude appends a global Stop hook without touching existing peon hooks", async () => {
		await withTempHome(async (home) => {
			writeClaudeSettings(home, {
				verbose: true,
				hooks: {
					Stop: [
						{
							matcher: "",
							hooks: [
								{
									type: "command",
									command: "/Users/me/.claude/hooks/peon.sh stop",
									async: true,
								},
							],
						},
					],
					Notification: [
						{
							matcher: "",
							hooks: [
								{
									type: "command",
									command: "/Users/me/.claude/hooks/peon.sh notify",
									async: true,
								},
							],
						},
					],
				},
			});

			const result = await runCli(["install", "--agents", "claude"], {
				env: envFor(home),
			});

			expect(result.exitCode).toBe(0);
			const settings = readClaudeSettings(home);
			expect(settings.verbose).toBe(true);
			expect(countPeonStopHooks(settings)).toBe(1);
			expect(countAgentVoiceClaudeHooks(settings)).toBe(1);
			const [agentVoiceHook] = agentVoiceClaudeHooks(settings);
			expect(agentVoiceHook.command).toContain("/repo/bin/agent-voice");
			expect(agentVoiceHook.command).toContain(
				"enqueue --format claude-stop-hook --agent claude",
			);
			expect(agentVoiceHook.args).toBeUndefined();
			expect(JSON.stringify(settings.hooks.Notification)).toContain(
				"peon.sh notify",
			);
			expect(
				readdirSync(dirname(claudeSettingsPath(home))).some((name) =>
					name.startsWith("settings.json.agent-voice-backup-"),
				),
			).toBe(true);
		});
	});

	test("install --agents claude adds an AskUserQuestion PreToolUse hook", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(["install", "--agents", "claude"], {
				env: envFor(home),
			});

			expect(result.exitCode).toBe(0);
			const settings = readClaudeSettings(home);
			const questionHooks = agentVoiceClaudeQuestionHooks(settings);
			expect(questionHooks).toHaveLength(1);
			expect(questionHooks[0].command).toContain("/repo/bin/agent-voice");
			expect(questionHooks[0].command).toContain(
				"enqueue --format claude-pretooluse-hook --agent claude",
			);
			expect(questionHooks[0].async).toBe(true);

			// The hook must target AskUserQuestion specifically, not every tool.
			const group = preToolUseGroups(settings).find((candidate) =>
				(candidate.hooks ?? []).some(
					(hook: Record<string, any>) =>
						typeof hook.command === "string" &&
						hook.command.includes("claude-pretooluse-hook"),
				),
			);
			expect(group?.matcher).toBe("AskUserQuestion");

			// The Stop hook is still installed alongside the question hook.
			expect(countAgentVoiceClaudeHooks(settings)).toBe(1);
		});
	});

	test("install --agents claude keeps a single question hook across repeats", async () => {
		await withTempHome(async (home) => {
			const env = envFor(home);
			expect(
				(await runCli(["install", "--agents", "claude"], { env })).exitCode,
			).toBe(0);
			expect(
				(await runCli(["install", "--agents", "claude"], { env })).exitCode,
			).toBe(0);

			const settings = readClaudeSettings(home);
			expect(agentVoiceClaudeQuestionHooks(settings)).toHaveLength(1);
		});
	});

	test("install --agents claude preserves a user's own PreToolUse hooks", async () => {
		await withTempHome(async (home) => {
			writeClaudeSettings(home, {
				hooks: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [{ type: "command", command: "/tmp/guard.sh" }],
						},
					],
				},
			});

			const result = await runCli(["install", "--agents", "claude"], {
				env: envFor(home),
			});

			expect(result.exitCode).toBe(0);
			const settings = readClaudeSettings(home);
			expect(JSON.stringify(settings.hooks.PreToolUse)).toContain(
				"/tmp/guard.sh",
			);
			expect(agentVoiceClaudeQuestionHooks(settings)).toHaveLength(1);
		});
	});

	test("uninstall --agents claude removes the question hook", async () => {
		await withTempHome(async (home) => {
			const env = envFor(home);
			expect(
				(await runCli(["install", "--agents", "claude"], { env })).exitCode,
			).toBe(0);

			const result = await runCli(["uninstall", "--agents", "claude"], { env });

			expect(result.exitCode).toBe(0);
			const settings = readClaudeSettings(home);
			expect(agentVoiceClaudeQuestionHooks(settings)).toHaveLength(0);
		});
	});

	test("install --agents claude replaces a stale Agent Voice hook shape", async () => {
		await withTempHome(async (home) => {
			writeClaudeSettings(home, {
				hooks: {
					Stop: [
						{
							matcher: "",
							hooks: [
								{
									type: "command",
									command: "/old/agent-voice",
									args: [
										"enqueue",
										"--format",
										"claude-stop-hook",
										"--agent",
										"claude",
									],
									async: true,
									statusMessage: "Agent Voice: queue Claude turn summary",
								},
							],
						},
					],
				},
			});

			const result = await runCli(["install", "--agents", "claude"], {
				env: envFor(home),
			});

			expect(result.exitCode).toBe(0);
			const settings = readClaudeSettings(home);
			expect(countAgentVoiceClaudeHooks(settings)).toBe(1);
			const [agentVoiceHook] = agentVoiceClaudeHooks(settings);
			expect(agentVoiceHook.command).toContain("/repo/bin/agent-voice");
			expect(agentVoiceHook.command).toContain(
				"enqueue --format claude-stop-hook --agent claude",
			);
			expect(agentVoiceHook.args).toBeUndefined();
			expect(agentVoiceHook.command).not.toContain("/old/agent-voice");
		});
	});

	test("install --agents claude can suspend only the existing peon Stop hook", async () => {
		await withTempHome(async (home) => {
			writeClaudeSettings(home, {
				hooks: {
					Stop: [
						{
							matcher: "",
							hooks: [
								{
									type: "command",
									command: "/Users/me/.claude/hooks/peon.sh stop",
									async: true,
								},
								{ type: "command", command: "/tmp/other-stop.sh" },
							],
						},
					],
					Notification: [
						{
							matcher: "",
							hooks: [
								{
									type: "command",
									command: "/Users/me/.claude/hooks/peon.sh notify",
									async: true,
								},
							],
						},
					],
				},
			});

			const result = await runCli(
				["install", "--agents", "claude", "--suspend-existing-stop-hooks"],
				{ env: envFor(home) },
			);

			expect(result.exitCode).toBe(0);
			const settings = readClaudeSettings(home);
			expect(countPeonStopHooks(settings)).toBe(0);
			expect(countAgentVoiceClaudeHooks(settings)).toBe(1);
			expect(JSON.stringify(settings.hooks.Stop)).toContain("other-stop.sh");
			expect(JSON.stringify(settings.hooks.Notification)).toContain(
				"peon.sh notify",
			);
			const backup = JSON.parse(
				readFileSync(claudeSuspendedHooksPath(home), "utf8"),
			);
			expect(backup.entries).toHaveLength(1);
			expect(JSON.stringify(backup)).toContain("peon.sh stop");
		});
	});

	test("claude install with peon suspension is idempotent", async () => {
		await withTempHome(async (home) => {
			writeClaudeSettings(home, {
				hooks: {
					Stop: [
						{
							matcher: "",
							hooks: [
								{
									type: "command",
									command: "/Users/me/.claude/hooks/peon.sh stop",
									async: true,
								},
							],
						},
					],
				},
			});

			const env = envFor(home);
			expect(
				(
					await runCli(
						["install", "--agents", "claude", "--suspend-existing-stop-hooks"],
						{ env },
					)
				).exitCode,
			).toBe(0);
			expect(
				(
					await runCli(
						["install", "--agents", "claude", "--suspend-existing-stop-hooks"],
						{ env },
					)
				).exitCode,
			).toBe(0);

			const settings = readClaudeSettings(home);
			expect(countAgentVoiceClaudeHooks(settings)).toBe(1);
			const backup = JSON.parse(
				readFileSync(claudeSuspendedHooksPath(home), "utf8"),
			);
			expect(backup.entries).toHaveLength(1);
		});
	});

	test("uninstall --agents claude removes Agent Voice and restores suspended peon Stop hook", async () => {
		await withTempHome(async (home) => {
			writeClaudeSettings(home, {
				hooks: {
					Stop: [
						{
							matcher: "",
							hooks: [
								{
									type: "command",
									command: "/Users/me/.claude/hooks/peon.sh stop",
									async: true,
								},
							],
						},
					],
				},
			});
			const env = envFor(home);
			expect(
				(
					await runCli(
						["install", "--agents", "claude", "--suspend-existing-stop-hooks"],
						{ env },
					)
				).exitCode,
			).toBe(0);
			const duringTrial = readClaudeSettings(home);
			duringTrial.hooks.Stop.push({
				matcher: "",
				hooks: [{ type: "command", command: "/tmp/new-stop.sh" }],
			});
			writeClaudeSettings(home, duringTrial);

			const result = await runCli(["uninstall", "--agents", "claude"], {
				env,
			});

			expect(result.exitCode).toBe(0);
			const settings = readClaudeSettings(home);
			expect(countAgentVoiceClaudeHooks(settings)).toBe(0);
			expect(countPeonStopHooks(settings)).toBe(1);
			expect(JSON.stringify(settings.hooks.Stop)).toContain("new-stop.sh");
			expect(existsSync(claudeSuspendedHooksPath(home))).toBe(false);
		});
	});

	test("install --agents claude refuses invalid global settings JSON without rewriting it", async () => {
		await withTempHome(async (home) => {
			const target = claudeSettingsPath(home);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, "{not json", "utf8");

			const result = await runCli(["install", "--agents", "claude"], {
				env: envFor(home),
			});

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("invalid Claude settings JSON");
			expect(readFileSync(target, "utf8")).toBe("{not json");
		});
	});

	test("install and uninstall reject unsupported agents in this slice", async () => {
		await withTempHome(async (home) => {
			const env = envFor(home);
			const install = await runCli(["install", "--agents", "codex"], {
				env,
			});
			const uninstall = await runCli(["uninstall", "--agents", "opencode"], {
				env,
			});

			expect(install.exitCode).toBe(2);
			expect(install.stderr).toContain("currently supports only pi and claude");
			expect(uninstall.exitCode).toBe(2);
			expect(uninstall.stderr).toContain(
				"currently supports only pi and claude",
			);
		});
	});
});
