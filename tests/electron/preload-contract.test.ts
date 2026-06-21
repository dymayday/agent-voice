import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	AGENT_VOICE_CHANNELS,
	AGENT_VOICE_PRELOAD_METHODS,
} from "../../linux/electron/ipc-contract";

const preloadSource = readFileSync("linux/electron/preload.ts", "utf8");
const preloadEventsSource = readFileSync(
	"linux/electron/preload-events.ts",
	"utf8",
);

describe("electron preload contract", () => {
	test("exposes only allowlisted methods", () => {
		expect(AGENT_VOICE_PRELOAD_METHODS).toEqual([
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
		]);
	});

	test("does not define generic shell or filesystem channels", () => {
		expect(Object.values(AGENT_VOICE_CHANNELS).join(" ")).not.toMatch(
			/shell|exec|spawn|fs|sql/i,
		);
	});

	test("setup start and cancel channels are session scoped", () => {
		expect(AGENT_VOICE_CHANNELS.kokoroSetupStart).toContain("setup:start");
		expect(AGENT_VOICE_CHANNELS.kokoroSetupCancel).toContain("setup:cancel");
	});

	test("preload unsubscribe cleans up renderer and main-process listeners", () => {
		expect(AGENT_VOICE_CHANNELS.eventsUnsubscribe).toContain(
			"events:unsubscribe",
		);
		expect(preloadSource).toContain("subscribeToAgentVoiceEvent");
		expect(preloadEventsSource).toContain("removeListener(channel, wrapped)");
		expect(preloadEventsSource).toContain("AGENT_VOICE_CHANNELS.eventsUnsubscribe");
		expect(preloadEventsSource).toContain("if (disposed)");
	});
});
