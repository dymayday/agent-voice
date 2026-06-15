import type { AgentVoiceConfig } from "./config";
import { defaultConfig } from "./config";

export type SummarizerMode = "default" | "heuristic";

export function setSummarizerMode(
	config: AgentVoiceConfig,
	mode: SummarizerMode,
): AgentVoiceConfig {
	return {
		...config,
		summarizer: {
			...config.summarizer,
			priority:
				mode === "heuristic"
					? ["heuristic"]
					: defaultConfig.summarizer.priority,
		},
	};
}

export function isSummarizerMode(value: string): value is SummarizerMode {
	return value === "default" || value === "heuristic";
}
