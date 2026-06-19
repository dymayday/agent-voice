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
	test("codex and opencode are not_installed in an empty home", () => {
		withTempHome((env) => {
			const states = detectAgentInstallStates(env);
			expect(states.codex).toBe("not_installed");
			expect(states.opencode).toBe("not_installed");
		});
	});

	test("codex is installed when hooks.json holds our hook", () => {
		withTempHome((env) => {
			writeFile(
				join(env.HOME, ".codex", "hooks.json"),
				JSON.stringify({
					Stop: [
						{
							hooks: [
								{
									type: "command",
									command:
										"agent-voice enqueue --format codex-stop-hook --agent codex",
									statusMessage: "Agent Voice: queue Codex turn summary",
								},
							],
						},
					],
				}),
			);
			expect(detectAgentInstallStates(env).codex).toBe("installed");
		});
	});

	test("opencode is installed when our marked plugin exists", () => {
		withTempHome((env) => {
			writeFile(
				join(env.HOME, ".config", "opencode", "plugin", "agent-voice.ts"),
				"// agent-voice opencode plugin managed by agent-voice\n",
			);
			expect(detectAgentInstallStates(env).opencode).toBe("installed");
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

	test("claude is installed via the legacy args-array stop hook format", () => {
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
										args: [
											"enqueue",
											"--format",
											"claude-stop-hook",
											"--agent",
											"claude",
										],
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

	test("claude is not_installed when settings parse but hold no stop hook", () => {
		withTempHome((env) => {
			expect(detectAgentInstallStates(env).claude).toBe("not_installed");
			writeFile(claudeSettingsPath(env), JSON.stringify({ hooks: { Stop: [] } }));
			expect(detectAgentInstallStates(env).claude).toBe("not_installed");
		});
	});

	test("claude is unknown when settings.json cannot be parsed", () => {
		withTempHome((env) => {
			writeFile(claudeSettingsPath(env), "{ not valid json");
			expect(detectAgentInstallStates(env).claude).toBe("unknown");
		});
	});

	test("all agents are unknown when the check cannot run (HOME unset)", () => {
		const states = detectAgentInstallStates({});
		expect(states.claude).toBe("unknown");
		expect(states.pi).toBe("unknown");
		expect(states.codex).toBe("unknown");
		expect(states.opencode).toBe("unknown");
	});

	test("the extension marker constant matches the published wire value", () => {
		expect(AGENT_VOICE_EXTENSION_MARKER).toBe(
			"agent-voice pi extension managed by agent-voice",
		);
	});
});
