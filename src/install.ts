import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentName } from "./config";
import {
	AGENT_VOICE_CLAUDE_QUESTION_STATUS_MESSAGE,
	AGENT_VOICE_CLAUDE_STATUS_MESSAGE,
	AGENT_VOICE_EXTENSION_MARKER,
	type AgentInstallState,
	type InstallEnv,
	type InstallResult,
	type JsonRecord,
	agentVoiceHome,
	assertOwnedIfPresent,
	clone,
	currentAgentVoiceExecutable,
	homeDir,
	isRecord,
	sameJson,
	shellQuote,
	writeJsonObjectIfChanged,
} from "./install/shared";
import {
	codexHookState,
	codexHooksDisabled,
	codexHooksPath,
	installCodex,
	uninstallCodex,
} from "./install/codex";
import {
	buildOpencodePluginSource,
	installOpencode,
	opencodeHookState,
	opencodePluginPath,
	uninstallOpencode,
} from "./install/opencode";

// Re-export the install surface consumed across the app and tests.
export type { AgentInstallState, InstallEnv, InstallResult };
export {
	AGENT_VOICE_CLAUDE_QUESTION_STATUS_MESSAGE,
	AGENT_VOICE_CLAUDE_STATUS_MESSAGE,
	AGENT_VOICE_EXTENSION_MARKER,
	codexHookState,
	codexHooksDisabled,
	codexHooksPath,
	installCodex,
	uninstallCodex,
	buildOpencodePluginSource,
	installOpencode,
	opencodeHookState,
	opencodePluginPath,
	uninstallOpencode,
};

export interface ClaudeInstallOptions {
	suspendExistingStopHooks?: boolean;
}

export interface ClaudeUninstallOptions {
	restoreSuspendedHooks?: boolean;
}

interface SuspendedClaudeStopHookEntry {
	groupIndex: number;
	hookIndex: number;
	group: JsonRecord;
	hook: JsonRecord;
}

interface SuspendedClaudeStopHooksBackup {
	version: 1;
	createdAt: string;
	settingsPath: string;
	entries: SuspendedClaudeStopHookEntry[];
}

export function piExtensionPath(env: InstallEnv): string {
	return join(homeDir(env), ".pi", "agent", "extensions", "agent-voice.ts");
}

export function claudeSettingsPath(env: InstallEnv): string {
	return join(homeDir(env), ".claude", "settings.json");
}

export function claudeSuspendedStopHooksPath(env: InstallEnv): string {
	return join(
		agentVoiceHome(env),
		"install",
		"claude-suspended-stop-hooks.json",
	);
}

function buildTextExtractor(): string {
	return `function textFromMessage(message) {
  const content = message?.content;
  if (typeof content === "string" && content.trim().length > 0) return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => typeof part === "string" ? part : part?.text)
      .filter((part) => typeof part === "string" && part.trim().length > 0)
      .join("\\n");
    if (text.trim().length > 0) return text;
  }
  if (typeof message?.text === "string" && message.text.trim().length > 0) {
    return message.text;
  }
  return "";
}

function textFromAgentEnd(event) {
  const messages = Array.isArray(event?.messages) ? event.messages : [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const text = textFromMessage(message);
    if (text.trim().length > 0) return text;
  }
  return null;
}`;
}

export function buildPiExtensionSource(env: InstallEnv): string {
	const executable = JSON.stringify(currentAgentVoiceExecutable(env));
	return `// ${AGENT_VOICE_EXTENSION_MARKER}
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const AGENT_VOICE = ${executable};

${buildTextExtractor()}

function cwdFromContext(ctx: unknown): string {
  const cwd = (ctx as { cwd?: unknown } | undefined)?.cwd;
  return typeof cwd === "string" && cwd.trim().length > 0 ? cwd : process.cwd();
}

function logEnqueueFailure(message) {
  console.error("[agent-voice] " + message);
}

function enqueue(text: string, cwd: string): void {
  try {
    if (!existsSync(AGENT_VOICE)) {
      logEnqueueFailure("agent-voice executable not found: " + AGENT_VOICE);
      return;
    }
    const child = spawn(AGENT_VOICE, ["enqueue", "--format", "text", "--agent", "pi", "--cwd", cwd], {
      stdio: ["pipe", "ignore", "ignore"],
      detached: true,
      env: { ...process.env, AGENT_VOICE_DISABLE: "1" },
    });
    child.on("error", (error) => {
      logEnqueueFailure("agent-voice enqueue failed to start: " + error.message);
    });
    child.stdin.on("error", (error) => {
      logEnqueueFailure("agent-voice enqueue stdin failed: " + error.message);
    });
    child.stdin.end(text);
    child.unref();
  } catch (error) {
    logEnqueueFailure("agent-voice enqueue failed: " + (error instanceof Error ? error.message : String(error)));
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", async (event, ctx) => {
    if (process.env.AGENT_VOICE_DISABLE === "1") return;
    // Speak only when this run produced genuine assistant prose: a real
    // completion, or a question / human-review request (which is itself prose,
    // and worth announcing). A content-free agent_end — subagent and delegate
    // returns, tool-only or aborted steps, retry/compaction boundaries — has
    // no narration, so stay silent instead of fabricating "finished responding".
    const text = textFromAgentEnd(event);
    if (text === null) return;
    enqueue(text, cwdFromContext(ctx));
  });
}
`;
}

export function installPi(env: InstallEnv): InstallResult {
	const target = piExtensionPath(env);
	assertOwnedIfPresent(target, "overwrite");
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, buildPiExtensionSource(env), "utf8");
	return { message: `installed Pi hook at ${target}` };
}

export function uninstallPi(env: InstallEnv): InstallResult {
	const target = piExtensionPath(env);
	if (!existsSync(target)) return { message: "Pi hook not installed" };
	assertOwnedIfPresent(target, "remove");
	rmSync(target, { force: true });
	return { message: `uninstalled Pi hook from ${target}` };
}

function piHookState(env: InstallEnv): AgentInstallState {
	let target: string;
	try {
		target = piExtensionPath(env);
	} catch {
		return "unknown"; // cannot resolve the path (e.g. HOME unset)
	}
	if (!existsSync(target)) return "not_installed";
	try {
		return readFileSync(target, "utf8").includes(AGENT_VOICE_EXTENSION_MARKER)
			? "installed"
			: "not_installed";
	} catch {
		return "unknown"; // the file exists but could not be read
	}
}

function claudeHookState(env: InstallEnv): AgentInstallState {
	let target: string;
	try {
		target = claudeSettingsPath(env);
	} catch {
		return "unknown"; // cannot resolve the path (e.g. HOME unset)
	}
	if (!existsSync(target)) return "not_installed";
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(target, "utf8"));
	} catch {
		return "unknown"; // settings.json is unreadable or not valid JSON
	}
	// The file parsed cleanly, so absence of our hook is a definitive negative.
	if (!isRecord(parsed) || !isRecord(parsed.hooks)) return "not_installed";
	const stop = parsed.hooks.Stop;
	if (!Array.isArray(stop)) return "not_installed";
	for (const group of stop) {
		for (const hook of hookHandlers(group) ?? []) {
			if (isAgentVoiceClaudeStopHook(hook)) return "installed";
		}
	}
	return "not_installed";
}

/**
 * Read-only, best-effort detection of which agent hooks are currently installed.
 * Never throws. A completed read yields "installed"/"not_installed"; a check
 * that cannot complete yields "unknown" (see {@link AgentInstallState}).
 */
export function detectAgentInstallStates(
	env: InstallEnv,
): Record<AgentName, AgentInstallState> {
	return {
		claude: claudeHookState(env),
		codex: codexHookState(env),
		pi: piHookState(env),
		opencode: opencodeHookState(env),
	};
}

function buildClaudeStopHook(env: InstallEnv): JsonRecord {
	return {
		type: "command",
		command: `${shellQuote(
			currentAgentVoiceExecutable(env),
		)} enqueue --format claude-stop-hook --agent claude`,
		async: true,
		timeout: 10,
		statusMessage: AGENT_VOICE_CLAUDE_STATUS_MESSAGE,
	};
}

function isAgentVoiceClaudeStopHook(hook: unknown): boolean {
	if (!isRecord(hook)) return false;
	if (hook.statusMessage === AGENT_VOICE_CLAUDE_STATUS_MESSAGE) return true;
	const args = hook.args;
	return (
		hook.type === "command" &&
		Array.isArray(args) &&
		args.includes("enqueue") &&
		args.includes("--format") &&
		args.includes("claude-stop-hook") &&
		args.includes("--agent") &&
		args.includes("claude")
	);
}

function buildClaudeQuestionHook(env: InstallEnv): JsonRecord {
	return {
		type: "command",
		command: `${shellQuote(
			currentAgentVoiceExecutable(env),
		)} enqueue --format claude-pretooluse-hook --agent claude`,
		async: true,
		timeout: 10,
		statusMessage: AGENT_VOICE_CLAUDE_QUESTION_STATUS_MESSAGE,
	};
}

function isAgentVoiceClaudeQuestionHook(hook: unknown): boolean {
	if (!isRecord(hook)) return false;
	if (hook.statusMessage === AGENT_VOICE_CLAUDE_QUESTION_STATUS_MESSAGE)
		return true;
	if (
		hook.type === "command" &&
		typeof hook.command === "string" &&
		hook.command.includes("claude-pretooluse-hook")
	) {
		return true;
	}
	const args = hook.args;
	return (
		hook.type === "command" &&
		Array.isArray(args) &&
		args.includes("enqueue") &&
		args.includes("--format") &&
		args.includes("claude-pretooluse-hook") &&
		args.includes("--agent") &&
		args.includes("claude")
	);
}

function isPeonStopHook(hook: unknown): boolean {
	return (
		isRecord(hook) &&
		hook.type === "command" &&
		typeof hook.command === "string" &&
		hook.command.includes("peon.sh")
	);
}

function loadClaudeSettings(target: string): {
	settings: JsonRecord;
	original: string | null;
} {
	if (!existsSync(target)) return { settings: {}, original: null };
	const original = readFileSync(target, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(original);
	} catch (error) {
		throw new Error(
			`invalid Claude settings JSON at ${target}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	if (!isRecord(parsed)) {
		throw new Error(
			`invalid Claude settings JSON at ${target}: expected object`,
		);
	}
	return { settings: parsed, original };
}

function ensureHooks(settings: JsonRecord): JsonRecord {
	if (settings.hooks === undefined) {
		settings.hooks = {};
		return settings.hooks as JsonRecord;
	}
	if (!isRecord(settings.hooks)) {
		throw new Error("Claude settings hooks must be an object");
	}
	return settings.hooks;
}

function ensureHookGroups(
	hooks: JsonRecord,
	key: "Stop" | "PreToolUse",
): unknown[] {
	if (hooks[key] === undefined) {
		hooks[key] = [];
		return hooks[key] as unknown[];
	}
	if (!Array.isArray(hooks[key])) {
		throw new Error(`Claude settings hooks.${key} must be an array`);
	}
	return hooks[key];
}

function hookHandlers(group: unknown): unknown[] | null {
	if (!isRecord(group)) return null;
	return Array.isArray(group.hooks) ? group.hooks : null;
}

function groupWithoutHooks(group: JsonRecord): JsonRecord {
	const copy = clone(group);
	delete copy.hooks;
	return copy;
}

function removeMatchingHooks(
	groups: unknown[],
	match: (hook: unknown) => boolean,
): number {
	let removed = 0;
	const nextGroups: unknown[] = [];
	for (const group of groups) {
		const hooks = hookHandlers(group);
		if (!hooks || !isRecord(group)) {
			nextGroups.push(group);
			continue;
		}
		const remaining: unknown[] = [];
		for (const hook of hooks) {
			if (match(hook)) {
				removed++;
				continue;
			}
			remaining.push(hook);
		}
		if (remaining.length > 0 || hooks.length === 0) {
			nextGroups.push({ ...group, hooks: remaining });
		}
	}
	if (removed > 0) groups.splice(0, groups.length, ...nextGroups);
	return removed;
}

function removeAgentVoiceClaudeStopHooks(stopGroups: unknown[]): number {
	return removeMatchingHooks(stopGroups, isAgentVoiceClaudeStopHook);
}

function removeAgentVoiceClaudeQuestionHooks(preToolUseGroups: unknown[]): number {
	return removeMatchingHooks(preToolUseGroups, isAgentVoiceClaudeQuestionHook);
}

function suspendPeonStopHooks(
	stopGroups: unknown[],
): SuspendedClaudeStopHookEntry[] {
	const suspended: SuspendedClaudeStopHookEntry[] = [];
	const nextGroups: unknown[] = [];

	for (let groupIndex = 0; groupIndex < stopGroups.length; groupIndex++) {
		const group = stopGroups[groupIndex];
		const hooks = hookHandlers(group);
		if (!hooks || !isRecord(group)) {
			nextGroups.push(group);
			continue;
		}

		const remaining: unknown[] = [];
		for (let hookIndex = 0; hookIndex < hooks.length; hookIndex++) {
			const hook = hooks[hookIndex];
			if (isPeonStopHook(hook) && isRecord(hook)) {
				suspended.push({
					groupIndex,
					hookIndex,
					group: groupWithoutHooks(group),
					hook: clone(hook),
				});
				continue;
			}
			remaining.push(hook);
		}

		if (remaining.length > 0 || hooks.length === 0) {
			nextGroups.push({ ...group, hooks: remaining });
		}
	}

	if (suspended.length > 0) {
		stopGroups.splice(0, stopGroups.length, ...nextGroups);
	}
	return suspended;
}

function readSuspendedBackup(
	env: InstallEnv,
): SuspendedClaudeStopHooksBackup | null {
	const target = claudeSuspendedStopHooksPath(env);
	if (!existsSync(target)) return null;
	const parsed = JSON.parse(
		readFileSync(target, "utf8"),
	) as SuspendedClaudeStopHooksBackup;
	if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
		throw new Error(`invalid Claude suspended hooks backup at ${target}`);
	}
	return parsed;
}

function writeSuspendedBackup(
	env: InstallEnv,
	backup: SuspendedClaudeStopHooksBackup,
): void {
	const target = claudeSuspendedStopHooksPath(env);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, `${JSON.stringify(backup, null, 2)}\n`, "utf8");
}

function mergeSuspendedEntries(
	env: InstallEnv,
	settingsPath: string,
	entries: SuspendedClaudeStopHookEntry[],
): void {
	if (entries.length === 0) return;
	const existing = readSuspendedBackup(env);
	const backup: SuspendedClaudeStopHooksBackup = existing ?? {
		version: 1,
		createdAt: new Date().toISOString(),
		settingsPath,
		entries: [],
	};
	const serialized = new Set(
		backup.entries.map((entry) => JSON.stringify(entry)),
	);
	let changed = false;
	for (const entry of entries) {
		const key = JSON.stringify(entry);
		if (serialized.has(key)) continue;
		backup.entries.push(entry);
		serialized.add(key);
		changed = true;
	}
	if (changed) writeSuspendedBackup(env, backup);
}

function stopGroupsContainHook(
	stopGroups: unknown[],
	targetHook: JsonRecord,
): boolean {
	for (const group of stopGroups) {
		for (const hook of hookHandlers(group) ?? []) {
			if (sameJson(hook, targetHook)) return true;
		}
	}
	return false;
}

function findStopGroupByMeta(
	stopGroups: unknown[],
	groupMeta: JsonRecord,
): JsonRecord | null {
	for (const group of stopGroups) {
		if (!isRecord(group)) continue;
		if (sameJson(groupWithoutHooks(group), groupMeta)) return group;
	}
	return null;
}

function restoreSuspendedEntries(
	stopGroups: unknown[],
	backup: SuspendedClaudeStopHooksBackup | null,
): number {
	if (!backup) return 0;
	let restored = 0;
	for (const entry of backup.entries) {
		if (!isRecord(entry.hook)) continue;
		if (stopGroupsContainHook(stopGroups, entry.hook)) continue;

		const groupMeta = isRecord(entry.group) ? entry.group : {};
		const existingGroup = findStopGroupByMeta(stopGroups, groupMeta);

		if (existingGroup) {
			if (!Array.isArray(existingGroup.hooks)) existingGroup.hooks = [];
			(existingGroup.hooks as unknown[]).push(clone(entry.hook));
		} else {
			const insertAt = Math.max(
				0,
				Math.min(
					Number.isInteger(entry.groupIndex)
						? entry.groupIndex
						: stopGroups.length,
					stopGroups.length,
				),
			);
			stopGroups.splice(insertAt, 0, {
				...clone(groupMeta),
				hooks: [clone(entry.hook)],
			});
		}
		restored++;
	}
	return restored;
}

export function installClaude(
	env: InstallEnv,
	options: ClaudeInstallOptions = {},
): InstallResult {
	const target = claudeSettingsPath(env);
	const { settings, original } = loadClaudeSettings(target);
	const hooks = ensureHooks(settings);
	const stopGroups = ensureHookGroups(hooks, "Stop");
	const preToolUseGroups = ensureHookGroups(hooks, "PreToolUse");

	const suspendedEntries = options.suspendExistingStopHooks
		? suspendPeonStopHooks(stopGroups)
		: [];
	mergeSuspendedEntries(env, target, suspendedEntries);

	removeAgentVoiceClaudeStopHooks(stopGroups);
	stopGroups.push({ matcher: "", hooks: [buildClaudeStopHook(env)] });

	// AskUserQuestion pauses mid-turn, so the Stop hook never fires for it.
	// A PreToolUse hook scoped to AskUserQuestion announces the question instead.
	removeAgentVoiceClaudeQuestionHooks(preToolUseGroups);
	preToolUseGroups.push({
		matcher: "AskUserQuestion",
		hooks: [buildClaudeQuestionHook(env)],
	});

	writeJsonObjectIfChanged(target, settings, original);
	const suspendedMessage =
		suspendedEntries.length > 0
			? `; suspended ${suspendedEntries.length} existing Claude Stop hook(s)`
			: "";
	return { message: `installed Claude hook at ${target}${suspendedMessage}` };
}

export function uninstallClaude(
	env: InstallEnv,
	options: ClaudeUninstallOptions = {},
): InstallResult {
	const restoreSuspendedHooks = options.restoreSuspendedHooks ?? true;
	const target = claudeSettingsPath(env);
	const backup = restoreSuspendedHooks ? readSuspendedBackup(env) : null;
	if (!existsSync(target) && !backup)
		return { message: "Claude hook not installed" };

	const { settings, original } = loadClaudeSettings(target);
	const hooks = ensureHooks(settings);
	const stopGroups = ensureHookGroups(hooks, "Stop");
	const removed = removeAgentVoiceClaudeStopHooks(stopGroups);
	const restored = restoreSuspendedEntries(stopGroups, backup);

	const removedQuestionHooks = Array.isArray(hooks.PreToolUse)
		? removeAgentVoiceClaudeQuestionHooks(hooks.PreToolUse)
		: 0;

	writeJsonObjectIfChanged(target, settings, original);
	if (backup) rmSync(claudeSuspendedStopHooksPath(env), { force: true });

	if (removed === 0 && removedQuestionHooks === 0 && restored === 0) {
		return { message: "Claude hook not installed" };
	}
	return {
		message: `uninstalled Claude hook from ${target}; restored ${restored} suspended hook(s)`,
	};
}
