import { contextBridge, ipcRenderer } from "electron";
import {
	AGENT_VOICE_CHANNELS,
	AGENT_VOICE_EVENTS,
	type AgentVoiceEventName,
} from "./ipc-contract";
import { subscribeToAgentVoiceEvent } from "./preload-events";

function assertSupportedEvent(
	eventName: string,
): asserts eventName is AgentVoiceEventName {
	if (!(AGENT_VOICE_EVENTS as readonly string[]).includes(eventName)) {
		throw new Error(`Unsupported event: ${eventName}`);
	}
}

const api = {
	status: { get: () => ipcRenderer.invoke(AGENT_VOICE_CHANNELS.statusGet) },
	daemon: {
		start: () => ipcRenderer.invoke(AGENT_VOICE_CHANNELS.daemonStart),
		stop: () => ipcRenderer.invoke(AGENT_VOICE_CHANNELS.daemonStop),
	},
	voice: {
		test: (text?: string) =>
			ipcRenderer.invoke(AGENT_VOICE_CHANNELS.voiceTest, { text }),
		speakLatest: () =>
			ipcRenderer.invoke(AGENT_VOICE_CHANNELS.voiceSpeakLatest),
	},
	kokoro: {
		status: () => ipcRenderer.invoke(AGENT_VOICE_CHANNELS.kokoroStatus),
		setup: {
			start: (payload: { consentToken: string }) =>
				ipcRenderer.invoke(AGENT_VOICE_CHANNELS.kokoroSetupStart, payload),
			cancel: (sessionId: string) =>
				ipcRenderer.invoke(AGENT_VOICE_CHANNELS.kokoroSetupCancel, {
					sessionId,
				}),
		},
	},
	history: {
		list: (options?: { limit?: number; before?: string }) =>
			ipcRenderer.invoke(AGENT_VOICE_CHANNELS.historyList, options ?? {}),
	},
	queue: {
		clearActive: () =>
			ipcRenderer.invoke(AGENT_VOICE_CHANNELS.queueClearActive),
		clearFailed: () =>
			ipcRenderer.invoke(AGENT_VOICE_CHANNELS.queueClearFailed),
	},
	diagnostics: {
		snapshot: () =>
			ipcRenderer.invoke(AGENT_VOICE_CHANNELS.diagnosticsSnapshot),
	},
	hooks: {
		install: (agent: string) =>
			ipcRenderer.invoke(AGENT_VOICE_CHANNELS.hooksInstall, { agent }),
		uninstall: (agent: string) =>
			ipcRenderer.invoke(AGENT_VOICE_CHANNELS.hooksUninstall, { agent }),
	},
	config: {
		get: () => ipcRenderer.invoke(AGENT_VOICE_CHANNELS.configGet),
		update: (input: { mode?: string; thinking?: string; model?: string }) =>
			ipcRenderer.invoke(AGENT_VOICE_CHANNELS.configUpdate, input),
	},
	capsule: {
		setEnabled: (enabled: boolean) =>
			ipcRenderer.invoke(AGENT_VOICE_CHANNELS.capsuleSetEnabled, { enabled }),
		openConsole: () =>
			ipcRenderer.invoke(AGENT_VOICE_CHANNELS.capsuleOpenConsole),
	},
	events: {
		subscribe: (
			eventName: AgentVoiceEventName,
			listener: (payload: unknown) => void,
			options: { sessionId?: string } = {},
		) => {
			assertSupportedEvent(eventName);
			if (typeof listener !== "function")
				throw new Error("Event listener must be a function");
			return subscribeToAgentVoiceEvent(
				ipcRenderer,
				eventName,
				listener,
				options,
			);
		},
	},
} as const;

contextBridge.exposeInMainWorld("agentVoice", api);

export type AgentVoicePreloadApi = typeof api;
