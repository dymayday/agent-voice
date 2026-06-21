import { AGENT_NAMES, isAgentName, type AgentName } from "../config";
import {
	claudeSettingsPath,
	codexHooksPath,
	detectAgentInstallStates,
	installClaude,
	installCodex,
	installOpencode,
	installPi,
	opencodePluginPath,
	piExtensionPath,
	uninstallClaude,
	uninstallCodex,
	uninstallOpencode,
	uninstallPi,
	type AgentInstallState,
	type InstallEnv,
} from "../install";
import { fail, ok } from "./errors";
import type { AppServiceResult } from "./types";

export interface HookAgentState {
	agent: AgentName;
	state: AgentInstallState;
	target: string;
}

export interface HookStatesSnapshot {
	agents: Record<AgentName, HookAgentState>;
}

export interface HookMutationResult extends HookAgentState {
	message: string;
}

export function assertSupportedAgent(
	agent: string,
): asserts agent is AgentName {
	if (!isAgentName(agent)) throw new Error(`Unsupported agent: ${agent}`);
}

export function hookTargetLabel(
	agent: AgentName,
	env: InstallEnv = process.env as InstallEnv,
): string {
	if (agent === "pi") return piExtensionPath(env);
	if (agent === "claude") return claudeSettingsPath(env);
	if (agent === "codex") return codexHooksPath(env);
	return opencodePluginPath(env);
}

function snapshotFor(env: InstallEnv): HookStatesSnapshot {
	const states = detectAgentInstallStates(env);
	return {
		agents: Object.fromEntries(
			AGENT_NAMES.map((agent) => [
				agent,
				{ agent, state: states[agent], target: hookTargetLabel(agent, env) },
			]),
		) as Record<AgentName, HookAgentState>,
	};
}

export function getHookStates(
	env: InstallEnv = process.env as InstallEnv,
): AppServiceResult<HookStatesSnapshot> {
	try {
		return ok(snapshotFor(env));
	} catch (error) {
		return fail(
			"INTERNAL",
			error instanceof Error ? error.message : String(error),
		);
	}
}

function installAgent(agent: AgentName, env: InstallEnv): string {
	if (agent === "pi") return installPi(env).message;
	if (agent === "claude") return installClaude(env).message;
	if (agent === "codex") return installCodex(env).message;
	return installOpencode(env).message;
}

function uninstallAgent(agent: AgentName, env: InstallEnv): string {
	if (agent === "pi") return uninstallPi(env).message;
	if (agent === "claude") return uninstallClaude(env).message;
	if (agent === "codex") return uninstallCodex(env).message;
	return uninstallOpencode(env).message;
}

export function installHook(
	agent: string,
	env: InstallEnv = process.env as InstallEnv,
): AppServiceResult<HookMutationResult> {
	if (!isAgentName(agent)) {
		return fail("BAD_INPUT", `Unsupported agent: ${agent}`);
	}
	try {
		const message = installAgent(agent, env);
		const state = detectAgentInstallStates(env)[agent];
		return ok({
			agent,
			state,
			target: hookTargetLabel(agent, env),
			message,
		});
	} catch (error) {
		return fail(
			"INTERNAL",
			error instanceof Error ? error.message : String(error),
		);
	}
}

export function uninstallHook(
	agent: string,
	env: InstallEnv = process.env as InstallEnv,
): AppServiceResult<HookMutationResult> {
	if (!isAgentName(agent)) {
		return fail("BAD_INPUT", `Unsupported agent: ${agent}`);
	}
	try {
		const message = uninstallAgent(agent, env);
		const state = detectAgentInstallStates(env)[agent];
		return ok({
			agent,
			state,
			target: hookTargetLabel(agent, env),
			message,
		});
	} catch (error) {
		return fail(
			"INTERNAL",
			error instanceof Error ? error.message : String(error),
		);
	}
}
