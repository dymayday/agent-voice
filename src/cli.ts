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

export async function runCli(args: string[], _io: CliIo = {}): Promise<CliResult> {
  const [command] = args;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    return result(0, HELP);
  }

  return result(2, "", `agent-voice ${command} is not implemented yet\n`);
}
