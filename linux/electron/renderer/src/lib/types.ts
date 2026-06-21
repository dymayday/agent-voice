import type {
	AppConfigDraft,
	AppServiceResult,
	SystemStatus,
	UiQueueSnapshot,
} from "../../../../../src/app-service";
import type { AppHistorySnapshot } from "../../../../../src/history";

export type RouteId =
	| "home"
	| "voice-bench"
	| "queue-history"
	| "setup-repair"
	| "hooks"
	| "diagnostics"
	| "settings";

export interface RouteDefinition {
	id: RouteId;
	label: string;
	description: string;
}

export type UnknownResult<T = unknown> = Promise<T> | T;

export interface AgentVoiceRendererApi {
	status: { get: () => UnknownResult<AppServiceResult<SystemStatus>> };
	daemon: {
		start: () => UnknownResult<AppServiceResult<unknown>>;
		stop: () => UnknownResult<AppServiceResult<unknown>>;
	};
	voice: {
		test: (text?: string) => UnknownResult<AppServiceResult<unknown>>;
		speakLatest: () => UnknownResult<AppServiceResult<unknown>>;
	};
	kokoro: {
		status: () => UnknownResult<AppServiceResult<unknown>>;
		setup: {
			start: (payload: { consentToken: string }) =>
				UnknownResult<AppServiceResult<{ sessionId: string }>>;
			cancel: (sessionId: string) =>
				UnknownResult<AppServiceResult<{ cancelled: boolean }>>;
		};
	};
	history: {
		list: (options?: { limit?: number; before?: string }) =>
			UnknownResult<AppServiceResult<AppHistorySnapshot>>;
	};
	queue: {
		snapshot: () => UnknownResult<AppServiceResult<UiQueueSnapshot>>;
		clearActive: () => UnknownResult<AppServiceResult<{ cleared: number }>>;
		clearFailed: () => UnknownResult<AppServiceResult<{ cleared: number }>>;
	};
	diagnostics: {
		snapshot: () => UnknownResult<AppServiceResult<unknown>>;
	};
	hooks: {
		install: (agent: string) => UnknownResult<AppServiceResult<unknown>>;
		uninstall: (agent: string) => UnknownResult<AppServiceResult<unknown>>;
	};
	config: {
		get: () => UnknownResult<AppConfigDraft>;
		update: (input: { mode?: string; thinking?: string; model?: string }) =>
			UnknownResult<AppServiceResult<AppConfigDraft>>;
	};
	capsule: {
		setEnabled: (enabled: boolean) => UnknownResult<AppServiceResult<AppConfigDraft>>;
		openConsole: () => UnknownResult<AppServiceResult<{ action: "openConsole" }>>;
		viewQueue: () => UnknownResult<AppServiceResult<{ action: "viewQueue" }>>;
	};
	events: {
		subscribe: (
			eventName: "kokoro.setup",
			listener: (payload: unknown) => void,
			options?: { sessionId?: string },
		) => () => void;
	};
}

export const ROUTES: RouteDefinition[] = [
	{
		id: "home",
		label: "Home",
		description: "Signal feed and first-run actions",
	},
	{
		id: "voice-bench",
		label: "Voice Bench",
		description: "Test playback, voice, and summary privacy",
	},
	{
		id: "queue-history",
		label: "Queue & History",
		description: "Review active speech jobs and completed history",
	},
	{
		id: "setup-repair",
		label: "Setup & Repair",
		description: "Install Kokoro and repair degraded services",
	},
	{ id: "hooks", label: "Hooks", description: "Manage agent hook installs" },
	{
		id: "diagnostics",
		label: "Diagnostics",
		description: "Privacy-safe doctor snapshot and copy preview",
	},
	{
		id: "settings",
		label: "Settings",
		description: "Summarizer settings and Desktop Capsule toggle",
	},
];

declare global {
	interface Window {
		agentVoice?: AgentVoiceRendererApi;
	}
}
