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
import {
	buildOpencodePluginSource,
	installOpencode,
	opencodeHookState,
	opencodePluginPath,
	uninstallOpencode,
} from "../src/install/opencode";

async function withTempHome<T>(
	fn: (home: string) => Promise<T> | T,
): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-opencode-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

function envFor(home: string): { HOME: string; AGENT_VOICE_EXECUTABLE: string } {
	return { HOME: home, AGENT_VOICE_EXECUTABLE: "/repo/bin/agent-voice" };
}

function writeCapture(path: string): void {
	writeFileSync(
		path,
		`#!/bin/sh\n{ printf 'ARGS:%s\\n' "$*"; cat; printf '\\n---\\n'; } >> "$AGENT_VOICE_CAPTURE"\n`,
		"utf8",
	);
	chmodSync(path, 0o755);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readEventually(path: string): Promise<string> {
	const deadline = Date.now() + 2500;
	let latest = "";
	while (Date.now() < deadline) {
		if (existsSync(path)) {
			latest = readFileSync(path, "utf8");
			if (latest.includes("---")) return latest;
		}
		await sleep(25);
	}
	return latest;
}

async function loadPlugin(
	home: string,
	exe: string,
): Promise<
	(ctx: {
		client: unknown;
		directory: string;
	}) => Promise<{ event: (input: { event: unknown }) => Promise<void> }>
> {
	const path = join(home, `plugin-${Math.random().toString(36).slice(2)}.ts`);
	writeFileSync(
		path,
		buildOpencodePluginSource({ HOME: home, AGENT_VOICE_EXECUTABLE: exe }),
		"utf8",
	);
	const mod = (await import(path)) as Record<string, unknown>;
	return (mod.AgentVoice ?? mod.default) as never;
}

describe("opencode installer", () => {
	test("install writes an owned plugin handling completion and approvals", async () => {
		await withTempHome((home) => {
			expect(installOpencode(envFor(home)).message).toContain("plugin");
			const source = readFileSync(opencodePluginPath({ HOME: home }), "utf8");
			expect(source).toContain(
				"agent-voice opencode plugin managed by agent-voice",
			);
			expect(source).toContain("session.idle");
			expect(source).toContain("permission.updated");
			expect(source).toContain("permission.asked");
			expect(source).toContain("/repo/bin/agent-voice");
			expect(opencodeHookState({ HOME: home })).toBe("installed");
		});
	});

	test("install refuses to overwrite an unowned plugin", async () => {
		await withTempHome((home) => {
			const target = opencodePluginPath({ HOME: home });
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, "// user's own plugin\n", "utf8");
			expect(() => installOpencode(envFor(home))).toThrow(
				"refusing to overwrite",
			);
			expect(readFileSync(target, "utf8")).toBe("// user's own plugin\n");
		});
	});

	test("uninstall removes the owned plugin; refuses an unowned one", async () => {
		await withTempHome((home) => {
			installOpencode(envFor(home));
			expect(uninstallOpencode(envFor(home)).message).toContain("uninstalled");
			expect(existsSync(opencodePluginPath({ HOME: home }))).toBe(false);

			mkdirSync(dirname(opencodePluginPath({ HOME: home })), { recursive: true });
			writeFileSync(opencodePluginPath({ HOME: home }), "// mine\n", "utf8");
			expect(() => uninstallOpencode(envFor(home))).toThrow(
				"not owned by agent-voice",
			);
		});
	});

	test("hookState is not_installed when absent", async () => {
		await withTempHome((home) => {
			expect(opencodeHookState({ HOME: home })).toBe("not_installed");
		});
	});

	test("plugin enqueues last assistant text on session.idle", async () => {
		await withTempHome(async (home) => {
			const capture = join(home, "capture.log");
			const exe = join(home, "fake-agent-voice");
			writeCapture(exe);
			const prevCapture = process.env.AGENT_VOICE_CAPTURE;
			process.env.AGENT_VOICE_CAPTURE = capture;
			try {
				const factory = await loadPlugin(home, exe);
				const client = {
					session: {
						messages: async () => ({
							data: [
								{ info: { role: "user" }, parts: [{ type: "text", text: "hi" }] },
								{
									info: { role: "assistant" },
									parts: [
										{ type: "tool", text: "" },
										{ type: "text", text: "OpenCode finished the task." },
									],
								},
							],
						}),
					},
				};
				const hooks = await factory({ client, directory: "/proj" });
				await hooks.event({
					event: { type: "session.idle", properties: { sessionID: "s1" } },
				});
				const captured = await readEventually(capture);
				expect(captured).toContain("--agent opencode --cwd /proj");
				expect(captured).toContain("OpenCode finished the task.");
			} finally {
				process.env.AGENT_VOICE_CAPTURE = prevCapture;
			}
		});
	});

	test("plugin announces a permission ask once, deduped across event names", async () => {
		await withTempHome(async (home) => {
			const capture = join(home, "capture.log");
			const exe = join(home, "fake-agent-voice");
			writeCapture(exe);
			const prevCapture = process.env.AGENT_VOICE_CAPTURE;
			process.env.AGENT_VOICE_CAPTURE = capture;
			try {
				const factory = await loadPlugin(home, exe);
				const hooks = await factory({
					client: { session: { messages: async () => ({ data: [] }) } },
					directory: "/proj",
				});
				const event = {
					type: "permission.updated",
					properties: {
						id: "p1",
						title: "Run a shell command",
						metadata: { command: "rm -rf build" },
					},
				};
				await hooks.event({ event });
				await hooks.event({ event }); // same id → deduped
				const captured = await readEventually(capture);
				expect(captured).toContain("rm -rf build");
				expect(captured.match(/---/g)?.length).toBe(1);
			} finally {
				process.env.AGENT_VOICE_CAPTURE = prevCapture;
			}
		});
	});

	test("a sparse permission event does not block a later richer one for the same id", async () => {
		await withTempHome(async (home) => {
			const capture = join(home, "capture.log");
			const exe = join(home, "fake-agent-voice");
			writeCapture(exe);
			const prevCapture = process.env.AGENT_VOICE_CAPTURE;
			process.env.AGENT_VOICE_CAPTURE = capture;
			try {
				const factory = await loadPlugin(home, exe);
				const hooks = await factory({
					client: { session: { messages: async () => ({ data: [] }) } },
					directory: "/proj",
				});
				// First event for id "p9" carries nothing usable -> nothing announced.
				await hooks.event({
					event: { type: "permission.updated", properties: { id: "p9" } },
				});
				// A later event for the SAME id carries the real command -> must speak.
				await hooks.event({
					event: {
						type: "permission.asked",
						properties: { id: "p9", metadata: { command: "git push --force" } },
					},
				});
				const captured = await readEventually(capture);
				expect(captured).toContain("git push --force");
				expect(captured.match(/---/g)?.length).toBe(1);
			} finally {
				process.env.AGENT_VOICE_CAPTURE = prevCapture;
			}
		});
	});

	test("plugin stays silent when session.idle yields no assistant text", async () => {
		await withTempHome(async (home) => {
			const capture = join(home, "capture.log");
			const exe = join(home, "fake-agent-voice");
			writeCapture(exe);
			const prevCapture = process.env.AGENT_VOICE_CAPTURE;
			process.env.AGENT_VOICE_CAPTURE = capture;
			try {
				const factory = await loadPlugin(home, exe);
				const hooks = await factory({
					client: {
						session: {
							messages: async () => ({
								data: [
									{
										info: { role: "assistant" },
										parts: [{ type: "tool", name: "bash" }],
									},
								],
							}),
						},
					},
					directory: "/proj",
				});
				await hooks.event({
					event: { type: "session.idle", properties: { sessionID: "s1" } },
				});
				await sleep(300);
				expect(existsSync(capture) ? readFileSync(capture, "utf8") : "").toBe(
					"",
				);
			} finally {
				process.env.AGENT_VOICE_CAPTURE = prevCapture;
			}
		});
	});
});
