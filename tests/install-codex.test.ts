import { describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	codexConfigPath,
	codexHookState,
	codexHooksDisabled,
	codexHooksPath,
	installCodex,
	uninstallCodex,
} from "../src/install/codex";

interface CodexEnv {
	HOME: string;
	AGENT_VOICE_EXECUTABLE: string;
}

function withTempHome<T>(fn: (env: CodexEnv) => T): T {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-codex-"));
	try {
		return fn({ HOME: home, AGENT_VOICE_EXECUTABLE: "/repo/bin/agent-voice" });
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

function readHooks(env: CodexEnv): Record<string, any> {
	return JSON.parse(readFileSync(codexHooksPath(env), "utf8"));
}

function writeHooks(env: CodexEnv, contents: string): void {
	const target = codexHooksPath(env);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, contents, "utf8");
}

describe("codex installer", () => {
	test("install writes Stop + PermissionRequest hooks pointing at our executable", () => {
		withTempHome((env) => {
			expect(installCodex(env).message).toContain("hooks.json");
			const hooks = readHooks(env);
			expect(hooks.Stop).toBeUndefined();
			expect(hooks.PermissionRequest).toBeUndefined();
			const stop = hooks.hooks.Stop[0].hooks[0];
			expect(stop.command).toContain("/repo/bin/agent-voice");
			expect(stop.command).toContain(
				"enqueue --format codex-stop-hook --agent codex",
			);
			expect(stop.statusMessage).toBe("Agent Voice: queue Codex turn summary");
			const perm = hooks.hooks.PermissionRequest[0].hooks[0];
			expect(perm.command).toContain(
				"enqueue --format codex-permission-hook --agent codex",
			);
			expect(codexHookState(env)).toBe("installed");
		});
	});

	test("install merges into an existing user hooks.json without clobbering", () => {
		withTempHome((env) => {
			writeHooks(
				env,
				JSON.stringify({
					hooks: {
						Stop: [
							{ hooks: [{ type: "command", command: "/usr/bin/mine.sh" }] },
						],
					},
				}),
			);
			installCodex(env);
			const hooks = readHooks(env);
			expect(hooks.Stop).toBeUndefined();
			const codexHooks = JSON.stringify(hooks.hooks);
			expect(codexHooks).toContain("/usr/bin/mine.sh");
			expect(codexHooks).toContain("codex-stop-hook");
			expect(codexHooks).toContain("codex-permission-hook");
		});
	});

	test("install migrates legacy top-level Codex events into the hooks object", () => {
		withTempHome((env) => {
			writeHooks(
				env,
				JSON.stringify({
					hooks: {
						SessionStart: [
							{ hooks: [{ type: "command", command: "/usr/bin/session.sh" }] },
						],
					},
					Stop: [{ hooks: [{ type: "command", command: "/usr/bin/mine.sh" }] }],
					PermissionRequest: [
						{
							matcher: "",
							hooks: [{ type: "command", command: "/usr/bin/perm.sh" }],
						},
					],
				}),
			);
			installCodex(env);
			const hooks = readHooks(env);
			expect(hooks.Stop).toBeUndefined();
			expect(hooks.PermissionRequest).toBeUndefined();
			expect(JSON.stringify(hooks.hooks.SessionStart)).toContain(
				"/usr/bin/session.sh",
			);
			expect(JSON.stringify(hooks.hooks.Stop)).toContain("/usr/bin/mine.sh");
			expect(JSON.stringify(hooks.hooks.Stop)).toContain("codex-stop-hook");
			expect(JSON.stringify(hooks.hooks.PermissionRequest)).toContain(
				"/usr/bin/perm.sh",
			);
			expect(JSON.stringify(hooks.hooks.PermissionRequest)).toContain(
				"codex-permission-hook",
			);
		});
	});
});

describe("codex installer idempotency", () => {
	test("install is idempotent for an owned hooks.json", () => {
		withTempHome((env) => {
			installCodex(env);
			const first = readFileSync(codexHooksPath(env), "utf8");
			installCodex(env);
			expect(readFileSync(codexHooksPath(env), "utf8")).toBe(first);
		});
	});
});

describe("codex uninstaller and hook state", () => {
	test("uninstall removes only our hooks", () => {
		withTempHome((env) => {
			writeHooks(
				env,
				JSON.stringify({
					hooks: {
						Stop: [
							{ hooks: [{ type: "command", command: "/usr/bin/mine.sh" }] },
						],
					},
				}),
			);
			installCodex(env);
			expect(uninstallCodex(env).message).toContain("uninstalled");
			const hooks = JSON.stringify(readHooks(env).hooks);
			expect(hooks).toContain("/usr/bin/mine.sh");
			expect(hooks).not.toContain("codex-stop-hook");
			expect(hooks).not.toContain("codex-permission-hook");
			expect(codexHookState(env)).toBe("not_installed");
		});
	});

	test("uninstall is a no-op when nothing is installed", () => {
		withTempHome((env) => {
			expect(uninstallCodex(env).message).toContain("not installed");
		});
	});

	test("hookState is not_installed when absent and unknown on bad JSON", () => {
		withTempHome((env) => {
			expect(codexHookState(env)).toBe("not_installed");
			writeHooks(env, "{ not json");
			expect(codexHookState(env)).toBe("unknown");
		});
	});

	test("install throws on a pre-existing invalid hooks.json (never clobbers)", () => {
		withTempHome((env) => {
			writeHooks(env, "{ not json");
			expect(() => installCodex(env)).toThrow("invalid Codex hooks JSON");
			expect(readFileSync(codexHooksPath(env), "utf8")).toBe("{ not json");
		});
	});
});

describe("codex hooks feature flag detection", () => {
	function writeCodexConfig(env: CodexEnv, contents: string): void {
		const config = codexConfigPath(env);
		mkdirSync(dirname(config), { recursive: true });
		writeFileSync(config, contents, "utf8");
	}

	test("codexHooksDisabled is false when config.toml is absent (hooks default on)", () => {
		withTempHome((env) => {
			expect(codexHooksDisabled(env)).toBe(false);
		});
	});

	test("codexHooksDisabled detects the [features] table form", () => {
		withTempHome((env) => {
			writeCodexConfig(env, "[features]\nhooks = false\n");
			expect(codexHooksDisabled(env)).toBe(true);
		});
	});

	test("codexHooksDisabled detects the dotted-key form", () => {
		withTempHome((env) => {
			writeCodexConfig(env, 'model = "gpt-5"\nfeatures.hooks = false\n');
			expect(codexHooksDisabled(env)).toBe(true);
		});
	});

	test("codexHooksDisabled ignores hooks = false under an unrelated table", () => {
		withTempHome((env) => {
			writeCodexConfig(env, "[some_tool]\nhooks = false\n");
			expect(codexHooksDisabled(env)).toBe(false);
		});
	});

	test("codexHooksDisabled is false when hooks are enabled", () => {
		withTempHome((env) => {
			writeCodexConfig(env, "[features]\nhooks = true\n");
			expect(codexHooksDisabled(env)).toBe(false);
		});
	});

	test("codexHooksDisabled only scans the [features] section, not a later table", () => {
		withTempHome((env) => {
			writeCodexConfig(
				env,
				"[features]\nhooks = true\n\n[some_tool]\nhooks = false\n",
			);
			expect(codexHooksDisabled(env)).toBe(false);
		});
	});
});
