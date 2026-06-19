import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	AGENT_VOICE_EXTENSION_MARKER,
	claudeSettingsPath,
	detectAgentInstallStates,
	installPi,
	piExtensionPath,
} from "../src/install";

function withTempHome<T>(fn: (env: { HOME: string }) => T): T {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-detect-"));
	try {
		return fn({ HOME: home });
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

function writeFile(path: string, contents: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, contents, "utf8");
}

describe("detectAgentInstallStates", () => {
	test("codex and opencode are always unsupported", () => {
		withTempHome((env) => {
			const states = detectAgentInstallStates(env);
			expect(states.codex).toBe("unsupported");
			expect(states.opencode).toBe("unsupported");
		});
	});

	test("pi is not_installed when the extension file is absent", () => {
		withTempHome((env) => {
			expect(detectAgentInstallStates(env).pi).toBe("not_installed");
		});
	});

	test("pi is installed when our marked extension file exists", () => {
		withTempHome((env) => {
			installPi({ ...env, AGENT_VOICE_EXECUTABLE: "/repo/bin/agent-voice" });
			expect(detectAgentInstallStates(env).pi).toBe("installed");
		});
	});

	test("pi is not_installed when the file exists without our marker", () => {
		withTempHome((env) => {
			writeFile(piExtensionPath(env), "// some other extension\n");
			expect(detectAgentInstallStates(env).pi).toBe("not_installed");
		});
	});

	test("claude is installed when settings.json holds our stop hook", () => {
		withTempHome((env) => {
			writeFile(
				claudeSettingsPath(env),
				JSON.stringify({
					hooks: {
						Stop: [
							{
								hooks: [
									{
										type: "command",
										command: "agent-voice enqueue --format claude-stop-hook --agent claude",
										statusMessage: "Agent Voice: queue Claude turn summary",
									},
								],
							},
						],
					},
				}),
			);
			expect(detectAgentInstallStates(env).claude).toBe("installed");
		});
	});

	test("claude is not_installed with no settings, no stop hook, or malformed JSON", () => {
		withTempHome((env) => {
			expect(detectAgentInstallStates(env).claude).toBe("not_installed");
			writeFile(claudeSettingsPath(env), JSON.stringify({ hooks: { Stop: [] } }));
			expect(detectAgentInstallStates(env).claude).toBe("not_installed");
			writeFile(claudeSettingsPath(env), "{ not valid json");
			expect(detectAgentInstallStates(env).claude).toBe("not_installed");
		});
	});

	test("avoids the marker constant drifting", () => {
		expect(AGENT_VOICE_EXTENSION_MARKER.length).toBeGreaterThan(0);
	});
});
