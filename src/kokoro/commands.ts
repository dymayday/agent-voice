export const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export interface KokoroCommandDeps {
	run(request: {
		cmd: string;
		args: string[];
		cwd?: string;
		env?: Record<string, string>;
		timeoutMs?: number;
	}): Promise<{
		ok: boolean;
		stdout?: string;
		stderr?: string;
		exitCode?: number;
	}>;
}

export type KokoroLogEmitter = (event: {
	type: "log";
	stream: "stdout" | "stderr";
	message: string;
}) => void;

export function emitLogs(
	emit: KokoroLogEmitter,
	stream: "stdout" | "stderr",
	text: string | undefined,
): void {
	if (!text) return;
	for (const line of text.split(/\r?\n/)) {
		if (line.length > 0) emit({ type: "log", stream, message: line });
	}
}

function commandDescription(cmd: string, args: string[]): string {
	return [cmd, ...args].join(" ");
}

export async function runChecked(
	deps: KokoroCommandDeps,
	emit: KokoroLogEmitter,
	request: Parameters<KokoroCommandDeps["run"]>[0],
): Promise<void> {
	const outcome = await deps.run(request);
	emitLogs(emit, "stdout", outcome.stdout);
	emitLogs(emit, "stderr", outcome.stderr);
	if (!outcome.ok) {
		const details = (outcome.stderr || outcome.stdout || "").trim();
		throw new Error(
			`${commandDescription(request.cmd, request.args)} failed${
				details ? `: ${details}` : ""
			}`,
		);
	}
}
