import type { SystemStatus } from "./types";

export interface FirstRunProbeState {
	playbackReady: boolean;
	kokoroReady: boolean;
}

export interface FirstRunAction {
	id: string;
	title: string;
	detail: string;
	cta: string;
}

type FirstRunStatus = Pick<SystemStatus, "daemon"> & {
	install?: Record<string, string>;
};

export const FIRST_RUN_ACTIONS = {
	playback: {
		id: "install-playback-tool",
		title: "Install a playback tool",
		detail:
			"Agent Voice needs a local audio playback command before it can speak summaries.",
		cta: "Install playback tool",
	},
	kokoro: {
		id: "setup-kokoro",
		title: "Set up Kokoro voice",
		detail: "Install the managed Kokoro voice assets for local text-to-speech.",
		cta: "Set up Kokoro",
	},
	daemon: {
		id: "start-daemon",
		title: "Start Agent Voice",
		detail:
			"Start the background daemon so queued agent events can be processed.",
		cta: "Start daemon",
	},
	hooks: {
		id: "install-hooks",
		title: "Install agent hooks",
		detail:
			"Install shell hooks for supported agents so their events reach Agent Voice.",
		cta: "Install hooks",
	},
	privacy: {
		id: "privacy-review",
		title: "Review privacy settings",
		detail:
			"Confirm how summaries and speech are handled before using Agent Voice.",
		cta: "Review privacy",
	},
} as const satisfies Record<string, FirstRunAction>;

export function deriveFirstRunActions(
	status: FirstRunStatus,
	probes: FirstRunProbeState,
): FirstRunAction[] {
	const actions: FirstRunAction[] = [];
	if (!probes.playbackReady) actions.push(FIRST_RUN_ACTIONS.playback);
	if (!probes.kokoroReady) actions.push(FIRST_RUN_ACTIONS.kokoro);
	if (!status.daemon.running) actions.push(FIRST_RUN_ACTIONS.daemon);
	if (
		status.install &&
		Object.values(status.install).some((state) => state !== "installed")
	) {
		actions.push(FIRST_RUN_ACTIONS.hooks);
	}
	actions.push(FIRST_RUN_ACTIONS.privacy);
	return actions;
}
