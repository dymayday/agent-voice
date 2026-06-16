import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export const AGENT_VOICE_EXTENSION_MARKER =
	"agent-voice pi extension managed by agent-voice";

export interface InstallEnv {
	HOME?: string;
	AGENT_VOICE_EXECUTABLE?: string;
}

export interface InstallResult {
	message: string;
}

function homeDir(env: InstallEnv): string {
	if (!env.HOME) throw new Error("HOME is required for Pi install");
	return env.HOME;
}

export function piExtensionPath(env: InstallEnv): string {
	return join(homeDir(env), ".pi", "agent", "extensions", "agent-voice.ts");
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

function currentAgentVoiceExecutable(env: InstallEnv): string {
	if (env.AGENT_VOICE_EXECUTABLE) return resolve(env.AGENT_VOICE_EXECUTABLE);
	const root = process.argv[1] ? rootFromEntrypoint(process.argv[1]) : null;
	return join(root ?? process.cwd(), "bin", "agent-voice");
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

function enqueue(text: string, cwd: string): void {
  try {
    if (!existsSync(AGENT_VOICE)) return;
    const child = spawn(AGENT_VOICE, ["enqueue", "--format", "text", "--agent", "pi", "--cwd", cwd], {
      stdio: ["pipe", "ignore", "ignore"],
      detached: true,
      env: { ...process.env, AGENT_VOICE_DISABLE: "1" },
    });
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(text);
    child.unref();
  } catch {
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

function assertOwnedIfPresent(
	path: string,
	action: "overwrite" | "remove",
): void {
	if (!existsSync(path)) return;
	const existing = readFileSync(path, "utf8");
	if (!existing.includes(AGENT_VOICE_EXTENSION_MARKER)) {
		const verb = action === "overwrite" ? "overwrite" : "remove";
		throw new Error(
			`refusing to ${verb} ${path}; file is not owned by agent-voice`,
		);
	}
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
