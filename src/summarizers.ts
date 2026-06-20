import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentVoiceConfig, SummarizerName, SummarizerPromptStyle } from "./config";
import type { AgentVoiceEvent } from "./events";

export interface SummarizerRunRequest {
	cmd: string;
	args: string[];
	cwd?: string;
	env: Record<string, string>;
	stdin: string;
	timeoutMs: number;
}

export type SummarizerRunResult =
	| { ok: true; stdout: string; stderr?: string; exitCode?: number }
	| {
			ok: false;
			stdout?: string;
			stderr?: string;
			exitCode?: number;
			code?: string;
			timedOut?: boolean;
	  };

export type SummarizerRunner = (
	request: SummarizerRunRequest,
) => Promise<SummarizerRunResult>;

export interface SummarizeOptions {
	env?: Record<string, string | undefined>;
	cwd?: string;
	/**
	 * Called once for every LLM summarizer that fails (timeout, non-zero exit,
	 * spawn error) before the chain falls through to the next entry. Lets the
	 * daemon make the otherwise-silent degradation to the heuristic visible.
	 */
	onFallback?: (info: { name: SummarizerName; reason: string }) => void;
}

export interface SummarizeOutcome {
	summary: string;
	/** Which summarizer produced `summary`; "verbatim" means a crafted question/approval line spoken as-is. */
	summarizerUsed: SummarizerName | "verbatim";
}

const SENTENCE_BOUNDARY_PATTERN = /[.!?]+(\s+|$)/g;
const SENTENCE_END_PATTERN = /[.!?]$/;
const CONTROL_CHARS_PATTERN = /[\u0000-\u001f\u007f]+/g;
const MARKDOWN_NOISE_PATTERN = /[`*_>]+/g;
const WHITESPACE_PATTERN = /\s+/g;
const LINE_PREFIX_PATTERN = /^\s*(?:#{1,6}\s*|[-+*]\s+|\d+[.)]\s*)/;
// Terminal/ANSI escape sequences emitted by pi's `-p` TUI teardown (e.g. ESC[?2026h,
// ESC[<999u). Anchored on the ESC byte so legitimate bracketed text like "[important]"
// is never touched. Must run before CONTROL_CHARS_PATTERN strips the raw ESC byte.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\x1b(?:\[[0-9;?<>=]*[ -/]*[@-~]|[@-Z\\-_])/g;

const STYLE_FRAGMENTS: Record<SummarizerPromptStyle, string> = {
	default: "Summarize what the response conveys, plainly and neutrally.",
	terse:
		"Be as brief as possible: lead with the single most important outcome and drop everything non-essential.",
	"status-about":
		"First convey the state (done, blocked, waiting on the user, or still working), then what the output is about.",
	triage:
		"If the agent needs the user (a question, an approval, or a blocker), lead with exactly what you need from them. Otherwise state the result.",
	conversational:
		"Speak in the first person, as the assistant talking to the user, warm and direct, like a colleague leaning over their desk.",
	adaptive: `Choose the register that fits this response, in priority order:
1. The agent needs the user (a question, an approval, or a blocker) -> lead with exactly what you need from them.
2. There is a notable state -> say done / blocked / waiting / still working, then what it's about.
3. It's a simple result -> be terse: the outcome only.
Pick one and write only in that register.`,
};

export function buildPrompt(
	event: AgentVoiceEvent,
	config: AgentVoiceConfig,
): string {
	const { promptStyle, maxSentences, maxSummaryChars } = config.summarizer;
	const sentenceWord = maxSentences === 1 ? "sentence" : "sentences";
	return [
		"You write a spoken notification telling a developer who stepped away from their screen what the coding agent just did.",
		"It is read aloud by text-to-speech and heard once; they cannot re-read it.",
		`Use at most ${maxSentences} ${sentenceWord} and about ${maxSummaryChars} characters or fewer.`,
		"Lead with the outcome. Write for the ear: no markdown, emojis, or quotes.",
		'Never speak file paths, code identifiers, function names, or symbols; describe them plainly (say "the login handler", not "auth/login.ts"). State numbers approximately.',
		"Report the result directly, with no preamble.",
		STYLE_FRAGMENTS[promptStyle],
		"",
		`Agent: ${event.agent}`,
		"Response:",
		event.text,
	].join("\n");
}

function envWithoutUndefined(
	env: Record<string, string | undefined>,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) result[key] = value;
	}
	return result;
}

function summarizerCwd(options: SummarizeOptions): string | undefined {
	if (options.cwd) return options.cwd;
	const home = options.env?.AGENT_VOICE_HOME ?? process.env.AGENT_VOICE_HOME;
	if (!home) return undefined;
	const cwd = join(home, "run", "summarizer");
	mkdirSync(cwd, { recursive: true });
	return cwd;
}

function baseRequest(
	event: AgentVoiceEvent,
	config: AgentVoiceConfig,
	options: SummarizeOptions,
): Omit<SummarizerRunRequest, "cmd" | "args"> {
	return {
		cwd: summarizerCwd(options),
		env: {
			...envWithoutUndefined(options.env ?? process.env),
			AGENT_VOICE_DISABLE: "1",
		},
		stdin: buildPrompt(event, config),
		timeoutMs: config.summarizer.timeoutSeconds * 1000,
	};
}

function requestFor(
	name: Exclude<SummarizerName, "heuristic">,
	event: AgentVoiceEvent,
	config: AgentVoiceConfig,
	options: SummarizeOptions,
): SummarizerRunRequest | null {
	const base = baseRequest(event, config, options);

	if (name === "codex-fast") {
		return {
			...base,
			cmd: "codex",
			args: [
				"exec",
				"-m",
				config.summarizer.codexModel,
				"-c",
				"service_tier='\"fast\"'",
				"--skip-git-repo-check",
				"--ephemeral",
				"-",
			],
		};
	}

	if (name === "pi-fast") {
		// `-p`/`--print` is a boolean non-interactive flag; the prompt stays in
		// `base.stdin` (set by baseRequest) so agent text never reaches argv.
		return {
			...base,
			cmd: "pi",
			args: [
				"--model",
				config.summarizer.piModel,
				"--thinking",
				config.summarizer.thinking ?? "off",
				"--no-tools",
				"--no-skills",
				"--no-extensions",
				"--no-context-files",
				"--no-prompt-templates",
				"--no-session",
				"-p",
			],
		};
	}

	if (!config.summarizer.opencodeModel) return null;
	return {
		...base,
		cmd: "opencode",
		args: ["run", "--model", config.summarizer.opencodeModel, "--prompt", "-"],
	};
}

function cleanForSpeech(text: string): string {
	return text
		.replace(ANSI_ESCAPE_PATTERN, "")
		.split(/\r?\n/)
		.map((line) => line.replace(LINE_PREFIX_PATTERN, "").trim())
		.filter(Boolean)
		.join(" ")
		.replace(CONTROL_CHARS_PATTERN, " ")
		.replace(MARKDOWN_NOISE_PATTERN, "")
		.replace(WHITESPACE_PATTERN, " ")
		.trim();
}

function oneSentenceFromAllText(text: string, maxChars: number): string {
	const sentence = text.replace(
		SENTENCE_BOUNDARY_PATTERN,
		(match, _space: string, offset: number, fullText: string) => {
			const remaining = fullText.slice(offset + match.length).trim();
			return remaining ? "; " : ".";
		},
	);
	if (SENTENCE_END_PATTERN.test(sentence)) return sentence;
	return sentence.length < maxChars ? `${sentence}.` : sentence;
}

function truncateAtWord(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	if (maxChars <= 1) return text.slice(0, Math.max(0, maxChars));
	const limit = Math.max(1, maxChars - 1);
	const prefix = text.slice(0, limit).trimEnd();
	const lastSpace = prefix.lastIndexOf(" ");
	const truncated = lastSpace > 12 ? prefix.slice(0, lastSpace) : prefix;
	return `${truncated.replace(/[.!?;:,]+$/g, "")}.`.slice(0, maxChars);
}

function normalizeSummary(
	text: string,
	maxChars: number,
	maxSentences: number,
): string {
	const cleaned = cleanForSpeech(text);
	if (!cleaned) return "Agent finished responding.";
	const limited =
		maxSentences <= 1
			? oneSentenceFromAllText(cleaned, maxChars)
			: firstNSentences(cleaned, maxSentences);
	return truncateAtWord(limited, maxChars);
}

// Keep the first `count` sentences (a sentence ends at a run of .!? followed by
// whitespace or end of string). The lookahead keeps "1.5", "0.0.0.0", and
// "file.ts" from splitting mid-token. Falls back to appending a period when the
// text has no sentence terminator at all.
function firstNSentences(text: string, count: number): string {
	const pattern = /[.!?]+(?=\s|$)/g;
	let seen = 0;
	let end = -1;
	for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
		seen += 1;
		end = match.index + match[0].length;
		if (seen >= count) break;
	}
	if (end === -1) {
		return SENTENCE_END_PATTERN.test(text) ? text : `${text}.`;
	}
	return text.slice(0, end).trim();
}

// The fallback when no LLM summarizer succeeds. Speaks the agent's first
// `maxSentences` sentences. A bare call (no maxChars) is uncapped so a complete
// clause is never truncated mid-thought; the daemon path passes maxChars so the
// fallback still respects the user's length budget.
export function heuristicSummary(
	text: string,
	maxSentences = 1,
	maxChars?: number,
): string {
	const cleaned = cleanForSpeech(text);
	if (!cleaned) return "Agent finished responding.";
	const limited = firstNSentences(cleaned, maxSentences);
	return maxChars === undefined ? limited : truncateAtWord(limited, maxChars);
}

function describeFailure(
	result: Extract<SummarizerRunResult, { ok: false }>,
): string {
	if (result.timedOut) return "timed out";
	if (result.code) return result.code;
	if (typeof result.exitCode === "number") return `exit code ${result.exitCode}`;
	const stderr = result.stderr?.trim();
	return stderr ? stderr.split("\n")[0].slice(0, 120) : "unknown failure";
}

function heuristicOutcome(
	event: AgentVoiceEvent,
	config: AgentVoiceConfig,
): SummarizeOutcome {
	return {
		summary: heuristicSummary(
			event.text,
			config.summarizer.maxSentences,
			config.summarizer.maxSummaryChars,
		),
		summarizerUsed: "heuristic",
	};
}

// Runs the summarizer priority chain and reports which summarizer actually
// produced the result. Every LLM failure is surfaced via `options.onFallback`
// so the silent degradation to the heuristic is observable.
export async function summarizeWithSource(
	event: AgentVoiceEvent,
	config: AgentVoiceConfig,
	runner: SummarizerRunner = runSummarizerSubprocess,
	options: SummarizeOptions = {},
): Promise<SummarizeOutcome> {
	if (config.summarizer.speakQuestionsVerbatim && event.metadata?.kind === "question") {
		const spoken = cleanForSpeech(event.text);
		return {
			summary: spoken || "Agent is asking for your input.",
			summarizerUsed: "verbatim",
		};
	}
	for (const name of config.summarizer.priority) {
		if (name === "heuristic") return heuristicOutcome(event, config);

		const request = requestFor(name, event, config, options);
		if (!request) continue;

		try {
			const result = await runner(request);
			if (!result.ok) {
				options.onFallback?.({ name, reason: describeFailure(result) });
				continue;
			}
			const summary = normalizeSummary(
				result.stdout,
				config.summarizer.maxSummaryChars,
				config.summarizer.maxSentences,
			);
			if (summary) return { summary, summarizerUsed: name };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			options.onFallback?.({ name, reason: message || "unknown error" });
		}
	}

	return heuristicOutcome(event, config);
}

export async function summarize(
	event: AgentVoiceEvent,
	config: AgentVoiceConfig,
	runner: SummarizerRunner = runSummarizerSubprocess,
	options: SummarizeOptions = {},
): Promise<string> {
	const outcome = await summarizeWithSource(event, config, runner, options);
	return outcome.summary;
}

export async function runSummarizerSubprocess(
	request: SummarizerRunRequest,
): Promise<SummarizerRunResult> {
	let timedOut = false;
	const proc = Bun.spawn([request.cmd, ...request.args], {
		cwd: request.cwd,
		env: request.env,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	const timeout = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, request.timeoutMs);

	try {
		proc.stdin.write(request.stdin);
		proc.stdin.end();
		const [exitCode, stdout, stderr] = await Promise.all([
			proc.exited,
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		if (exitCode === 0 && !timedOut)
			return { ok: true, stdout, stderr, exitCode };
		return { ok: false, stdout, stderr, exitCode, timedOut };
	} catch (error) {
		const maybeCode =
			error && typeof error === "object" && "code" in error
				? String((error as { code: unknown }).code)
				: undefined;
		return { ok: false, stderr: String(error), code: maybeCode, timedOut };
	} finally {
		clearTimeout(timeout);
	}
}
