import type { AgentVoiceRendererApi } from "./types";

const success = <T>(value: T) => ({ ok: true as const, value });

export function createMockAgentVoice(
	overrides: Partial<AgentVoiceRendererApi> = {},
): AgentVoiceRendererApi {
	const base: AgentVoiceRendererApi = {
		status: {
			get: async () =>
				success({
					version: 1,
					buildId: null,
					daemon: { state: "stopped", running: false, pid: null },
					kokoro: { state: "missing", message: "Kokoro is not installed." },
					playback: { state: "missing", message: "Playback has not been probed." },
					queue: { pending: 0, processing: 0, done: 0, failed: 0, skipped: 0 },
					attention: [],
				}),
		},
		daemon: {
			start: async () => success({ running: true }),
			stop: async () => success({ running: false }),
		},
		voice: {
			test: async () => success({ status: "played" }),
			speakLatest: async () => success({ spoken: true }),
		},
		kokoro: {
			status: async () => success({ installed: false }),
			setup: {
				start: async () => success({ sessionId: "kokoro-setup-test" }),
				cancel: async () => success({ cancelled: true }),
			},
		},
		history: {
			list: async () =>
				success({
					version: 1,
					jobs: [],
					pageInfo: { limit: 50, hasMore: false, nextCursor: null },
				}),
		},
		queue: {
			clearActive: async () => success({ cleared: 0 }),
			clearFailed: async () => success({ cleared: 0 }),
		},
		diagnostics: {
			snapshot: async () => success({ sections: [] }),
		},
		hooks: {
			install: async () => success({ installed: true }),
			uninstall: async () => success({ installed: false }),
		},
		config: {
			get: async () => ({
				enabled: true,
				summarizer: { mode: "default", thinking: "minimal", piModel: "" },
				tts: { voice: "af_heart" },
				ui: { desktopCapsule: { enabled: false } },
			}),
			update: async () =>
				success({ ui: { desktopCapsule: { enabled: false } } }),
		},
		capsule: {
			setEnabled: async (enabled: boolean) =>
				success({ ui: { desktopCapsule: { enabled } } }),
			openConsole: async () => success({ action: "openConsole" }),
		},
		events: {
			subscribe: () => () => undefined,
		},
	};

	return {
		...base,
		...overrides,
		status: { ...base.status, ...overrides.status },
		daemon: { ...base.daemon, ...overrides.daemon },
		voice: { ...base.voice, ...overrides.voice },
		kokoro: {
			...base.kokoro,
			...overrides.kokoro,
			setup: { ...base.kokoro.setup, ...overrides.kokoro?.setup },
		},
		history: { ...base.history, ...overrides.history },
		queue: { ...base.queue, ...overrides.queue },
		diagnostics: { ...base.diagnostics, ...overrides.diagnostics },
		hooks: { ...base.hooks, ...overrides.hooks },
		config: { ...base.config, ...overrides.config },
		capsule: { ...base.capsule, ...overrides.capsule },
		events: { ...base.events, ...overrides.events },
	};
}

export function installMockAgentVoice(
	overrides: Partial<AgentVoiceRendererApi> = {},
): AgentVoiceRendererApi {
	const api = createMockAgentVoice(overrides);
	Object.defineProperty(window, "agentVoice", {
		value: api,
		configurable: true,
	});
	return api;
}
