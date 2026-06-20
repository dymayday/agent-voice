import {
	extractClaudeQuestion,
	extractClaudeStopHook,
} from "./adapters/claude";
import { extractCodexPermission, extractCodexStop } from "./adapters/codex";
import {
	clearDaemonLock,
	clearStatusSnapshot,
	enterForegroundDaemon,
	formatDaemonStatus,
	getDaemonStatus,
	notifyDaemon,
	runDaemonLoop,
	runDaemonOnce,
	startDaemon,
	stopDaemon,
	type DaemonCliDeps,
} from "./daemon";
import { createSignalWorkWaiter } from "./daemon-wait";
import {
	defaultConfig,
	isAgentName,
	loadConfig,
	saveConfig,
	setConfigValue,
} from "./config";
import { buildDoctorReport } from "./doctor";
import {
	buildKokoroStatus,
	runKokoroSetup,
	type KokoroSetupDeps,
	type KokoroSetupEvent,
} from "./kokoro-setup";
import { createEvent, type AgentVoiceEvent, validateEvent } from "./events";
import {
	buildHistorySnapshot,
	decodeHistoryCursor,
	formatHistoryJson,
} from "./history";
import {
	installClaude,
	installCodex,
	installOpencode,
	installPi,
	uninstallClaude,
	uninstallCodex,
	uninstallOpencode,
	uninstallPi,
} from "./install";
import { resolvePaths } from "./paths";
import type { ProcessorDeps } from "./processor";
import { buildPrompt, summarizeWithSource } from "./summarizers";
import { openDb } from "./db";
import { clearActiveQueue, clearFailedJobs, enqueue } from "./store";
import { buildAppStatusSnapshot, formatAppStatusJson } from "./status";
import { isSummarizerMode, setSummarizerMode } from "./summarizer-mode";
import { KokoroClient, playWav } from "./tts";

export interface CliIo {
	stdout?: string;
	stderr?: string;
	stdin?: string;
	env?: Record<string, string | undefined>;
	daemonDeps?: DaemonCliDeps;
	kokoroSetupDeps?: KokoroSetupDeps;
	writeStdout?: (chunk: string) => void | Promise<void>;
}

export interface CliResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

const HELP = `agent-voice - speak one-line summaries of coding-agent turns

Usage:
  agent-voice install --agents pi|claude|codex|opencode [--suspend-existing-stop-hooks]
  agent-voice uninstall --agents pi|claude|codex|opencode [--keep-suspended-hooks]
  agent-voice start
  agent-voice stop
  agent-voice status [--json]
  agent-voice history --json [--limit 50] [--before CURSOR]
  agent-voice queue clear
  agent-voice queue clear --failed
  agent-voice pause
  agent-voice resume
  agent-voice enqueue --format text --agent claude --cwd "$PWD"
  agent-voice enqueue --format event-json
  agent-voice enqueue --format claude-stop-hook --agent claude
  agent-voice enqueue --format claude-pretooluse-hook --agent claude
  agent-voice enqueue --format codex-stop-hook --agent codex
  agent-voice enqueue --format codex-permission-hook --agent codex
  agent-voice test "Claude finished editing the auth module."
  agent-voice enable claude
  agent-voice disable codex
  agent-voice config get
  agent-voice config set summarizer.timeoutSeconds 8
  agent-voice models list
  agent-voice summarizer mode heuristic|default
  agent-voice kokoro setup [--jsonl]
  agent-voice kokoro status --json
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

function availableSummarizerModels(config: ReturnType<typeof loadConfig>) {
	const providers: Record<string, string[]> = {
		"pi-fast": [config.summarizer.piModel, defaultConfig.summarizer.piModel],
		"codex-fast": [
			config.summarizer.codexModel,
			defaultConfig.summarizer.codexModel,
		],
	};

	if (config.summarizer.opencodeModel) {
		providers.opencode = [config.summarizer.opencodeModel];
	}

	for (const [name, values] of Object.entries(providers)) {
		providers[name] = Array.from(new Set(values.filter(Boolean) as string[]));
	}

	const models = Array.from(new Set(Object.values(providers).flat())).sort(
		(a, b) => a.localeCompare(b),
	);

	return {
		providers,
		models,
	};
}

function parseJson(input: string): unknown {
	return JSON.parse(input || "{}");
}

interface ClaudeHookPayloadContext {
	payload: unknown;
	payloadCwd?: string;
	sessionId?: string;
}

function parseHookPayload(
	input: string,
	format: string,
): ClaudeHookPayloadContext | CliResult {
	let payload: unknown;
	try {
		payload = parseJson(input);
	} catch (error) {
		return result(
			0,
			"",
			`Malformed ${format} JSON: ${error instanceof Error ? error.message : String(error)}\n`,
		);
	}
	const payloadRecord =
		payload && typeof payload === "object" && !Array.isArray(payload)
			? (payload as Record<string, unknown>)
			: {};
	return {
		payload,
		payloadCwd:
			typeof payloadRecord.cwd === "string" ? payloadRecord.cwd : undefined,
		sessionId:
			typeof payloadRecord.session_id === "string"
				? payloadRecord.session_id
				: undefined,
	};
}

function isCliResult(value: unknown): value is CliResult {
	return (
		value !== null &&
		typeof value === "object" &&
		"exitCode" in value &&
		"stdout" in value &&
		"stderr" in value
	);
}

function createClaudeHookEvent(options: {
	text: string;
	cwd?: string;
	payloadCwd?: string;
	sessionId?: string;
	metadata: Record<string, unknown>;
	maxInputChars: number;
}): AgentVoiceEvent {
	return createEvent({
		agent: "claude",
		text: truncateInput(options.text, options.maxInputChars),
		...(options.cwd || options.payloadCwd
			? { cwd: options.cwd ?? options.payloadCwd }
			: {}),
		...(options.sessionId ? { sessionId: options.sessionId } : {}),
		metadata: options.metadata,
	});
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

function defaultProcessorDepsFactory(
	paths: ReturnType<typeof resolvePaths>,
): (config: ReturnType<typeof loadConfig>) => ProcessorDeps {
	let cachedKey: string | null = null;
	let cachedDeps: ProcessorDeps | null = null;
	return (config) => {
		const key = JSON.stringify(config.tts);
		if (!cachedDeps || cachedKey !== key) {
			cachedKey = key;
			cachedDeps = defaultProcessorDeps(config, paths);
		}
		return cachedDeps;
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
	const paths = resolvePaths(io.env ?? process.env);

	// voice-codex / voice-opencode bins are thin aliases for enqueuing raw text
	// under the matching agent. The primary hook paths call `enqueue` directly,
	// so these stay convenience entrypoints rather than the install target.
	if (args[0] === "voice-codex" || args[0] === "voice-opencode") {
		const aliasAgent = args[0] === "voice-codex" ? "codex" : "opencode";
		args = ["enqueue", "--format", "text", "--agent", aliasAgent, ...args.slice(1)];
	}

	const [command] = args;

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
		if (
			agents.length !== 1 ||
			!["pi", "claude", "codex", "opencode"].includes(agents[0])
		) {
			return result(
				2,
				"",
				`${command} supports one of: pi, claude, codex, opencode\n`,
			);
		}

		try {
			const env = io.env ?? process.env;
			const agent = agents[0];
			let outcome;
			if (agent === "pi") {
				outcome = command === "install" ? installPi(env) : uninstallPi(env);
			} else if (agent === "codex") {
				outcome =
					command === "install" ? installCodex(env) : uninstallCodex(env);
			} else if (agent === "opencode") {
				outcome =
					command === "install" ? installOpencode(env) : uninstallOpencode(env);
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
				// Wake the daemon so a config change affects spoken output now
				// instead of after the idle safety-net cap (B8).
				notifyDaemon(paths, io.daemonDeps);
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
		notifyDaemon(paths, io.daemonDeps);
		return result(0, "");
	}

	if (command === "pause") {
		if (args.includes("--for") || args.includes("--until")) {
			return result(2, "", "Timed pause is not implemented yet\n");
		}
		return result(2, "", "Pause/resume is not implemented yet\n");
	}

	if (command === "resume") {
		return result(2, "", "Pause/resume is not implemented yet\n");
	}

	if (command === "summarizer") {
		const [, subcommand] = args;

		if (subcommand === "prompt") {
			try {
				let config = loadConfig(paths);
				const flag = (name: string): string | undefined => {
					const i = args.indexOf(name);
					return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
				};
				const style = flag("--style");
				const maxSentences = flag("--max-sentences");
				const maxChars = flag("--max-chars");
				if (style !== undefined)
					config = setConfigValue(config, "summarizer.promptStyle", style);
				if (maxSentences !== undefined)
					config = setConfigValue(config, "summarizer.maxSentences", maxSentences);
				if (maxChars !== undefined)
					config = setConfigValue(config, "summarizer.maxSummaryChars", maxChars);
				const event = createEvent({
					agent: "claude",
					text: "[the agent's last message]",
				});
				return result(0, `${buildPrompt(event, config)}\n`);
			} catch (error) {
				return result(
					2,
					"",
					`${error instanceof Error ? error.message : String(error)}\n`,
				);
			}
		}

		const mode = args[2];
		if (subcommand !== "mode" || !mode) {
			return result(
				2,
				"",
				"Usage: agent-voice summarizer mode heuristic|default | agent-voice summarizer prompt [--style S --max-sentences N --max-chars M]\n",
			);
		}
		if (!isSummarizerMode(mode)) {
			return result(2, "", `Unknown summarizer mode: ${mode}\n`);
		}
		const config = loadConfig(paths);
		saveConfig(paths, setSummarizerMode(config, mode));
		notifyDaemon(paths, io.daemonDeps);
		return result(0, `summarizer mode=${mode}\n`);
	}

	if (command === "models") {
		const [, subcommand] = args;
		if (subcommand !== "list") {
			return result(2, "", "Usage: agent-voice models list\n");
		}
		const config = loadConfig(paths);
		const payload = availableSummarizerModels(config);
		return result(0, `${JSON.stringify(payload, null, 2)}\n`);
	}

	if (command === "kokoro") {
		const [, subcommand] = args;

		if (subcommand === "status") {
			if (!args.includes("--json")) {
				return result(2, "", "Usage: agent-voice kokoro status --json\n");
			}
			return result(
				0,
				`${JSON.stringify(buildKokoroStatus(paths), null, 2)}\n`,
			);
		}

		if (subcommand === "setup") {
			const jsonl = args.includes("--jsonl");
			const events: KokoroSetupEvent[] = [];
			let streamWriteChain = Promise.resolve();
			const emit = jsonl
				? (event: KokoroSetupEvent) => {
						const line = `${JSON.stringify(event)}\n`;
						if (io.writeStdout) {
							streamWriteChain = streamWriteChain.then(() =>
								io.writeStdout?.(line),
							);
						} else {
							events.push(event);
						}
					}
				: undefined;
			const outcome = await runKokoroSetup(paths, {
				deps: io.kokoroSetupDeps,
				...(emit ? { emit } : {}),
			});
			await streamWriteChain;

			// A successful setup writes the Kokoro python/script path into config;
			// wake the daemon so it reloads and can speak immediately (B8).
			if (outcome.ok) notifyDaemon(paths, io.daemonDeps);

			if (jsonl) {
				return result(
					outcome.ok ? 0 : 1,
					io.writeStdout
						? ""
						: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
				);
			}

			return outcome.ok
				? result(0, `Kokoro installed: ${outcome.scriptPath}\n`)
				: result(1, "", `${outcome.error ?? "Kokoro setup failed"}\n`);
		}

		return result(
			2,
			"",
			"Usage: agent-voice kokoro setup [--jsonl] | kokoro status --json\n",
		);
	}

	if (command === "doctor") {
		if (!args.includes("--json")) {
			return result(2, "", "doctor currently requires --json\n");
		}
		return result(
			0,
			`${JSON.stringify(buildDoctorReport(paths, io.daemonDeps, io.env ?? process.env), null, 2)}\n`,
		);
	}

	if (command === "queue") {
		const [, subcommand] = args;
		if (subcommand !== "clear") {
			return result(2, "", "Usage: agent-voice queue clear [--failed]\n");
		}
		const includeFailed = args.includes("--failed");
		const db = openDb(paths.db);
		try {
			const deleted = includeFailed
				? clearFailedJobs(db)
				: clearActiveQueue(db);
			if (includeFailed) {
				return result(
					0,
					`Cleared ${deleted} failed job${deleted === 1 ? "" : "s"}.\n`,
				);
			}
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
			formatHistoryJson(
				buildHistorySnapshot(paths, limit, before ?? undefined),
			),
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
				const hookPayload = parseHookPayload(stdin, format);
				if (isCliResult(hookPayload)) return hookPayload;
				const extracted = extractClaudeStopHook(hookPayload.payload);
				const config = loadConfigForEnqueue(paths);
				event = createClaudeHookEvent({
					text: extracted.text,
					cwd,
					payloadCwd: hookPayload.payloadCwd,
					sessionId: hookPayload.sessionId,
					metadata: { format: "claude-stop-hook", generic: extracted.generic },
					maxInputChars: config.summarizer.maxInputChars,
				});
			} else if (format === "claude-pretooluse-hook") {
				if (agentOption !== "claude") {
					return result(
						2,
						"",
						"--format claude-pretooluse-hook requires --agent claude\n",
					);
				}
				const hookPayload = parseHookPayload(stdin, format);
				if (isCliResult(hookPayload)) return hookPayload;
				const question = extractClaudeQuestion(hookPayload.payload);
				// Only AskUserQuestion tool calls carry a question worth speaking.
				// Any other PreToolUse payload stays silent.
				if (!question) return result(0, "");
				const config = loadConfigForEnqueue(paths);
				event = createClaudeHookEvent({
					text: question.text,
					cwd,
					payloadCwd: hookPayload.payloadCwd,
					sessionId: hookPayload.sessionId,
					metadata: { format: "claude-pretooluse-hook", kind: "question" },
					maxInputChars: config.summarizer.maxInputChars,
				});
			} else if (format === "codex-stop-hook") {
				if (agentOption !== "codex") {
					return result(
						2,
						"",
						"--format codex-stop-hook requires --agent codex\n",
					);
				}
				const hookPayload = parseHookPayload(stdin, format);
				if (isCliResult(hookPayload)) return hookPayload;
				const extracted = extractCodexStop(hookPayload.payload);
				const config = loadConfigForEnqueue(paths);
				event = createEvent({
					agent: "codex",
					text: truncateInput(extracted.text, config.summarizer.maxInputChars),
					...(cwd || hookPayload.payloadCwd
						? { cwd: cwd ?? hookPayload.payloadCwd }
						: {}),
					...(hookPayload.sessionId
						? { sessionId: hookPayload.sessionId }
						: {}),
					metadata: { format: "codex-stop-hook", generic: extracted.generic },
				});
			} else if (format === "codex-permission-hook") {
				if (agentOption !== "codex") {
					return result(
						2,
						"",
						"--format codex-permission-hook requires --agent codex\n",
					);
				}
				const hookPayload = parseHookPayload(stdin, format);
				if (isCliResult(hookPayload)) return hookPayload;
				const permission = extractCodexPermission(hookPayload.payload);
				// Only a real approval request carries a tool worth speaking.
				if (!permission) return result(0, "");
				const config = loadConfigForEnqueue(paths);
				event = createEvent({
					agent: "codex",
					text: truncateInput(permission.text, config.summarizer.maxInputChars),
					...(cwd || hookPayload.payloadCwd
						? { cwd: cwd ?? hookPayload.payloadCwd }
						: {}),
					...(hookPayload.sessionId
						? { sessionId: hookPayload.sessionId }
						: {}),
					metadata: { format: "codex-permission-hook", kind: "question" },
				});
			} else {
				return result(2, "", `Unsupported enqueue format: ${format}\n`);
			}
		} catch (error) {
			return result(
				format === "claude-stop-hook" ||
					format === "claude-pretooluse-hook" ||
					format === "codex-stop-hook" ||
					format === "codex-permission-hook"
					? 0
					: 2,
				"",
				`${error instanceof Error ? error.message : String(error)}\n`,
			);
		}

		try {
			const db = openDb(paths.db);
			let inserted: boolean;
			try {
				inserted = enqueue(db, event).inserted;
			} finally {
				db.close();
			}
			// Wake the daemon only on a real insert; a duplicate (inserted=false)
			// added nothing to process. Best-effort: never disturbs the exit 0.
			if (inserted) notifyDaemon(paths, io.daemonDeps);
			return result(0, "");
		} catch (error) {
			return result(
				1,
				"",
				`enqueue failed: ${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
	}

	if (command === "status") {
		if (args.includes("--json")) {
			return result(
				0,
				formatAppStatusJson(
					buildAppStatusSnapshot(paths, io.daemonDeps, io.env ?? process.env),
				),
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
		const defaultDepsForConfig = defaultProcessorDepsFactory(paths);
		// Install the SIGUSR1 wakeup handler BEFORE enterForegroundDaemon writes
		// the PID lock: enqueue discovers the PID only via that lock, so
		// installing first closes the startup window where a SIGUSR1 (default
		// disposition = terminate) could kill the just-spawned daemon. We do NOT
		// install SIGTERM/SIGINT handlers — their default-terminate disposition
		// preserves today's stop semantics (see B7). Tests inject their own
		// waitForWork; only create a real waiter when one is not given.
		const waiter =
			io.daemonDeps?.waitForWork === undefined
				? createSignalWorkWaiter()
				: null;
		waiter?.install();
		const deps: DaemonCliDeps = {
			...(io.daemonDeps ?? {}),
			processorDeps: processorDepsFor(config, paths, io.daemonDeps),
			processorDepsForConfig:
				io.daemonDeps?.processorDepsForConfig ??
				((nextConfig: ReturnType<typeof loadConfig>) =>
					io.daemonDeps?.processorDeps ?? defaultDepsForConfig(nextConfig)),
			// The waiter's wait() is woken by the SIGUSR1 handler the same object
			// installed, so an enqueue/config poke wakes the in-flight wait.
			...(waiter ? { waitForWork: (ms: number) => waiter.wait(ms) } : {}),
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
				// Belt-and-suspenders for the paths where the loop actually returns
				// (--once, bounded test mode, intentional-stop). A production daemon
				// is usually SIGTERM'd mid-wait and never reaches here, so the
				// authoritative clear lives in stopDaemon; this covers the rest.
				clearStatusSnapshot(paths);
			}
		} catch (error) {
			return result(
				1,
				"",
				`${error instanceof Error ? error.message : String(error)}\n`,
			);
		} finally {
			// Named-handler removeListener (idempotent) so in-process daemon-command
			// tests don't accumulate SIGUSR1 listeners across `bun test`.
			waiter?.uninstall();
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
