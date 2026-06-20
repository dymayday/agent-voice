import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentVoicePaths } from "./paths";

export type AgentName = "claude" | "codex" | "pi" | "opencode";
export type SummarizerName =
	| "codex-fast"
	| "pi-fast"
	| "opencode"
	| "heuristic";
export type SummarizerThinking =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";

export type SummarizerPromptStyle =
	| "default"
	| "terse"
	| "status-about"
	| "triage"
	| "conversational";

export interface AgentVoiceConfig {
	enabled: boolean;
	agents: Record<AgentName, { enabled: boolean; mode: string }>;
	speakPolicy: "every_turn";
	ignoreCwdPatterns: string[];
	summarizer: {
		priority: SummarizerName[];
		codexModel: string;
		piModel: string;
		opencodeModel: string | null;
		thinking: SummarizerThinking;
		timeoutSeconds: number;
		maxInputChars: number;
		maxSummaryChars: number;
		promptStyle: SummarizerPromptStyle;
		maxSentences: number;
		speakQuestionsVerbatim: boolean;
	};
	tts: {
		kokoroScript: string;
		python: string;
		voice: string;
		timeoutSeconds: number;
	};
	spool: {
		processingTimeoutSeconds: number;
		retentionDays: number;
		maxEventBytes: number;
		maxAttempts: number;
		retryBackoffSeconds: number;
	};
}

export const AGENT_NAMES: AgentName[] = ["claude", "codex", "pi", "opencode"];

export const defaultConfig: AgentVoiceConfig = {
	enabled: true,
	agents: {
		claude: { enabled: true, mode: "native" },
		codex: { enabled: true, mode: "native" },
		pi: { enabled: true, mode: "native" },
		opencode: { enabled: true, mode: "native" },
	},
	speakPolicy: "every_turn",
	ignoreCwdPatterns: [],
	summarizer: {
		priority: ["pi-fast", "codex-fast", "heuristic"],
		codexModel: "gpt-5.3-codex",
		piModel: "openai-codex/gpt-5.5",
		opencodeModel: null,
		thinking: "off",
		// pi's summarizer latency is highly variable (measured 5–12.5s on small
		// inputs, with cold-start outliers far higher). A tight timeout silently
		// dropped to the heuristic; 33s keeps near-all real summaries.
		timeoutSeconds: 33,
		maxInputChars: 12000,
		maxSummaryChars: 180,
		promptStyle: "default",
		maxSentences: 1,
		speakQuestionsVerbatim: true,
	},
	tts: {
		kokoroScript: "",
		python: "python3",
		voice: "af_heart",
		timeoutSeconds: 30,
	},
	spool: {
		processingTimeoutSeconds: 120,
		retentionDays: 7,
		maxEventBytes: 262144,
		maxAttempts: 3,
		retryBackoffSeconds: 30,
	},
};

const PROMPT_STYLE_NAMES: SummarizerPromptStyle[] = [
	"default",
	"terse",
	"status-about",
	"triage",
	"conversational",
];

const SUMMARIZER_NAMES: SummarizerName[] = [
	"codex-fast",
	"pi-fast",
	"opencode",
	"heuristic",
];
const SUMMARIZER_THINKING_VALUES: SummarizerThinking[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
];

function cloneConfig(config: AgentVoiceConfig): AgentVoiceConfig {
	return JSON.parse(JSON.stringify(config)) as AgentVoiceConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidConfig(path: string, expected: string): never {
	throw new Error(`Invalid config ${path}: expected ${expected}`);
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
	if (typeof value !== "boolean") invalidConfig(path, "boolean");
}

function assertString(
	value: unknown,
	path: string,
	options: { allowEmpty?: boolean } = {},
): asserts value is string {
	if (typeof value !== "string") invalidConfig(path, "string");
	if (!options.allowEmpty && value.trim().length === 0) {
		invalidConfig(path, "non-empty string");
	}
}

function assertIntegerInRange(
	value: unknown,
	path: string,
	{ min, max }: { min: number; max?: number },
): asserts value is number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < min ||
		(max !== undefined && value > max)
	) {
		invalidConfig(
			path,
			max === undefined
				? `integer >= ${min}`
				: `integer between ${min} and ${max}`,
		);
	}
}

function assertOneOf<T extends string>(
	value: unknown,
	path: string,
	allowed: readonly T[],
): asserts value is T {
	if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
		invalidConfig(path, `one of ${allowed.join(", ")}`);
	}
}

export function validateConfig(config: AgentVoiceConfig): AgentVoiceConfig {
	assertBoolean(config.enabled, "enabled");
	if (!isRecord(config.agents)) invalidConfig("agents", "object");
	for (const name of AGENT_NAMES) {
		const agent = config.agents[name];
		if (!isRecord(agent)) invalidConfig(`agents.${name}`, "object");
		assertBoolean(agent.enabled, `agents.${name}.enabled`);
		assertString(agent.mode, `agents.${name}.mode`);
	}
	assertOneOf(config.speakPolicy, "speakPolicy", ["every_turn"]);
	if (
		!Array.isArray(config.ignoreCwdPatterns) ||
		!config.ignoreCwdPatterns.every((pattern) => typeof pattern === "string")
	) {
		invalidConfig("ignoreCwdPatterns", "array of strings");
	}

	if (!isRecord(config.summarizer)) invalidConfig("summarizer", "object");
	if (
		!Array.isArray(config.summarizer.priority) ||
		config.summarizer.priority.length === 0
	) {
		invalidConfig("summarizer.priority", "non-empty array");
	}
	for (const [index, name] of config.summarizer.priority.entries()) {
		assertOneOf(name, `summarizer.priority.${index}`, SUMMARIZER_NAMES);
	}
	const activeSummarizers = new Set(config.summarizer.priority);
	assertString(config.summarizer.codexModel, "summarizer.codexModel", {
		allowEmpty: !activeSummarizers.has("codex-fast"),
	});
	assertString(config.summarizer.piModel, "summarizer.piModel", {
		allowEmpty: !activeSummarizers.has("pi-fast"),
	});
	if (config.summarizer.opencodeModel === null) {
		if (activeSummarizers.has("opencode")) {
			invalidConfig("summarizer.opencodeModel", "non-empty string");
		}
	} else {
		assertString(config.summarizer.opencodeModel, "summarizer.opencodeModel", {
			allowEmpty: !activeSummarizers.has("opencode"),
		});
	}
	assertOneOf(
		config.summarizer.thinking,
		"summarizer.thinking",
		SUMMARIZER_THINKING_VALUES,
	);
	assertIntegerInRange(config.summarizer.timeoutSeconds, "summarizer.timeoutSeconds", { min: 1 });
	assertIntegerInRange(config.summarizer.maxInputChars, "summarizer.maxInputChars", { min: 1 });
	assertIntegerInRange(config.summarizer.maxSummaryChars, "summarizer.maxSummaryChars", { min: 1 });
	assertOneOf(
		config.summarizer.promptStyle,
		"summarizer.promptStyle",
		PROMPT_STYLE_NAMES,
	);
	assertIntegerInRange(config.summarizer.maxSentences, "summarizer.maxSentences", {
		min: 1,
	});
	assertBoolean(
		config.summarizer.speakQuestionsVerbatim,
		"summarizer.speakQuestionsVerbatim",
	);

	if (!isRecord(config.tts)) invalidConfig("tts", "object");
	assertString(config.tts.kokoroScript, "tts.kokoroScript", { allowEmpty: true });
	assertString(config.tts.python, "tts.python");
	assertString(config.tts.voice, "tts.voice");
	assertIntegerInRange(config.tts.timeoutSeconds, "tts.timeoutSeconds", { min: 1 });

	if (!isRecord(config.spool)) invalidConfig("spool", "object");
	assertIntegerInRange(config.spool.processingTimeoutSeconds, "spool.processingTimeoutSeconds", { min: 1 });
	assertIntegerInRange(config.spool.retentionDays, "spool.retentionDays", { min: 0 });
	assertIntegerInRange(config.spool.maxEventBytes, "spool.maxEventBytes", { min: 1 });
	assertIntegerInRange(config.spool.maxAttempts, "spool.maxAttempts", { min: 1 });
	assertIntegerInRange(config.spool.retryBackoffSeconds, "spool.retryBackoffSeconds", { min: 0 });

	return config;
}

function mergeRecord<T extends Record<string, unknown>>(
	target: T,
	source: unknown,
): T {
	if (source === undefined) return target;
	if (!isRecord(source)) invalidConfig("config", "object");
	for (const [key, value] of Object.entries(source)) {
		const current = target[key];
		if (isRecord(current) && isRecord(value) && !Array.isArray(current)) {
			mergeRecord(current, value);
		} else {
			target[key as keyof T] = value as T[keyof T];
		}
	}
	return target;
}

function normalizeConfig(raw: unknown): AgentVoiceConfig {
	if (!isRecord(raw)) invalidConfig("config", "object");
	const merged = mergeRecord(
		cloneConfig(defaultConfig) as unknown as Record<string, unknown>,
		raw,
	) as unknown as AgentVoiceConfig;
	return validateConfig(merged);
}

function ensureConfigDir(paths: AgentVoicePaths): void {
	mkdirSync(dirname(paths.config), { recursive: true });
}

export function saveConfig(
	paths: AgentVoicePaths,
	config: AgentVoiceConfig,
): void {
	const validated = validateConfig(cloneConfig(config));
	ensureConfigDir(paths);
	writeFileSync(paths.config, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}

export function loadConfig(
	paths: AgentVoicePaths,
	options: { createIfMissing?: boolean } = {},
): AgentVoiceConfig {
	const createIfMissing = options.createIfMissing ?? true;

	if (!existsSync(paths.config)) {
		const config = cloneConfig(defaultConfig);
		if (createIfMissing) {
			saveConfig(paths, config);
		}
		return config;
	}

	return normalizeConfig(JSON.parse(readFileSync(paths.config, "utf8")));
}

function parseValue(value: string): unknown {
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null") return null;
	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
	return value;
}

const UNSAFE_PATH_PARTS = new Set(["__proto__", "prototype", "constructor"]);

function hasOwn(object: object, key: string): boolean {
	return Object.hasOwn(object, key);
}

function assertSafePath(parts: string[], dottedPath: string): void {
	if (parts.some((part) => UNSAFE_PATH_PARTS.has(part))) {
		throw new Error(`Unsafe config path: ${dottedPath}`);
	}
}

export function setConfigValue(
	config: AgentVoiceConfig,
	dottedPath: string,
	value: string,
): AgentVoiceConfig {
	const next = cloneConfig(config);
	const parts = dottedPath.split(".");

	if (parts.length === 0 || parts.some((part) => part.length === 0)) {
		throw new Error(`Unknown config path: ${dottedPath}`);
	}
	assertSafePath(parts, dottedPath);

	let cursor: unknown = next;
	for (const part of parts.slice(0, -1)) {
		if (!cursor || typeof cursor !== "object" || !hasOwn(cursor, part)) {
			throw new Error(`Unknown config path: ${dottedPath}`);
		}
		cursor = (cursor as Record<string, unknown>)[part];
	}

	const finalKey = parts.at(-1)!;
	if (!cursor || typeof cursor !== "object" || !hasOwn(cursor, finalKey)) {
		throw new Error(`Unknown config path: ${dottedPath}`);
	}

	if (Array.isArray(cursor)) {
		throw new Error(`Cannot update config array element: ${dottedPath}`);
	}

	const currentValue = (cursor as Record<string, unknown>)[finalKey];
	if (Array.isArray(currentValue)) {
		throw new Error(`Cannot replace config array: ${dottedPath}`);
	}
	if (currentValue && typeof currentValue === "object") {
		throw new Error(`Cannot replace config section: ${dottedPath}`);
	}

	(cursor as Record<string, unknown>)[finalKey] = parseValue(value);
	return validateConfig(next);
}

export function isAgentName(value: string): value is AgentName {
	return (AGENT_NAMES as string[]).includes(value);
}
