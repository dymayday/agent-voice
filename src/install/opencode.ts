import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	AGENT_VOICE_OPENCODE_MARKER,
	type AgentInstallState,
	type InstallEnv,
	type InstallResult,
	assertOwnedIfPresent,
	currentAgentVoiceExecutable,
	homeDir,
	readFileSafe,
} from "./shared";

export function opencodePluginPath(env: InstallEnv): string {
	return join(homeDir(env), ".config", "opencode", "plugin", "agent-voice.ts");
}

/**
 * Source of the OpenCode plugin we drop at ~/.config/opencode/plugin/. Mirrors
 * the Pi extension: a marker-owned file that spawns the baked-in agent-voice
 * executable. It announces turn completion (`session.idle` → last assistant
 * message via the SDK) and tool-approval prompts (`permission.updated` /
 * `permission.asked`, deduped by id). Every access is defensive and wrapped in
 * try/catch so a shape mismatch across OpenCode versions degrades to silence
 * instead of crashing OpenCode.
 */
export function buildOpencodePluginSource(env: InstallEnv): string {
	const executable = JSON.stringify(currentAgentVoiceExecutable(env));
	return `// ${AGENT_VOICE_OPENCODE_MARKER}
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const AGENT_VOICE = ${executable};
const announcedPermissions = new Set();

function logFailure(message) {
  console.error("[agent-voice] " + message);
}

function enqueue(text, cwd) {
  try {
    if (!existsSync(AGENT_VOICE)) {
      logFailure("agent-voice executable not found: " + AGENT_VOICE);
      return;
    }
    const args = ["enqueue", "--format", "text", "--agent", "opencode"];
    if (cwd) args.push("--cwd", cwd);
    const child = spawn(AGENT_VOICE, args, {
      stdio: ["pipe", "ignore", "ignore"],
      detached: true,
      env: { ...process.env, AGENT_VOICE_DISABLE: "1" },
    });
    child.on("error", (error) => logFailure("agent-voice enqueue failed to start: " + error.message));
    child.stdin.on("error", (error) => logFailure("agent-voice enqueue stdin failed: " + error.message));
    child.stdin.end(text);
    child.unref();
  } catch (error) {
    logFailure("agent-voice enqueue failed: " + (error instanceof Error ? error.message : String(error)));
  }
}

function lastAssistantText(messages) {
  const list = Array.isArray(messages)
    ? messages
    : (messages && Array.isArray(messages.data) ? messages.data : []);
  for (let index = list.length - 1; index >= 0; index--) {
    const message = list[index];
    const role = message && message.info && message.info.role
      ? message.info.role
      : (message ? message.role : undefined);
    if (role !== "assistant") continue;
    const parts = (message && message.parts) || (message && message.info && message.info.parts);
    if (Array.isArray(parts)) {
      const textPart = parts.find(
        (part) => part && part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0,
      );
      if (textPart) return textPart.text;
    }
    if (message && typeof message.text === "string" && message.text.trim().length > 0) {
      return message.text;
    }
  }
  return null;
}

function permissionText(props) {
  if (!props || typeof props !== "object") return null;
  const metadata = props.metadata && typeof props.metadata === "object" ? props.metadata : {};
  if (typeof metadata.command === "string" && metadata.command.trim().length > 0) {
    return "OpenCode is asking to approve running: " + metadata.command.trim();
  }
  if (typeof props.title === "string" && props.title.trim().length > 0) {
    return "OpenCode is asking for your approval: " + props.title.trim();
  }
  const tool = props.tool || props.type;
  if (typeof tool === "string" && tool.trim().length > 0) {
    return "OpenCode is asking to approve the " + tool.trim() + " tool.";
  }
  return null;
}

export const AgentVoice = async ({ client, directory }) => ({
  event: async ({ event }) => {
    if (process.env.AGENT_VOICE_DISABLE === "1") return;
    try {
      if (event && event.type === "session.idle") {
        const sessionID = event.properties && event.properties.sessionID;
        if (!sessionID) return;
        const messages = await client.session.messages({ path: { id: sessionID } });
        const text = lastAssistantText(messages);
        if (text) enqueue(text, directory);
        return;
      }
      if (event && (event.type === "permission.updated" || event.type === "permission.asked")) {
        const props = event.properties || {};
        const key = props.id;
        if (key && announcedPermissions.has(key)) return;
        const text = permissionText(props);
        // Mark seen only once we actually have something to say: a sparse first
        // event for an id (no usable text) must not block a later richer event
        // for the same id from being announced.
        if (!text) return;
        if (key) announcedPermissions.add(key);
        enqueue(text, directory);
      }
    } catch (error) {
      logFailure("opencode handler failed: " + (error instanceof Error ? error.message : String(error)));
    }
  },
});
`;
}

export function installOpencode(env: InstallEnv): InstallResult {
	const target = opencodePluginPath(env);
	assertOwnedIfPresent(target, "overwrite", AGENT_VOICE_OPENCODE_MARKER);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, buildOpencodePluginSource(env), "utf8");
	return { message: `installed OpenCode plugin at ${target}` };
}

export function uninstallOpencode(env: InstallEnv): InstallResult {
	const target = opencodePluginPath(env);
	if (!existsSync(target)) return { message: "OpenCode hook not installed" };
	assertOwnedIfPresent(target, "remove", AGENT_VOICE_OPENCODE_MARKER);
	rmSync(target, { force: true });
	return { message: `uninstalled OpenCode plugin from ${target}` };
}

export function opencodeHookState(env: InstallEnv): AgentInstallState {
	let target: string;
	try {
		target = opencodePluginPath(env);
	} catch {
		return "unknown"; // cannot resolve the path (e.g. HOME unset)
	}
	if (!existsSync(target)) return "not_installed";
	const text = readFileSafe(target);
	if (text === null) return "unknown"; // the file exists but could not be read
	return text.includes(AGENT_VOICE_OPENCODE_MARKER)
		? "installed"
		: "not_installed";
}
