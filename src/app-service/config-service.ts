import {
	loadConfig,
	saveConfig,
	setConfigValue,
	type AgentVoiceConfig,
} from "../config";
import type { SummarizerThinking } from "../config";
import { resolvePaths, type AgentVoicePaths } from "../paths";
import { isSummarizerMode, setSummarizerMode } from "../summarizer-mode";
import { fail, ok } from "./errors";
import type { AppServiceResult } from "./types";

export type ConfigPaths = AgentVoicePaths;
export type AppConfig = AgentVoiceConfig;

export interface SummarizerSettingsInput {
	mode?: string;
	thinking?: string;
	model?: string;
}

const SUMMARIZER_THINKING_VALUES = new Set<string>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);

function pathsOrDefault(paths?: ConfigPaths): ConfigPaths {
	return paths ?? resolvePaths();
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function toBadInput(error: unknown): AppServiceResult<never> {
	return fail("BAD_INPUT", errorMessage(error), { details: error });
}

function isSummarizerThinking(value: string): value is SummarizerThinking {
	return SUMMARIZER_THINKING_VALUES.has(value);
}

export function getAppConfig(paths?: ConfigPaths): AppConfig {
	return loadConfig(pathsOrDefault(paths), { createIfMissing: false });
}

export function setCapsuleEnabled(
	enabled: boolean,
	paths?: ConfigPaths,
): AppServiceResult<AppConfig> {
	try {
		const resolvedPaths = pathsOrDefault(paths);
		const config = loadConfig(resolvedPaths);
		const updated: AppConfig = {
			...config,
			ui: {
				...config.ui,
				desktopCapsule: {
					...config.ui.desktopCapsule,
					enabled,
				},
			},
		};
		saveConfig(resolvedPaths, updated);
		return ok(loadConfig(resolvedPaths, { createIfMissing: false }));
	} catch (error) {
		return fail("INTERNAL", errorMessage(error), {
			details: error,
			recoverable: false,
		});
	}
}

export function updateSummarizerSettings(
	input: SummarizerSettingsInput,
	paths?: ConfigPaths,
): AppServiceResult<AppConfig> {
	try {
		const resolvedPaths = pathsOrDefault(paths);
		let config = loadConfig(resolvedPaths, { createIfMissing: false });

		if (input.mode !== undefined) {
			if (!isSummarizerMode(input.mode)) {
				throw new Error(
					"Invalid config summarizer.mode: expected one of default, heuristic",
				);
			}
			config = setSummarizerMode(config, input.mode);
		}
		if (input.thinking !== undefined) {
			if (!isSummarizerThinking(input.thinking)) {
				throw new Error(
					"Invalid config summarizer.thinking: expected one of off, minimal, low, medium, high, xhigh",
				);
			}
			config = setConfigValue(config, "summarizer.thinking", input.thinking);
		}
		if (input.model !== undefined) {
			config = setConfigValue(config, "summarizer.piModel", input.model);
		}

		saveConfig(resolvedPaths, config);
		return ok(loadConfig(resolvedPaths, { createIfMissing: false }));
	} catch (error) {
		return toBadInput(error);
	}
}
