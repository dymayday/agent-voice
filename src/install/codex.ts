import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	AGENT_VOICE_CODEX_PERMISSION_STATUS_MESSAGE,
	AGENT_VOICE_CODEX_STOP_STATUS_MESSAGE,
	type AgentInstallState,
	type InstallEnv,
	type InstallResult,
	type JsonRecord,
	currentAgentVoiceExecutable,
	homeDir,
	isRecord,
	readJsonObjectFile,
	shellQuote,
	writeJsonObjectIfChanged,
} from "./shared";

// Codex loads lifecycle hooks from ~/.codex/hooks.json (JSON we own and merge
// into, never the user's TOML). The file's supported top-level shape is
// `{ "hooks": { <event>: [<groups>] } }`; each event maps to an array of groups,
// and each group has a `hooks` array of command handlers. Codex delivers the
// event payload to the command on stdin as JSON — identical to Claude Code hooks
// — so the commands reuse the existing `enqueue --format … --agent codex` path.
const AGENT_VOICE_HOOK_EVENTS = ["Stop", "PermissionRequest"] as const;
const CODEX_HOOK_EVENT_KEYS = [
	"SessionStart",
	"PreToolUse",
	"PermissionRequest",
	"PostToolUse",
	"UserPromptSubmit",
	"PreCompact",
	"PostCompact",
	"Notification",
	"SubagentStart",
	"SubagentStop",
	"Stop",
] as const;

export function codexHooksPath(env: InstallEnv): string {
	return join(homeDir(env), ".codex", "hooks.json");
}

export function codexConfigPath(env: InstallEnv): string {
	return join(homeDir(env), ".codex", "config.toml");
}

function hookCommand(env: InstallEnv, format: string): string {
	return `${shellQuote(
		currentAgentVoiceExecutable(env),
	)} enqueue --format ${format} --agent codex`;
}

function stopGroup(env: InstallEnv): JsonRecord {
	return {
		hooks: [
			{
				type: "command",
				command: hookCommand(env, "codex-stop-hook"),
				timeout: 10,
				statusMessage: AGENT_VOICE_CODEX_STOP_STATUS_MESSAGE,
			},
		],
	};
}

function permissionGroup(env: InstallEnv): JsonRecord {
	return {
		matcher: "",
		hooks: [
			{
				type: "command",
				command: hookCommand(env, "codex-permission-hook"),
				timeout: 10,
				statusMessage: AGENT_VOICE_CODEX_PERMISSION_STATUS_MESSAGE,
			},
		],
	};
}

function isAgentVoiceCodexHook(hook: unknown): boolean {
	if (!isRecord(hook)) return false;
	if (
		hook.statusMessage === AGENT_VOICE_CODEX_STOP_STATUS_MESSAGE ||
		hook.statusMessage === AGENT_VOICE_CODEX_PERMISSION_STATUS_MESSAGE
	) {
		return true;
	}
	return (
		typeof hook.command === "string" &&
		(hook.command.includes("codex-stop-hook") ||
			hook.command.includes("codex-permission-hook")) &&
		hook.command.includes("--agent codex")
	);
}

function groupHooks(group: unknown): unknown[] {
	return isRecord(group) && Array.isArray(group.hooks) ? group.hooks : [];
}

function mergeEventGroups(
	hooks: JsonRecord,
	key: string,
	groups: unknown[],
): void {
	if (hooks[key] === undefined) {
		hooks[key] = groups;
		return;
	}
	if (!Array.isArray(hooks[key])) {
		throw new Error(`Codex hooks.${key} must be an array`);
	}
	(hooks[key] as unknown[]).push(...groups);
}

function ensureHooksObject(settings: JsonRecord): JsonRecord {
	let hooks: JsonRecord;
	if (settings.hooks === undefined) {
		hooks = {};
		settings.hooks = hooks;
	} else if (isRecord(settings.hooks)) {
		hooks = settings.hooks;
	} else {
		throw new Error("Codex hooks.json field hooks must be an object");
	}

	// Older Agent Voice builds wrote Codex events at the file root, which Codex now
	// rejects with `unknown field 'Stop', expected 'hooks'`. Move recognized legacy
	// event arrays into the supported object and delete the invalid root keys.
	for (const key of CODEX_HOOK_EVENT_KEYS) {
		const groups = settings[key];
		if (groups === undefined) continue;
		if (!Array.isArray(groups)) {
			throw new Error(`Codex legacy top-level ${key} must be an array`);
		}
		mergeEventGroups(hooks, key, groups);
		delete settings[key];
	}

	return hooks;
}

function ensureEventGroups(hooks: JsonRecord, key: string): unknown[] {
	if (hooks[key] === undefined) {
		hooks[key] = [];
		return hooks[key] as unknown[];
	}
	if (!Array.isArray(hooks[key])) {
		throw new Error(`Codex hooks.${key} must be an array`);
	}
	return hooks[key] as unknown[];
}

/** Drop every group that contains one of our hooks; returns how many were removed. */
function dropAgentVoiceGroups(groups: unknown[]): number {
	const kept = groups.filter(
		(group) => !groupHooks(group).some(isAgentVoiceCodexHook),
	);
	const removed = groups.length - kept.length;
	if (removed > 0) groups.splice(0, groups.length, ...kept);
	return removed;
}

function loadCodexHooks(target: string): {
	settings: JsonRecord;
	original: string | null;
} {
	const { value, original } = readJsonObjectFile(target);
	if (original !== null && value === null) {
		throw new Error(`invalid Codex hooks JSON at ${target}`);
	}
	return { settings: value ?? {}, original };
}

export function installCodex(env: InstallEnv): InstallResult {
	const target = codexHooksPath(env);
	const { settings, original } = loadCodexHooks(target);
	const hooks = ensureHooksObject(settings);

	const stop = ensureEventGroups(hooks, "Stop");
	dropAgentVoiceGroups(stop);
	stop.push(stopGroup(env));

	const permission = ensureEventGroups(hooks, "PermissionRequest");
	dropAgentVoiceGroups(permission);
	permission.push(permissionGroup(env));

	writeJsonObjectIfChanged(target, settings, original);
	return { message: `installed Codex hooks at ${target}` };
}

export function uninstallCodex(env: InstallEnv): InstallResult {
	const target = codexHooksPath(env);
	if (!existsSync(target)) return { message: "Codex hook not installed" };

	const { settings, original } = loadCodexHooks(target);
	const hooks = ensureHooksObject(settings);
	let removed = 0;
	for (const key of AGENT_VOICE_HOOK_EVENTS) {
		if (Array.isArray(hooks[key])) {
			removed += dropAgentVoiceGroups(hooks[key] as unknown[]);
		}
	}
	if (removed === 0) return { message: "Codex hook not installed" };

	writeJsonObjectIfChanged(target, settings, original);
	return { message: `uninstalled Codex hooks from ${target}` };
}

export function codexHookState(env: InstallEnv): AgentInstallState {
	let target: string;
	try {
		target = codexHooksPath(env);
	} catch {
		return "unknown"; // cannot resolve the path (e.g. HOME unset)
	}
	if (!existsSync(target)) return "not_installed";
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(target, "utf8"));
	} catch {
		return "unknown"; // hooks.json is unreadable or not valid JSON
	}
	if (!isRecord(parsed)) return "not_installed";
	if (parsed.hooks === undefined) return "not_installed";
	if (!isRecord(parsed.hooks)) return "unknown";
	for (const key of AGENT_VOICE_HOOK_EVENTS) {
		const groups = parsed.hooks[key];
		if (!Array.isArray(groups)) continue;
		for (const group of groups) {
			if (groupHooks(group).some(isAgentVoiceCodexHook)) return "installed";
		}
	}
	return "not_installed";
}

/**
 * Best-effort, read-only check for an explicit `features.hooks = false` in
 * ~/.codex/config.toml. Returns true only when hooks are clearly disabled; a
 * missing/unreadable config (hooks default on) returns false. Never writes.
 *
 * This is a lightweight TOML scan (no parser dependency), but it is
 * structure-aware enough to avoid the two failure modes of a naive whole-file
 * match: it recognizes the dotted-key form `features.hooks = false`, and it only
 * honors a bare `hooks = false` when it sits inside the `[features]` table — a
 * `hooks = false` under any other table is ignored. It does not handle the
 * inline-table form (`features = { hooks = false }`), which is vanishingly rare
 * in hand-written Codex configs.
 */
export function codexHooksDisabled(env: InstallEnv): boolean {
	let target: string;
	try {
		target = codexConfigPath(env);
	} catch {
		return false;
	}
	if (!existsSync(target)) return false;
	let text: string;
	try {
		text = readFileSync(target, "utf8");
	} catch {
		return false;
	}

	// Dotted-key form, valid anywhere at the top level.
	if (/(^|\n)[ \t]*features\.hooks[ \t]*=[ \t]*false\b/.test(text)) return true;

	// `[features]` table form: only honor `hooks = false` until the next table
	// header so an unrelated `[other]` table's `hooks = false` never matches.
	const header = /(^|\n)[ \t]*\[features\][ \t]*(?=\r?\n|$)/.exec(text);
	if (header) {
		const after = text.slice(header.index + header[0].length);
		const nextTable = after.search(/\n[ \t]*\[/);
		const section = nextTable === -1 ? after : after.slice(0, nextTable);
		if (/(^|\n)[ \t]*hooks[ \t]*=[ \t]*false\b/.test(section)) return true;
	}

	return false;
}
