import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentVoiceConfig, SummarizerName } from "./config";
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
	/** Which summarizer actually produced `summary` (not merely the first in the priority list). */
	summarizerUsed: SummarizerName;
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

export function buildPrompt(event: AgentVoiceEvent): string {
	return [
		"Summarize this coding-agent response as exactly one short, natural, TTS-friendly sentence.",
		"Do not include markdown, bullets, quotes, emojis, file paths unless essential, or more than one sentence.",
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
		stdin: buildPrompt(event),
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

function normalizeSummary(text: string, maxChars: number): string {
	const cleaned = cleanForSpeech(text);
	if (!cleaned) return "Agent finished responding.";
	return truncateAtWord(oneSentenceFromAllText(cleaned, maxChars), maxChars);
}

// First sentence terminator: a run of .!? that is followed by whitespace or end
// of string. The lookahead keeps "1.5", "0.0.0.0", and "file.ts" from splitting
// mid-token, matching only real sentence ends.
const FIRST_SENTENCE_TERMINATOR = /[.!?]+(?=\s|$)/;

function firstSentence(cleaned: string): string {
	const match = FIRST_SENTENCE_TERMINATOR.exec(cleaned);
	if (!match) {
		return SENTENCE_END_PATTERN.test(cleaned) ? cleaned : `${cleaned}.`;
	}
	return cleaned.slice(0, match.index + match[0].length);
}

// The fallback when no LLM summarizer succeeds. Speaks the agent's entire first
// sentence verbatim (no character cap) — a complete, natural-sounding clause is
// better for TTS than a summary truncated mid-word.
export function heuristicSummary(text: string): string {
	const cleaned = cleanForSpeech(text);
	if (!cleaned) return "Agent finished responding.";
	return firstSentence(cleaned);
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

function heuristicOutcome(event: AgentVoiceEvent): SummarizeOutcome {
	return { summary: heuristicSummary(event.text), summarizerUsed: "heuristic" };
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
	for (const name of config.summarizer.priority) {
		if (name === "heuristic") return heuristicOutcome(event);

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
			);
			if (summary) return { summary, summarizerUsed: name };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			options.onFallback?.({ name, reason: message || "unknown error" });
		}
	}

	return heuristicOutcome(event);
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
