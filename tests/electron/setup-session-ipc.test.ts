import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePaths } from "../../src/paths";
import { AGENT_VOICE_CHANNELS } from "../../linux/electron/ipc-contract";
import {
	createSetupSessionRegistry,
	registerIpcHandlers,
} from "../../linux/electron/main";

class FakeSender {
	sent: Array<{ channel: string; payload: unknown }> = [];
	isDestroyed = () => false;
	send = (channel: string, payload: unknown): void => {
		this.sent.push({ channel, payload });
	};
	once = () => undefined;
}

class FakeIpcMain {
	handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
	sender = new FakeSender();

	handle(
		channel: string,
		handler: (event: unknown, payload?: unknown) => unknown,
	): void {
		this.handlers.set(channel, handler);
	}

	invoke(channel: string, payload?: unknown): Promise<unknown> {
		const handler = this.handlers.get(channel);
		if (!handler) throw new Error(`missing handler for ${channel}`);
		return Promise.resolve(handler({ sender: this.sender }, payload));
	}
}

describe("setup session IPC", () => {
	test("rejects setup start without consent token", () => {
		const registry = createSetupSessionRegistry();
		expect(() => registry.start({ consentToken: "" })).toThrow("consent");
	});

	test("cancel is best-effort for unknown or already-cancelled sessions", () => {
		const registry = createSetupSessionRegistry();
		expect(registry.cancel("missing-session")).toEqual({ cancelled: false });
		const session = registry.start({ consentToken: "approved" });
		expect(registry.cancel(session.sessionId)).toEqual({ cancelled: true });
		expect(registry.cancel(session.sessionId)).toEqual({ cancelled: false });
	});

	test("event subscriptions are allowlisted, session-scoped, and unsubscribe cleans up", () => {
		const registry = createSetupSessionRegistry();
		const first = registry.start({ consentToken: "first" });
		const second = registry.start({ consentToken: "second" });
		const seen: unknown[] = [];
		const unsubscribe = registry.subscribe(
			"kokoro.setup",
			(payload) => seen.push(payload),
			{ sessionId: first.sessionId },
		);

		first.emit({ type: "log", stream: "stdout", message: "first" });
		second.emit({ type: "log", stream: "stdout", message: "second" });
		expect(seen).toEqual([
			{
				sessionId: first.sessionId,
				event: { type: "log", stream: "stdout", message: "first" },
			},
		]);

		expect(() =>
			registry.subscribe("raw-process-output", () => undefined),
		).toThrow("Unsupported event");
		expect(unsubscribe()).toBeUndefined();
		first.emit({ type: "log", stream: "stdout", message: "after" });
		expect(seen).toHaveLength(1);
	});

	test("late session-scoped subscribers receive buffered setup events", () => {
		const registry = createSetupSessionRegistry();
		const session = registry.start({ consentToken: "approved" });
		const firstEvent = { type: "log", stream: "stdout", message: "early" };
		session.emit(firstEvent);
		const seen: unknown[] = [];

		registry.subscribe("kokoro.setup", (payload) => seen.push(payload), {
			sessionId: session.sessionId,
		});

		expect(seen).toEqual([{ sessionId: session.sessionId, event: firstEvent }]);
	});

	test("cancelled sessions suppress later setup events", () => {
		const registry = createSetupSessionRegistry();
		const session = registry.start({ consentToken: "approved" });
		const seen: unknown[] = [];
		registry.subscribe("kokoro.setup", (payload) => seen.push(payload), {
			sessionId: session.sessionId,
		});

		registry.cancel(session.sessionId);
		session.emit({ type: "log", stream: "stdout", message: "late" });

		expect(seen).toEqual([]);
	});

	test("explicit event unsubscribe removes main-process subscription before sender destruction", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-ipc-unsubscribe-"));
		try {
			const ipcMain = new FakeIpcMain();
			const setupRegistry = createSetupSessionRegistry();
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			registerIpcHandlers(ipcMain as never, { paths, setupRegistry });
			const session = setupRegistry.start({ consentToken: "approved" });
			const subscribed = await ipcMain.invoke(AGENT_VOICE_CHANNELS.eventsSubscribe, {
				eventName: "kokoro.setup",
				sessionId: session.sessionId,
			});
			expect(subscribed).toMatchObject({ ok: true });
			const subscriptionId = (subscribed as { value: { subscriptionId: string } })
				.value.subscriptionId;

			expect(
				await ipcMain.invoke(AGENT_VOICE_CHANNELS.eventsUnsubscribe, {
					subscriptionId,
				}),
			).toMatchObject({ ok: true, value: { unsubscribed: true } });
			session.emit({ type: "log", stream: "stdout", message: "after" });

			expect(ipcMain.sender.sent).toEqual([]);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("setup start handler returns session id before setup resolves", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-ipc-setup-"));
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const ipcMain = new FakeIpcMain();
			let runnerStarted = false;
			const deferred: {
				resolve?: (value: {
					ok: true;
					pythonPath: string;
					scriptPath: string;
				}) => void;
			} = {};

			registerIpcHandlers(ipcMain as never, {
				paths,
				kokoroSetupRunner: async () => {
					runnerStarted = true;
					return await new Promise((resolve) => {
						deferred.resolve = resolve;
					});
				},
			});

			const resultPromise = ipcMain.invoke(AGENT_VOICE_CHANNELS.kokoroSetupStart, {
				consentToken: "approved",
			});
			const result = await Promise.race([
				resultPromise,
				new Promise((resolve) => setTimeout(() => resolve("timed-out"), 20)),
			]);

			expect(result).toMatchObject({
				ok: true,
				value: { sessionId: expect.stringMatching(/^kokoro-setup-/) },
			});
			expect(runnerStarted).toBe(true);
			if (!deferred.resolve) throw new Error("runner did not start");
			deferred.resolve({ ok: true, pythonPath: "python", scriptPath: "script" });
			await resultPromise;
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
