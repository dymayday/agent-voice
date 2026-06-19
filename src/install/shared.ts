import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { join } from "node:path";

/**
 * Environment slice the installers read. HOME locates each agent's config;
 * AGENT_VOICE_HOME/AGENT_VOICE_EXECUTABLE override the managed home and the
 * executable path baked into generated hooks.
 */
export interface InstallEnv {
	HOME?: string;
	AGENT_VOICE_HOME?: string;
	AGENT_VOICE_EXECUTABLE?: string;
}

export interface InstallResult {
	message: string;
}

/**
 * Three-way install state for a single agent's hook.
 *
 * Wire contract: these exact strings are serialized into the status snapshot's
 * `install` map and decoded by the macOS app's `InstallState` enum
 * (macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceStatus.swift) — keep the
 * raw values in sync with the Swift `rawValue`s.
 *
 * - "installed" / "not_installed": the file was read and the answer is known.
 * - "unsupported": no install path exists (no agent currently uses this).
 * - "unknown": the check itself could not complete (HOME unset, permission
 *   denied, corrupt settings, transient I/O). The app renders this as a neutral
 *   "Checking…" badge with no install button.
 */
export type AgentInstallState =
	| "installed"
	| "not_installed"
	| "unsupported"
	| "unknown";

export type JsonRecord = Record<string, unknown>;

export const AGENT_VOICE_EXTENSION_MARKER =
	"agent-voice pi extension managed by agent-voice";

export const AGENT_VOICE_OPENCODE_MARKER =
	"agent-voice opencode plugin managed by agent-voice";

export const AGENT_VOICE_CLAUDE_STATUS_MESSAGE =
	"Agent Voice: queue Claude turn summary";

export const AGENT_VOICE_CLAUDE_QUESTION_STATUS_MESSAGE =
	"Agent Voice: queue Claude question";

export const AGENT_VOICE_CODEX_STOP_STATUS_MESSAGE =
	"Agent Voice: queue Codex turn summary";

export const AGENT_VOICE_CODEX_PERMISSION_STATUS_MESSAGE =
	"Agent Voice: queue Codex approval prompt";

export function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

export function sameJson(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function homeDir(env: InstallEnv): string {
	if (!env.HOME) throw new Error("HOME is required for install");
	return env.HOME;
}

export function agentVoiceHome(env: InstallEnv): string {
	return resolve(env.AGENT_VOICE_HOME ?? join(homeDir(env), ".agent-voice"));
}

export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function rootFromEntrypoint(entrypoint: string): string | null {
	const resolved = resolve(entrypoint);
	const file = basename(resolved);
	const parent = basename(dirname(resolved));
	if (file === "index.ts" && parent === "src")
		return dirname(dirname(resolved));
	if (file === "agent-voice" && parent === "bin")
		return dirname(dirname(resolved));
	return null;
}

export function currentAgentVoiceExecutable(env: InstallEnv): string {
	if (env.AGENT_VOICE_EXECUTABLE) return resolve(env.AGENT_VOICE_EXECUTABLE);
	const root = process.argv[1] ? rootFromEntrypoint(process.argv[1]) : null;
	return join(root ?? process.cwd(), "bin", "agent-voice");
}

/**
 * Refuse to overwrite/remove a file at `path` unless it carries `marker`,
 * proving agent-voice authored it. A missing file is fine (nothing to protect).
 */
export function assertOwnedIfPresent(
	path: string,
	action: "overwrite" | "remove",
	marker: string = AGENT_VOICE_EXTENSION_MARKER,
): void {
	if (!existsSync(path)) return;
	const existing = readFileSync(path, "utf8");
	if (!existing.includes(marker)) {
		const verb = action === "overwrite" ? "overwrite" : "remove";
		throw new Error(
			`refusing to ${verb} ${path}; file is not owned by agent-voice`,
		);
	}
}

/** Read a file as text, returning null on any read error (never throws). */
export function readFileSafe(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

/**
 * Read a JSON file expected to hold an object.
 * - absent → `{ value: null, original: null }` (caller treats as empty `{}`)
 * - present + valid object → `{ value, original }`
 * - present + invalid JSON or non-object → `{ value: null, original: <text> }`
 *   (caller can distinguish this from "absent" because `original !== null`).
 */
export function readJsonObjectFile(path: string): {
	value: JsonRecord | null;
	original: string | null;
} {
	if (!existsSync(path)) return { value: null, original: null };
	const original = readFileSync(path, "utf8");
	try {
		const parsed = JSON.parse(original);
		return { value: isRecord(parsed) ? parsed : null, original };
	} catch {
		return { value: null, original };
	}
}

export function backupFile(path: string, original: string): void {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	writeFileSync(`${path}.agent-voice-backup-${stamp}`, original, "utf8");
}

/**
 * Serialize `obj` (2-space indent + trailing newline) and write it to `path`
 * only when the result differs from `original`. Creates the parent directory
 * and backs up any pre-existing content. Returns whether a write happened.
 */
export function writeJsonObjectIfChanged(
	path: string,
	obj: JsonRecord,
	original: string | null,
): boolean {
	const next = `${JSON.stringify(obj, null, 2)}\n`;
	if (next === original) return false;
	mkdirSync(dirname(path), { recursive: true });
	if (original !== null) backupFile(path, original);
	writeFileSync(path, next, "utf8");
	return true;
}
