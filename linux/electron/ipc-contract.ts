export const AGENT_VOICE_PRELOAD_METHODS = [
	"status.get",
	"daemon.start",
	"daemon.stop",
	"voice.test",
	"voice.speakLatest",
	"kokoro.status",
	"kokoro.setup.start",
	"kokoro.setup.cancel",
	"history.list",
	"queue.snapshot",
	"queue.clearActive",
	"queue.clearFailed",
	"diagnostics.snapshot",
	"hooks.install",
	"hooks.uninstall",
	"config.get",
	"config.update",
	"capsule.setEnabled",
	"capsule.openConsole",
	"capsule.viewQueue",
	"events.subscribe",
] as const;

export const AGENT_VOICE_CHANNELS = {
	statusGet: "agent-voice:status:get",
	daemonStart: "agent-voice:daemon:start",
	daemonStop: "agent-voice:daemon:stop",
	voiceTest: "agent-voice:voice:test",
	voiceSpeakLatest: "agent-voice:voice:speak-latest",
	kokoroStatus: "agent-voice:kokoro:status",
	kokoroSetupStart: "agent-voice:kokoro:setup:start",
	kokoroSetupCancel: "agent-voice:kokoro:setup:cancel",
	historyList: "agent-voice:history:list",
	queueSnapshot: "agent-voice:queue:snapshot",
	queueClearActive: "agent-voice:queue:clear-active",
	queueClearFailed: "agent-voice:queue:clear-failed",
	diagnosticsSnapshot: "agent-voice:diagnostics:snapshot",
	hooksInstall: "agent-voice:hooks:install",
	hooksUninstall: "agent-voice:hooks:uninstall",
	configGet: "agent-voice:config:get",
	configUpdate: "agent-voice:config:update",
	capsuleSetEnabled: "agent-voice:capsule:set-enabled",
	capsuleOpenConsole: "agent-voice:capsule:open-console",
	capsuleViewQueue: "agent-voice:capsule:view-queue",
	routeNavigate: "agent-voice:route:navigate",
	eventsSubscribe: "agent-voice:events:subscribe",
	eventsUnsubscribe: "agent-voice:events:unsubscribe",
} as const;

export const AGENT_VOICE_EVENTS = ["kokoro.setup"] as const;

export type AgentVoicePreloadMethod =
	(typeof AGENT_VOICE_PRELOAD_METHODS)[number];
export type AgentVoiceChannel =
	(typeof AGENT_VOICE_CHANNELS)[keyof typeof AGENT_VOICE_CHANNELS];
export type AgentVoiceEventName = (typeof AGENT_VOICE_EVENTS)[number];
