import {
	AGENT_VOICE_CHANNELS,
	type AgentVoiceEventName,
} from "./ipc-contract";

export type PreloadIpcRenderer = {
	on: (
		channel: string,
		listener: (event: unknown, payload: unknown) => void,
	) => void;
	removeListener: (
		channel: string,
		listener: (event: unknown, payload: unknown) => void,
	) => void;
	invoke: (channel: string, payload?: unknown) => Promise<unknown>;
};

export function eventChannel(
	eventName: AgentVoiceEventName,
	sessionId?: string,
): string {
	return `${AGENT_VOICE_CHANNELS.eventsSubscribe}:${eventName}${
		sessionId ? `:${sessionId}` : ""
	}`;
}

function subscriptionIdFromResult(result: unknown): string | null {
	if (
		result &&
		typeof result === "object" &&
		"ok" in result &&
		result.ok === true &&
		"value" in result &&
		result.value &&
		typeof result.value === "object" &&
		"subscriptionId" in result.value &&
		typeof result.value.subscriptionId === "string"
	) {
		return result.value.subscriptionId;
	}
	return null;
}

export function subscribeToAgentVoiceEvent(
	ipcRenderer: PreloadIpcRenderer,
	eventName: AgentVoiceEventName,
	listener: (payload: unknown) => void,
	options: { sessionId?: string } = {},
): () => void {
	const channel = eventChannel(eventName, options.sessionId);
	const wrapped = (_event: unknown, payload: unknown) => listener(payload);
	ipcRenderer.on(channel, wrapped);

	let subscriptionId: string | null = null;
	let disposed = false;

	function unsubscribeMain(id: string): void {
		void ipcRenderer.invoke(AGENT_VOICE_CHANNELS.eventsUnsubscribe, {
			subscriptionId: id,
		});
	}

	void ipcRenderer
		.invoke(AGENT_VOICE_CHANNELS.eventsSubscribe, {
			eventName,
			...(options.sessionId ? { sessionId: options.sessionId } : {}),
		})
		.then((result) => {
			const nextSubscriptionId = subscriptionIdFromResult(result);
			if (!nextSubscriptionId) return;
			if (disposed) {
				unsubscribeMain(nextSubscriptionId);
				return;
			}
			subscriptionId = nextSubscriptionId;
		});

	return () => {
		if (disposed) return;
		disposed = true;
		ipcRenderer.removeListener(channel, wrapped);
		if (subscriptionId) unsubscribeMain(subscriptionId);
	};
}
