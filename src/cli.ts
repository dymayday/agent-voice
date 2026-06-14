import { isAgentName, loadConfig, saveConfig, setConfigValue } from "./config";
import { resolvePaths } from "./paths";

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

	return result(2, "", `agent-voice ${command} is not implemented yet\n`);
}
