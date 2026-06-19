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
			const stop = hooks.Stop[0].hooks[0];
			expect(stop.command).toContain("/repo/bin/agent-voice");
			expect(stop.command).toContain(
				"enqueue --format codex-stop-hook --agent codex",
			);
			expect(stop.statusMessage).toBe("Agent Voice: queue Codex turn summary");
			const perm = hooks.PermissionRequest[0].hooks[0];
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
					Stop: [{ hooks: [{ type: "command", command: "/usr/bin/mine.sh" }] }],
				}),
			);
			installCodex(env);
			const hooks = JSON.stringify(readHooks(env));
			expect(hooks).toContain("/usr/bin/mine.sh");
			expect(hooks).toContain("codex-stop-hook");
			expect(hooks).toContain("codex-permission-hook");
		});
	});

	test("install is idempotent for an owned hooks.json", () => {
		withTempHome((env) => {
			installCodex(env);
			const first = readFileSync(codexHooksPath(env), "utf8");
			installCodex(env);
			expect(readFileSync(codexHooksPath(env), "utf8")).toBe(first);
		});
	});

	test("uninstall removes only our hooks", () => {
		withTempHome((env) => {
			writeHooks(
				env,
				JSON.stringify({
					Stop: [{ hooks: [{ type: "command", command: "/usr/bin/mine.sh" }] }],
				}),
			);
			installCodex(env);
			expect(uninstallCodex(env).message).toContain("uninstalled");
			const hooks = JSON.stringify(readHooks(env));
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

	test("codexHooksDisabled detects an explicit features.hooks = false", () => {
		withTempHome((env) => {
			expect(codexHooksDisabled(env)).toBe(false);
			const config = codexConfigPath(env);
			mkdirSync(dirname(config), { recursive: true });
			writeFileSync(config, "[features]\nhooks = false\n", "utf8");
			expect(codexHooksDisabled(env)).toBe(true);
		});
	});
});
