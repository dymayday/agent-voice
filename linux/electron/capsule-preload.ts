import { contextBridge, ipcRenderer } from "electron";
import { AGENT_VOICE_CHANNELS } from "./ipc-contract";

const capsuleApi = {
	voice: {
		speakLatest: () =>
			ipcRenderer.invoke(AGENT_VOICE_CHANNELS.voiceSpeakLatest),
	},
	capsule: {
		openConsole: () =>
			ipcRenderer.invoke(AGENT_VOICE_CHANNELS.capsuleOpenConsole),
		viewQueue: () =>
			ipcRenderer.invoke(AGENT_VOICE_CHANNELS.capsuleViewQueue),
	},
} as const;

contextBridge.exposeInMainWorld("agentVoice", capsuleApi);

export type AgentVoiceCapsulePreloadApi = typeof capsuleApi;
