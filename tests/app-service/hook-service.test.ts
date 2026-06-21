import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentName } from "../../src/config";
import {
	assertSupportedAgent,
	getHookStates,
	hookTargetLabel,
	installHook,
	uninstallHook,
} from "../../src/app-service/hook-service";

function tempEnv() {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-hook-service-"));
	return { home, env: { HOME: home } };
}

describe("hook service", () => {
	test("labels supported hook targets", () => {
		const { home, env } = tempEnv();
		try {
			expect(hookTargetLabel("pi", env)).toContain(".pi");
			expect(hookTargetLabel("codex", env)).toContain("codex");
			const agents: AgentName[] = ["claude", "codex", "opencode", "pi"];
			for (const agent of agents) {
				expect(hookTargetLabel(agent, env).length).toBeGreaterThan(0);
			}
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("rejects unsupported agent", () => {
		expect(() => assertSupportedAgent("bad")).toThrow("Unsupported agent");
	});

	test("getHookStates returns all states and target labels read-only", () => {
		const { home, env } = tempEnv();
		try {
			const result = getHookStates(env);
			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error(result.error.message);
			expect(Object.keys(result.value.agents).sort()).toEqual([
				"claude",
				"codex",
				"opencode",
				"pi",
			]);
			expect(result.value.agents.pi).toMatchObject({
				state: "not_installed",
				target: expect.stringContaining(".pi"),
			});
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("installHook and uninstallHook return typed results and update temp HOME state", () => {
		const { home, env } = tempEnv();
		try {
			const installed = installHook("pi", env);
			expect(installed.ok).toBe(true);
			if (!installed.ok) throw new Error(installed.error.message);
			expect(installed.value.agent).toBe("pi");
			expect(installed.value.state).toBe("installed");
			expect(installed.value.target).toContain(".pi");

			const states = getHookStates(env);
			expect(states.ok && states.value.agents.pi.state).toBe("installed");

			const uninstalled = uninstallHook("pi", env);
			expect(uninstalled.ok).toBe(true);
			if (!uninstalled.ok) throw new Error(uninstalled.error.message);
			expect(uninstalled.value.state).toBe("not_installed");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("unsupported install and uninstall return BAD_INPUT", () => {
		const { home, env } = tempEnv();
		try {
			expect(installHook("bad", env)).toMatchObject({
				ok: false,
				error: { code: "BAD_INPUT" },
			});
			expect(uninstallHook("bad", env)).toMatchObject({
				ok: false,
				error: { code: "BAD_INPUT" },
			});
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
