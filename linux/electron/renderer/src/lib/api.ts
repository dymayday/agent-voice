import type { AgentVoiceRendererApi } from "./types";

function requireAgentVoice(): AgentVoiceRendererApi {
	if (!window.agentVoice) {
		throw new Error("Agent Voice preload API is unavailable");
	}
	return window.agentVoice;
}

export const agentVoice = new Proxy({} as AgentVoiceRendererApi, {
	get(_target, property: keyof AgentVoiceRendererApi) {
		return requireAgentVoice()[property];
	},
});

export function getAgentVoice(): AgentVoiceRendererApi {
	return requireAgentVoice();
}
