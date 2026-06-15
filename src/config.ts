import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentVoicePaths } from "./paths";

export type AgentName = "claude" | "codex" | "pi" | "opencode";
export type SummarizerName =
	| "codex-fast"
	| "pi-fast"
	| "opencode"
	| "heuristic";

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
		timeoutSeconds: number;
		maxInputChars: number;
		maxSummaryChars: number;
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
		codex: { enabled: true, mode: "wrapper-required-native-optional" },
		pi: { enabled: true, mode: "native" },
		opencode: { enabled: true, mode: "wrapper-required-native-optional" },
	},
	speakPolicy: "every_turn",
	ignoreCwdPatterns: [],
	summarizer: {
		priority: ["codex-fast", "pi-fast", "opencode", "heuristic"],
		codexModel: "gpt-5.3-codex",
		piModel: "openai/gpt-5.3-codex",
		opencodeModel: null,
		timeoutSeconds: 12,
		maxInputChars: 12000,
		maxSummaryChars: 180,
	},
	tts: {
		kokoroScript:
			"/Users/meidhy/junk/repo/kokoro-tts/Python/kokoro_tts_service.py",
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

function cloneConfig(config: AgentVoiceConfig): AgentVoiceConfig {
	return JSON.parse(JSON.stringify(config)) as AgentVoiceConfig;
}

function ensureConfigDir(paths: AgentVoicePaths): void {
	mkdirSync(dirname(paths.config), { recursive: true });
}

export function saveConfig(
	paths: AgentVoicePaths,
	config: AgentVoiceConfig,
): void {
	ensureConfigDir(paths);
	writeFileSync(paths.config, `${JSON.stringify(config, null, 2)}\n`, "utf8");
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

	const loaded = JSON.parse(
		readFileSync(paths.config, "utf8"),
	) as AgentVoiceConfig;
	return loaded;
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
	return next;
}

export function isAgentName(value: string): value is AgentName {
	return (AGENT_NAMES as string[]).includes(value);
}
