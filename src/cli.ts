import { extractClaudeQuestion, extractClaudeStopHook } from "./adapters/claude";
import {
	clearDaemonLock,
	enterForegroundDaemon,
	formatDaemonStatus,
	getDaemonStatus,
	runDaemonLoop,
	runDaemonOnce,
	startDaemon,
	stopDaemon,
	type DaemonCliDeps,
} from "./daemon";
import {
	defaultConfig,
	isAgentName,
	loadConfig,
	saveConfig,
	setConfigValue,
} from "./config";
import { buildDoctorReport } from "./doctor";
import { createEvent, type AgentVoiceEvent, validateEvent } from "./events";
import {
	buildHistorySnapshot,
	decodeHistoryCursor,
	formatHistoryJson,
} from "./history";
import {
	installClaude,
	installPi,
	uninstallClaude,
	uninstallPi,
} from "./install";
import { resolvePaths } from "./paths";
import type { ProcessorDeps } from "./processor";
import { summarizeWithSource } from "./summarizers";
import { openDb } from "./db";
import { clearActiveQueue, enqueue } from "./store";
import { buildAppStatusSnapshot, formatAppStatusJson } from "./status";
import { isSummarizerMode, setSummarizerMode } from "./summarizer-mode";
import { KokoroClient, playWav } from "./tts";

export interface CliIo {
	stdout?: string;
	stderr?: string;
	stdin?: string;
	env?: Record<string, string | undefined>;
	daemonDeps?: DaemonCliDeps;
}

export interface CliResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

const HELP = `agent-voice - speak one-line summaries of coding-agent turns

Usage:
  agent-voice install [--agents claude,pi,codex,opencode] [--suspend-existing-stop-hooks]
  agent-voice uninstall [--agents claude,pi,codex,opencode] [--restore-suspended-hooks]
  agent-voice start
  agent-voice stop
  agent-voice status [--json]
  agent-voice history --json [--limit 50] [--before CURSOR]
  agent-voice queue clear
  agent-voice pause
  agent-voice resume
  agent-voice enqueue --format text --agent claude --cwd "$PWD"
  agent-voice enqueue --format event-json
  agent-voice enqueue --format claude-stop-hook --agent claude
  agent-voice enqueue --format claude-pretooluse-hook --agent claude
  agent-voice test "Claude finished editing the auth module."
  agent-voice enable claude
  agent-voice disable codex
  agent-voice config get
  agent-voice config set summarizer.timeoutSeconds 8
  agent-voice summarizer mode heuristic|default
  agent-voice doctor --json
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

function parseBoundedIntegerOption(
	raw: string | undefined,
	min: number,
	max: number,
): number | null {
	if (!raw || !/^\d+$/.test(raw)) return null;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < min || value > max) return null;
	return value;
}

function parseJson(input: string): unknown {
	return JSON.parse(input || "{}");
}

function parseAgentsOption(args: string[]): string[] {
	const value = getOption(args, "--agents") ?? "";
	return value
		.split(",")
		.map((agent) => agent.trim())
		.filter(Boolean);
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

function defaultProcessorDeps(
	config: ReturnType<typeof loadConfig>,
	paths: ReturnType<typeof resolvePaths>,
): ProcessorDeps {
	const kokoro = new KokoroClient(config);
	return {
		summarize: (event, summarizeConfig) =>
			summarizeWithSource(event, summarizeConfig, undefined, {
				onFallback: ({ name, reason }) =>
					console.error(
						`[agent-voice] summarizer "${name}" failed (${reason}); falling back`,
					),
			}),
		speak: async (summary, voice) => {
			const audio = await kokoro.speak(summary, voice);
			await playWav(audio, paths, undefined, {
				timeoutMs: config.tts.timeoutSeconds * 1000,
			});
		},
		prewarm: async () => {
			await kokoro.ensureReady();
		},
	};
}

function processorDepsFor(
	config: ReturnType<typeof loadConfig>,
	paths: ReturnType<typeof resolvePaths>,
	deps: DaemonCliDeps | undefined,
): ProcessorDeps {
	return deps?.processorDeps ?? defaultProcessorDeps(config, paths);
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

	if (command === "install" || command === "uninstall") {
		const agents = parseAgentsOption(args);
		if (agents.length !== 1 || !["pi", "claude"].includes(agents[0])) {
			return result(
				2,
				"",
				`${command} currently supports only pi and claude\n`,
			);
		}

		try {
			const env = io.env ?? process.env;
			let outcome;
			if (agents[0] === "pi") {
				outcome = command === "install" ? installPi(env) : uninstallPi(env);
			} else {
				outcome =
					command === "install"
						? installClaude(env, {
								suspendExistingStopHooks: args.includes(
									"--suspend-existing-stop-hooks",
								),
							})
						: uninstallClaude(env, {
								restoreSuspendedHooks: !args.includes("--keep-suspended-hooks"),
							});
			}
			return result(0, `${outcome.message}\n`);
		} catch (error) {
			return result(
				1,
				"",
				`${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
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

	if (command === "pause") {
		if (args.includes("--for") || args.includes("--until")) {
			return result(2, "", "Timed pause is not implemented yet\n");
		}
		const config = loadConfig(paths);
		saveConfig(paths, { ...config, enabled: false });
		return result(0, "paused\n");
	}

	if (command === "resume") {
		const config = loadConfig(paths);
		saveConfig(paths, { ...config, enabled: true });
		return result(0, "resumed\n");
	}

	if (command === "summarizer") {
		const [, subcommand, mode] = args;
		if (subcommand !== "mode" || !mode) {
			return result(
				2,
				"",
				"Usage: agent-voice summarizer mode heuristic|default\n",
			);
		}
		if (!isSummarizerMode(mode)) {
			return result(2, "", `Unknown summarizer mode: ${mode}\n`);
		}
		const config = loadConfig(paths);
		saveConfig(paths, setSummarizerMode(config, mode));
		return result(0, `summarizer mode=${mode}\n`);
	}

	if (command === "doctor") {
		if (!args.includes("--json")) {
			return result(2, "", "doctor currently requires --json\n");
		}
		return result(
			0,
			`${JSON.stringify(buildDoctorReport(paths, io.daemonDeps), null, 2)}\n`,
		);
	}

	if (command === "queue") {
		const [, subcommand] = args;
		if (subcommand !== "clear") {
			return result(2, "", "Usage: agent-voice queue clear\n");
		}
		const db = openDb(paths.db);
		try {
			const deleted = clearActiveQueue(db);
			return result(0, `Cleared ${deleted} queued job(s).\n`);
		} finally {
			db.close();
		}
	}

	if (command === "history") {
		if (!args.includes("--json")) {
			return result(2, "", "history currently requires --json\n");
		}
		const hasLimit = args.includes("--limit");
		const rawLimit = getOption(args, "--limit");
		const limit = hasLimit ? parseBoundedIntegerOption(rawLimit, 1, 200) : 50;
		if (limit === null) {
			return result(2, "", "--limit must be an integer between 1 and 200\n");
		}
		const rawBefore = getOption(args, "--before");
		const before = rawBefore ? decodeHistoryCursor(rawBefore) : undefined;
		if (rawBefore && !before) {
			return result(2, "", "--before must be a valid history cursor\n");
		}
		return result(
			0,
			formatHistoryJson(buildHistorySnapshot(paths, limit, before ?? undefined)),
		);
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
				const payloadRecord =
					payload && typeof payload === "object" && !Array.isArray(payload)
						? (payload as Record<string, unknown>)
						: {};
				const payloadCwd =
					typeof payloadRecord.cwd === "string" ? payloadRecord.cwd : undefined;
				const sessionId =
					typeof payloadRecord.session_id === "string"
						? payloadRecord.session_id
						: undefined;
				const config = loadConfigForEnqueue(paths);
				event = createEvent({
					agent: "claude",
					text: truncateInput(extracted.text, config.summarizer.maxInputChars),
					...(cwd || payloadCwd ? { cwd: cwd ?? payloadCwd } : {}),
					...(sessionId ? { sessionId } : {}),
					metadata: { format: "claude-stop-hook", generic: extracted.generic },
				});
			} else if (format === "claude-pretooluse-hook") {
				if (agentOption !== "claude") {
					return result(
						2,
						"",
						"--format claude-pretooluse-hook requires --agent claude\n",
					);
				}
				let payload: unknown;
				try {
					payload = parseJson(stdin);
				} catch {
					payload = {};
				}
				const question = extractClaudeQuestion(payload);
				// Only AskUserQuestion tool calls carry a question worth speaking.
				// Any other PreToolUse payload (or a malformed one) stays silent.
				if (!question) return result(0, "");
				const payloadRecord =
					payload && typeof payload === "object" && !Array.isArray(payload)
						? (payload as Record<string, unknown>)
						: {};
				const payloadCwd =
					typeof payloadRecord.cwd === "string" ? payloadRecord.cwd : undefined;
				const sessionId =
					typeof payloadRecord.session_id === "string"
						? payloadRecord.session_id
						: undefined;
				const config = loadConfigForEnqueue(paths);
				event = createEvent({
					agent: "claude",
					text: truncateInput(question.text, config.summarizer.maxInputChars),
					...(cwd || payloadCwd ? { cwd: cwd ?? payloadCwd } : {}),
					...(sessionId ? { sessionId } : {}),
					metadata: { format: "claude-pretooluse-hook", kind: "question" },
				});
			} else {
				return result(2, "", `Unsupported enqueue format: ${format}\n`);
			}
		} catch (error) {
			return result(
				format === "claude-stop-hook" || format === "claude-pretooluse-hook"
					? 0
					: 2,
				"",
				`${error instanceof Error ? error.message : String(error)}\n`,
			);
		}

		try {
			const db = openDb(paths.db);
			try {
				enqueue(db, event);
			} finally {
				db.close();
			}
			return result(0, "");
		} catch (error) {
			return result(
				0,
				"",
				`enqueue failed: ${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
	}

	if (command === "status") {
		if (args.includes("--json")) {
			return result(
				0,
				formatAppStatusJson(buildAppStatusSnapshot(paths, io.daemonDeps)),
			);
		}
		return result(0, formatDaemonStatus(getDaemonStatus(paths, io.daemonDeps)));
	}

	if (command === "start") {
		try {
			const started = await startDaemon(paths, io.daemonDeps);
			if (!started.ok) return result(1, "", `${started.reason}\n`);
			return result(0, `started pid=${started.pid}\n`);
		} catch (error) {
			return result(
				1,
				"",
				`${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
	}

	if (command === "stop") {
		try {
			const stopped = await stopDaemon(paths, io.daemonDeps);
			return result(
				0,
				stopped.stopped ? `stopped pid=${stopped.pid}\n` : "not running\n",
			);
		} catch (error) {
			return result(
				1,
				"",
				`${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
	}

	if (command === "daemon") {
		if (!args.includes("--foreground")) {
			return result(2, "", "daemon requires --foreground\n");
		}
		const config = loadConfig(paths);
		const deps = {
			...(io.daemonDeps ?? {}),
			processorDeps: processorDepsFor(config, paths, io.daemonDeps),
		};
		try {
			const started = enterForegroundDaemon(paths, deps);
			if (!started.ok) return result(1, "", `${started.reason}\n`);
			try {
				if (args.includes("--once")) {
					const processed = await runDaemonOnce(paths, config, deps);
					return result(0, `${processed.kind}\n`);
				}
				const loop = await runDaemonLoop(paths, config, deps);
				return result(
					0,
					`processed=${loop.processed} idle=${loop.idle} retry_scheduled=${loop.retryScheduled} failed=${loop.failed}\n`,
				);
			} finally {
				clearDaemonLock(paths);
			}
		} catch (error) {
			return result(
				1,
				"",
				`${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
	}

	if (command === "test") {
		const config = loadConfig(paths);
		const text = args.slice(1).join(" ") || io.stdin || "Agent voice test.";
		const event = createEvent({
			agent: "claude",
			text,
			metadata: { format: "test" },
		});
		const deps = processorDepsFor(config, paths, io.daemonDeps);
		try {
			const outcome = await deps.summarize(event, config);
			const summary = typeof outcome === "string" ? outcome : outcome.summary;
			await deps.speak(summary, config.tts.voice, event);
			return result(0, `${summary}\n`);
		} catch (error) {
			return result(
				1,
				"",
				`${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
	}

	return result(2, "", `agent-voice ${command} is not implemented yet\n`);
}
