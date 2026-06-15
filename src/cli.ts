import { extractClaudeStopHook } from "./adapters/claude";
import {
	defaultConfig,
	isAgentName,
	loadConfig,
	saveConfig,
	setConfigValue,
} from "./config";
import { createEvent, type AgentVoiceEvent, validateEvent } from "./events";
import { resolvePaths } from "./paths";
import { enqueueEvent } from "./spool";

export interface CliIo {
	stdout?: string;
	stderr?: string;
	stdin?: string;
	env?: Record<string, string | undefined>;
}

export interface CliResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

const HELP = `agent-voice - speak one-line summaries of coding-agent turns

Usage:
  agent-voice install [--agents claude,pi,codex,opencode] [--kokoro-script /abs/path]
  agent-voice uninstall [--restore-backups]
  agent-voice start
  agent-voice stop
  agent-voice status
  agent-voice enqueue --format text --agent claude --cwd "$PWD"
  agent-voice enqueue --format event-json
  agent-voice enqueue --format claude-stop-hook --agent claude
  agent-voice test "Claude finished editing the auth module."
  agent-voice enable claude
  agent-voice disable codex
  agent-voice config get
  agent-voice config set summarizer.timeoutSeconds 8
  agent-voice daemon --foreground
`;

function result(exitCode: number, stdout = "", stderr = ""): CliResult {
	return { exitCode, stdout, stderr };
}

function getOption(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index === -1) return undefined;
	return args[index + 1];
}

function parseJson(input: string): unknown {
	return JSON.parse(input || "{}");
}

function loadConfigForEnqueue(paths: ReturnType<typeof resolvePaths>) {
	try {
		return loadConfig(paths);
	} catch {
		return defaultConfig;
	}
}

function truncateInput(text: string, maxInputChars: number): string {
	return text.slice(0, maxInputChars);
}

export async function runCli(
	args: string[],
	io: CliIo = {},
): Promise<CliResult> {
	const [command] = args;
	const paths = resolvePaths(io.env ?? process.env);

	if (
		!command ||
		command === "--help" ||
		command === "-h" ||
		command === "help"
	) {
		return result(0, HELP);
	}

	if (command === "config") {
		const [, subcommand, key, value] = args;

		if (subcommand === "get") {
			const config = loadConfig(paths);
			return result(0, `${JSON.stringify(config, null, 2)}\n`);
		}

		if (subcommand === "set" && key && value !== undefined) {
			try {
				const config = loadConfig(paths, { createIfMissing: false });
				const updated = setConfigValue(config, key, value);
				saveConfig(paths, updated);
				return result(0, "");
			} catch (error) {
				return result(
					2,
					"",
					`${error instanceof Error ? error.message : String(error)}\n`,
				);
			}
		}

		return result(2, "", "Usage: agent-voice config get|set <path> <value>\n");
	}

	if (command === "enable" || command === "disable") {
		const agent = args[1];
		if (!agent || !isAgentName(agent)) {
			return result(2, "", `Unknown agent: ${agent ?? ""}\n`);
		}

		const config = loadConfig(paths);
		config.agents[agent].enabled = command === "enable";
		saveConfig(paths, config);
		return result(0, "");
	}

	if (command === "enqueue") {
		const format = getOption(args, "--format");
		const agentOption = getOption(args, "--agent");
		const cwd = getOption(args, "--cwd");
		const stdin = io.stdin ?? "";

		if (!format) return result(2, "", "--format is required\n");

		let event: AgentVoiceEvent;
		try {
			if (format === "text") {
				if (!agentOption) return result(2, "", "--agent is required\n");
				if (!isAgentName(agentOption)) {
					return result(2, "", `Unknown agent: ${agentOption}\n`);
				}
				const config = loadConfigForEnqueue(paths);
				event = createEvent({
					agent: agentOption,
					text: truncateInput(stdin, config.summarizer.maxInputChars),
					...(cwd ? { cwd } : {}),
					metadata: { format: "text" },
				});
			} else if (format === "event-json") {
				const parsed = parseJson(stdin);
				const validation = validateEvent(parsed);
				if (!validation.ok) return result(2, "", `${validation.reason}\n`);
				if (agentOption && validation.event.agent !== agentOption) {
					return result(
						2,
						"",
						`--agent ${agentOption} does not match event agent ${validation.event.agent}\n`,
					);
				}
				const config = loadConfigForEnqueue(paths);
				event = {
					...validation.event,
					text: truncateInput(
						validation.event.text,
						config.summarizer.maxInputChars,
					),
				};
			} else if (format === "claude-stop-hook") {
				if (agentOption !== "claude") {
					return result(
						2,
						"",
						"--format claude-stop-hook requires --agent claude\n",
					);
				}
				let payload: unknown;
				try {
					payload = parseJson(stdin);
				} catch {
					payload = {};
				}
				const extracted = extractClaudeStopHook(payload);
				const config = loadConfigForEnqueue(paths);
				event = createEvent({
					agent: "claude",
					text: truncateInput(extracted.text, config.summarizer.maxInputChars),
					...(cwd ? { cwd } : {}),
					metadata: { format: "claude-stop-hook", generic: extracted.generic },
				});
			} else {
				return result(2, "", `Unsupported enqueue format: ${format}\n`);
			}
		} catch (error) {
			return result(
				format === "claude-stop-hook" ? 0 : 2,
				"",
				`${error instanceof Error ? error.message : String(error)}\n`,
			);
		}

		try {
			enqueueEvent(paths, event);
			return result(0, "");
		} catch (error) {
			return result(
				0,
				"",
				`enqueue failed: ${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
	}

	return result(2, "", `agent-voice ${command} is not implemented yet\n`);
}
