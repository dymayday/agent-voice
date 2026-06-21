import { describe, expect, test } from "bun:test";
import {
	AGENT_VOICE_CHANNELS,
	type AgentVoiceEventName,
} from "../../linux/electron/ipc-contract";
import {
	eventChannel,
	subscribeToAgentVoiceEvent,
	type PreloadIpcRenderer,
} from "../../linux/electron/preload-events";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

class FakeIpcRenderer implements PreloadIpcRenderer {
	listeners: Array<{
		channel: string;
		listener: (event: unknown, payload: unknown) => void;
	}> = [];
	removed: string[] = [];
	invocations: Array<{ channel: string; payload?: unknown }> = [];
	subscribeDeferred = deferred<unknown>();

	on(
		channel: string,
		listener: (event: unknown, payload: unknown) => void,
	): void {
		this.listeners.push({ channel, listener });
	}

	removeListener(
		channel: string,
		_listener: (event: unknown, payload: unknown) => void,
	): void {
		this.removed.push(channel);
	}

	invoke(channel: string, payload?: unknown): Promise<unknown> {
		this.invocations.push({ channel, payload });
		if (channel === AGENT_VOICE_CHANNELS.eventsSubscribe) {
			return this.subscribeDeferred.promise;
		}
		return Promise.resolve({ ok: true });
	}
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("preload event subscriptions", () => {
	test("unsubscribe before subscribe resolves still removes the main-process subscription", async () => {
		const ipc = new FakeIpcRenderer();
		const unsubscribe = subscribeToAgentVoiceEvent(
			ipc,
			"kokoro.setup",
			() => undefined,
			{ sessionId: "session-1" },
		);

		unsubscribe();
		expect(ipc.removed).toEqual([eventChannel("kokoro.setup", "session-1")]);
		expect(
			ipc.invocations.some(
				(invocation) =>
					invocation.channel === AGENT_VOICE_CHANNELS.eventsUnsubscribe,
			),
		).toBe(false);

		ipc.subscribeDeferred.resolve({
			ok: true,
			value: { subscriptionId: "subscription-1" },
		});
		await settle();

		expect(ipc.invocations).toContainEqual({
			channel: AGENT_VOICE_CHANNELS.eventsUnsubscribe,
			payload: { subscriptionId: "subscription-1" },
		});
	});

	test("unsubscribe after subscribe resolves removes renderer and main listeners once", async () => {
		const ipc = new FakeIpcRenderer();
		const unsubscribe = subscribeToAgentVoiceEvent(
			ipc,
			"kokoro.setup" as AgentVoiceEventName,
			() => undefined,
		);
		ipc.subscribeDeferred.resolve({
			ok: true,
			value: { subscriptionId: "subscription-2" },
		});
		await settle();

		unsubscribe();
		unsubscribe();

		expect(ipc.removed).toEqual([eventChannel("kokoro.setup")]);
		expect(
			ipc.invocations.filter(
				(invocation) =>
					invocation.channel === AGENT_VOICE_CHANNELS.eventsUnsubscribe,
			),
		).toEqual([
			{
				channel: AGENT_VOICE_CHANNELS.eventsUnsubscribe,
				payload: { subscriptionId: "subscription-2" },
			},
		]);
	});
});
