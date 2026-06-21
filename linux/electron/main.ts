import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { BrowserWindowConstructorOptions, IpcMain } from "electron";
import { ok } from "../../src/app-service/errors";
import { resolvePaths, type AgentVoicePaths } from "../../src/paths";
import {
	AGENT_VOICE_CHANNELS,
	AGENT_VOICE_EVENTS,
	type AgentVoiceEventName,
	type AgentVoicePreloadMethod,
} from "./ipc-contract";

export type IpcPayload = Record<string, unknown> | undefined;
export interface SetupEventEnvelope {
	sessionId: string;
	event: unknown;
}
export type SetupEventListener = (payload: SetupEventEnvelope) => void;

const SUPPORTED_AGENTS = new Set(["pi", "claude", "codex", "opencode"]);
const CAPSULE_ACTIONS = ["openConsole", "speakLatest", "viewQueue"] as const;

type CapsuleAction = (typeof CAPSULE_ACTIONS)[number];
type KokoroSetupRunner = (
	paths: AgentVoicePaths,
	options: { emit?: (event: unknown) => void },
) => Promise<unknown>;
type AppServiceMethod =
	| "status.get"
	| "daemon.start"
	| "daemon.stop"
	| "voice.test"
	| "voice.speakLatest"
	| "kokoro.status"
	| "kokoro.setup.run"
	| "history.list"
	| "queue.clearActive"
	| "queue.clearFailed"
	| "diagnostics.snapshot"
	| "hooks.install"
	| "hooks.uninstall"
	| "config.get"
	| "config.update"
	| "capsule.setEnabled";

type AppServiceEventEmitter = (event: unknown) => void;

interface AppServiceClient {
	invoke(
		method: AppServiceMethod,
		payload?: unknown,
		emit?: AppServiceEventEmitter,
	): Promise<unknown> | unknown;
	dispose?: () => void;
}

const BRIDGE_PROTOCOL_PREFIX = "__AGENT_VOICE_BRIDGE__";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string";
}

function assertNoUnexpectedKeys(
	method: string,
	payload: Record<string, unknown>,
	allowed: readonly string[],
): void {
	for (const key of Object.keys(payload)) {
		if (!allowed.includes(key)) throw new Error(`Invalid ${method} payload`);
	}
}

export function validateIpcPayload(
	method: AgentVoicePreloadMethod,
	payload?: unknown,
): unknown {
	switch (method) {
		case "status.get":
		case "daemon.start":
		case "daemon.stop":
		case "voice.speakLatest":
		case "kokoro.status":
		case "queue.clearActive":
		case "queue.clearFailed":
		case "diagnostics.snapshot":
		case "config.get":
		case "capsule.openConsole":
			if (
				payload !== undefined &&
				!(isRecord(payload) && Object.keys(payload).length === 0)
			) {
				throw new Error(`Invalid ${method} payload`);
			}
			return undefined;
		case "voice.test": {
			if (!isRecord(payload)) throw new Error("Invalid voice.test payload");
			assertNoUnexpectedKeys(method, payload, ["text"]);
			if (!optionalString(payload.text))
				throw new Error("Invalid voice.test payload");
			return payload;
		}
		case "kokoro.setup.start": {
			if (!isRecord(payload))
				throw new Error("Invalid kokoro.setup.start payload");
			assertNoUnexpectedKeys(method, payload, ["consentToken"]);
			if (
				typeof payload.consentToken !== "string" ||
				payload.consentToken.trim() === ""
			) {
				throw new Error("Kokoro setup requires consent token");
			}
			return { consentToken: payload.consentToken };
		}
		case "kokoro.setup.cancel": {
			if (!isRecord(payload))
				throw new Error("Invalid kokoro.setup.cancel payload");
			assertNoUnexpectedKeys(method, payload, ["sessionId"]);
			if (
				typeof payload.sessionId !== "string" ||
				payload.sessionId.trim() === ""
			) {
				throw new Error("Invalid kokoro.setup.cancel payload");
			}
			return { sessionId: payload.sessionId };
		}
		case "history.list": {
			if (payload === undefined) return {};
			if (!isRecord(payload)) throw new Error("Invalid history.list payload");
			assertNoUnexpectedKeys(method, payload, ["limit", "before"]);
			if (
				payload.limit !== undefined &&
				(typeof payload.limit !== "number" ||
					!Number.isInteger(payload.limit) ||
					payload.limit < 1 ||
					payload.limit > 200)
			) {
				throw new Error("Invalid history.list payload");
			}
			if (!optionalString(payload.before))
				throw new Error("Invalid history.list payload");
			return payload;
		}
		case "hooks.install":
		case "hooks.uninstall": {
			if (!isRecord(payload)) throw new Error(`Invalid ${method} payload`);
			assertNoUnexpectedKeys(method, payload, ["agent"]);
			if (
				typeof payload.agent !== "string" ||
				!SUPPORTED_AGENTS.has(payload.agent)
			) {
				throw new Error(`Unsupported agent: ${String(payload.agent)}`);
			}
			return { agent: payload.agent };
		}
		case "config.update": {
			if (!isRecord(payload)) throw new Error("Invalid config.update payload");
			assertNoUnexpectedKeys(method, payload, ["mode", "thinking", "model"]);
			if (
				!optionalString(payload.mode) ||
				!optionalString(payload.thinking) ||
				!optionalString(payload.model)
			) {
				throw new Error("Invalid config.update payload");
			}
			return payload;
		}
		case "capsule.setEnabled": {
			if (!isRecord(payload))
				throw new Error("Invalid capsule.setEnabled payload");
			assertNoUnexpectedKeys(method, payload, ["enabled"]);
			if (typeof payload.enabled !== "boolean")
				throw new Error("Invalid capsule.setEnabled payload");
			return { enabled: payload.enabled };
		}
		case "events.subscribe": {
			if (!isRecord(payload))
				throw new Error("Invalid events.subscribe payload");
			assertNoUnexpectedKeys(method, payload, ["eventName", "sessionId"]);
			if (
				!AGENT_VOICE_EVENTS.includes(payload.eventName as AgentVoiceEventName)
			) {
				throw new Error(`Unsupported event: ${String(payload.eventName)}`);
			}
			if (!optionalString(payload.sessionId)) {
				throw new Error("Invalid events.subscribe payload");
			}
			return { eventName: payload.eventName, sessionId: payload.sessionId };
		}
		default: {
			const neverMethod: never = method;
			throw new Error(`Unsupported IPC method: ${neverMethod}`);
		}
	}
}

function createInjectedAppServiceClient(
	paths: AgentVoicePaths,
	runner: KokoroSetupRunner,
): AppServiceClient {
	return {
		invoke(method, _payload, emit) {
			if (method !== "kokoro.setup.run") {
				throw new Error(`No injected app-service implementation for ${method}`);
			}
			return runner(paths, emit ? { emit } : {});
		},
	};
}

function createBridgeAppServiceClient(env: Record<string, string | undefined>): AppServiceClient {
	const bridge = spawn("bun", ["linux/electron/service-bridge.ts"], {
		cwd: process.cwd(),
		env: { ...process.env, ...env },
		stdio: ["pipe", "pipe", "pipe"],
	});
	let nextRequest = 0;
	let stdoutBuffer = "";
	const pending = new Map<
		string,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			emit?: AppServiceEventEmitter;
		}
	>();

	function rejectAll(error: Error): void {
		for (const request of pending.values()) request.reject(error);
		pending.clear();
	}

	function handleBridgeLine(line: string): void {
		if (!line.startsWith(BRIDGE_PROTOCOL_PREFIX)) return;
		let message: unknown;
		try {
			message = JSON.parse(line.slice(BRIDGE_PROTOCOL_PREFIX.length));
		} catch {
			return;
		}
		if (!isRecord(message) || typeof message.id !== "string") return;
		const request = pending.get(message.id);
		if (!request) return;
		if (message.type === "event") {
			request.emit?.(message.event);
			return;
		}
		if (message.type !== "response") return;
		pending.delete(message.id);
		if ("bridgeError" in message) {
			request.reject(new Error(String(message.bridgeError)));
			return;
		}
		request.resolve(message.result);
	}

	bridge.stdout.setEncoding("utf8");
	bridge.stdout.on("data", (chunk: string) => {
		stdoutBuffer += chunk;
		let newline = stdoutBuffer.indexOf("\n");
		while (newline >= 0) {
			const line = stdoutBuffer.slice(0, newline);
			stdoutBuffer = stdoutBuffer.slice(newline + 1);
			handleBridgeLine(line);
			newline = stdoutBuffer.indexOf("\n");
		}
	});
	bridge.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
	bridge.on("error", (error) => rejectAll(error));
	bridge.on("exit", (code) =>
		rejectAll(new Error(`App-service bridge exited with code ${code ?? "unknown"}`)),
	);

	return {
		invoke(method, payload, emit) {
			if (!bridge.stdin.writable) {
				return Promise.reject(new Error("App-service bridge is not writable"));
			}
			const id = `request-${++nextRequest}`;
			const request = { id, method, payload };
			return new Promise((resolve, reject) => {
				pending.set(id, { resolve, reject, ...(emit ? { emit } : {}) });
				bridge.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
					if (!error) return;
					pending.delete(id);
					reject(error);
				});
			});
		},
		dispose() {
			bridge.kill();
		},
	};
}

export function createMainWindowOptions(
	preloadPath: string,
): BrowserWindowConstructorOptions {
	return {
		width: 1200,
		height: 800,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			preload: preloadPath,
		},
	};
}

export function createSetupSessionRegistry() {
	const sessions = new Map<
		string,
		{ active: boolean; events: SetupEventEnvelope[] }
	>();
	const listeners = new Set<{
		eventName: AgentVoiceEventName;
		sessionId?: string;
		listener: SetupEventListener;
	}>();
	const completedSessions: string[] = [];
	let nextSession = 0;
	const maxBufferedEventsPerSession = 100;
	const maxCompletedSessions = 20;

	function emitForSession(sessionId: string, event: unknown): void {
		const session = sessions.get(sessionId);
		if (!session?.active) return;
		const envelope: SetupEventEnvelope = { sessionId, event };
		session.events.push(envelope);
		if (session.events.length > maxBufferedEventsPerSession) {
			session.events.splice(0, session.events.length - maxBufferedEventsPerSession);
		}
		for (const subscription of listeners) {
			if (subscription.eventName !== "kokoro.setup") continue;
			if (subscription.sessionId && subscription.sessionId !== sessionId) continue;
			subscription.listener(envelope);
		}
	}

	function rememberCompleted(sessionId: string): void {
		if (completedSessions.includes(sessionId)) return;
		completedSessions.push(sessionId);
		while (completedSessions.length > maxCompletedSessions) {
			const expired = completedSessions.shift();
			if (expired) sessions.delete(expired);
		}
	}

	return {
		start(payload: { consentToken?: string }) {
			validateIpcPayload("kokoro.setup.start", payload);
			const sessionId = `kokoro-setup-${++nextSession}`;
			sessions.set(sessionId, { active: true, events: [] });
			return {
				sessionId,
				emit: (event: unknown) => emitForSession(sessionId, event),
			};
		},
		cancel(sessionId: string): { cancelled: boolean } {
			const session = sessions.get(sessionId);
			if (!session?.active) return { cancelled: false };
			sessions.delete(sessionId);
			return { cancelled: true };
		},
		finish(sessionId: string): void {
			const session = sessions.get(sessionId);
			if (!session) return;
			session.active = false;
			rememberCompleted(sessionId);
		},
		subscribe(
			eventName: string,
			listener: SetupEventListener,
			options: { sessionId?: string } = {},
		) {
			if (!AGENT_VOICE_EVENTS.includes(eventName as AgentVoiceEventName)) {
				throw new Error(`Unsupported event: ${eventName}`);
			}
			const subscription = {
				eventName: eventName as AgentVoiceEventName,
				...(options.sessionId ? { sessionId: options.sessionId } : {}),
				listener,
			};
			listeners.add(subscription);
			if (options.sessionId) {
				for (const envelope of sessions.get(options.sessionId)?.events ?? []) {
					listener(envelope);
				}
			}
			return () => {
				listeners.delete(subscription);
			};
		},
	};
}

export function createCapsuleController(hooks: {
	create: () => void;
	destroy: () => void;
	focusConsole: () => void;
}) {
	let enabled = false;
	return {
		setEnabled(nextEnabled: boolean) {
			if (nextEnabled === enabled) return;
			enabled = nextEnabled;
			if (enabled) hooks.create();
			else hooks.destroy();
		},
		openConsole() {
			hooks.focusConsole();
		},
		allowedActions(): CapsuleAction[] {
			return [...CAPSULE_ACTIONS];
		},
	};
}

type RegisterOptions = {
	paths?: AgentVoicePaths;
	setupRegistry?: ReturnType<typeof createSetupSessionRegistry>;
	capsuleController?: ReturnType<typeof createCapsuleController>;
	env?: Record<string, string | undefined>;
	kokoroSetupRunner?: KokoroSetupRunner;
	appServices?: AppServiceClient;
};

export function registerIpcHandlers(
	ipcMain: IpcMain,
	options: RegisterOptions = {},
): void {
	const env = options.env ?? process.env;
	const paths = options.paths ?? resolvePaths(env);
	const setupRegistry = options.setupRegistry ?? createSetupSessionRegistry();
	const appServices =
		options.appServices ??
		(options.kokoroSetupRunner
			? createInjectedAppServiceClient(paths, options.kokoroSetupRunner)
			: createBridgeAppServiceClient(env));
	const eventSubscriptions = new Map<string, () => void>();
	let nextSubscription = 0;
	const capsuleController =
		options.capsuleController ??
		createCapsuleController({ create() {}, destroy() {}, focusConsole() {} });

	ipcMain.handle(AGENT_VOICE_CHANNELS.statusGet, () =>
		appServices.invoke("status.get"),
	);
	ipcMain.handle(AGENT_VOICE_CHANNELS.daemonStart, () =>
		appServices.invoke("daemon.start"),
	);
	ipcMain.handle(AGENT_VOICE_CHANNELS.daemonStop, () =>
		appServices.invoke("daemon.stop"),
	);
	ipcMain.handle(AGENT_VOICE_CHANNELS.voiceTest, (_event, payload) => {
		const input = validateIpcPayload("voice.test", payload) as {
			text?: string;
		};
		return appServices.invoke("voice.test", { text: input.text });
	});
	ipcMain.handle(AGENT_VOICE_CHANNELS.voiceSpeakLatest, () =>
		appServices.invoke("voice.speakLatest"),
	);
	ipcMain.handle(AGENT_VOICE_CHANNELS.kokoroStatus, () =>
		appServices.invoke("kokoro.status"),
	);
	ipcMain.handle(AGENT_VOICE_CHANNELS.kokoroSetupStart, (_event, payload) => {
		const input = validateIpcPayload("kokoro.setup.start", payload) as {
			consentToken: string;
		};
		const session = setupRegistry.start(input);
		void (async () => {
			try {
				await appServices.invoke(
					"kokoro.setup.run",
					{ consentToken: input.consentToken },
					session.emit,
				);
			} finally {
				setupRegistry.finish(session.sessionId);
			}
		})();
		return ok({ sessionId: session.sessionId });
	});
	ipcMain.handle(AGENT_VOICE_CHANNELS.kokoroSetupCancel, (_event, payload) => {
		const input = validateIpcPayload("kokoro.setup.cancel", payload) as {
			sessionId: string;
		};
		return ok(setupRegistry.cancel(input.sessionId));
	});
	ipcMain.handle(AGENT_VOICE_CHANNELS.historyList, (_event, payload) => {
		const input = validateIpcPayload("history.list", payload) as {
			limit?: number;
			before?: string;
		};
		return appServices.invoke("history.list", input);
	});
	ipcMain.handle(AGENT_VOICE_CHANNELS.queueClearActive, () =>
		appServices.invoke("queue.clearActive"),
	);
	ipcMain.handle(AGENT_VOICE_CHANNELS.queueClearFailed, () =>
		appServices.invoke("queue.clearFailed"),
	);
	ipcMain.handle(AGENT_VOICE_CHANNELS.diagnosticsSnapshot, () =>
		appServices.invoke("diagnostics.snapshot"),
	);
	ipcMain.handle(AGENT_VOICE_CHANNELS.hooksInstall, (_event, payload) => {
		const input = validateIpcPayload("hooks.install", payload) as {
			agent: string;
		};
		return appServices.invoke("hooks.install", { agent: input.agent });
	});
	ipcMain.handle(AGENT_VOICE_CHANNELS.hooksUninstall, (_event, payload) => {
		const input = validateIpcPayload("hooks.uninstall", payload) as {
			agent: string;
		};
		return appServices.invoke("hooks.uninstall", { agent: input.agent });
	});
	ipcMain.handle(AGENT_VOICE_CHANNELS.configGet, () =>
		appServices.invoke("config.get"),
	);
	ipcMain.handle(AGENT_VOICE_CHANNELS.configUpdate, (_event, payload) => {
		const input = validateIpcPayload("config.update", payload) as {
			mode?: string;
			thinking?: string;
			model?: string;
		};
		return appServices.invoke("config.update", input);
	});
	ipcMain.handle(AGENT_VOICE_CHANNELS.capsuleSetEnabled, async (_event, payload) => {
		const input = validateIpcPayload("capsule.setEnabled", payload) as {
			enabled: boolean;
		};
		const result = await appServices.invoke("capsule.setEnabled", {
			enabled: input.enabled,
		});
		if (isRecord(result) && result.ok === true) {
			capsuleController.setEnabled(input.enabled);
		}
		return result;
	});
	ipcMain.handle(AGENT_VOICE_CHANNELS.capsuleOpenConsole, () => {
		capsuleController.openConsole();
		return ok({ action: "openConsole" });
	});
	ipcMain.handle(AGENT_VOICE_CHANNELS.eventsSubscribe, (event, payload) => {
		const input = validateIpcPayload("events.subscribe", payload) as {
			eventName: string;
			sessionId?: string;
		};
		const channel = `${AGENT_VOICE_CHANNELS.eventsSubscribe}:${input.eventName}${
			input.sessionId ? `:${input.sessionId}` : ""
		}`;
		const subscriptionId = `subscription-${++nextSubscription}`;
		const unsubscribe = setupRegistry.subscribe(
			input.eventName,
			(eventPayload) => {
				if (!event.sender.isDestroyed())
					event.sender.send(channel, eventPayload);
			},
			input.sessionId ? { sessionId: input.sessionId } : {},
		);
		const cleanup = () => {
			unsubscribe();
			eventSubscriptions.delete(subscriptionId);
		};
		eventSubscriptions.set(subscriptionId, cleanup);
		event.sender.once("destroyed", cleanup);
		return ok({ subscribed: input.eventName, subscriptionId });
	});
	ipcMain.handle(AGENT_VOICE_CHANNELS.eventsUnsubscribe, (_event, payload) => {
		if (!isRecord(payload) || typeof payload.subscriptionId !== "string") {
			throw new Error("Invalid events.unsubscribe payload");
		}
		const cleanup = eventSubscriptions.get(payload.subscriptionId);
		if (!cleanup) return ok({ unsubscribed: false });
		cleanup();
		return ok({ unsubscribed: true });
	});
}

async function createWindow(
	BrowserWindow: typeof import("electron").BrowserWindow,
): Promise<void> {
	const preloadPath = resolve(
		dirname(fileURLToPath(import.meta.url)),
		"preload.js",
	);
	const window = new BrowserWindow(createMainWindowOptions(preloadPath));
	const rendererUrl = process.env.AGENT_VOICE_RENDERER_URL;

	if (rendererUrl) {
		await window.loadURL(rendererUrl);
		return;
	}

	await window.loadFile(resolve("dist/linux-renderer/index.html"));
}

async function bootstrapElectron(): Promise<void> {
	if (!process.versions.electron) return;
	const electron = await import("electron");
	const { app, BrowserWindow, ipcMain } = electron;
	registerIpcHandlers(ipcMain);
	await app.whenReady();
	await createWindow(BrowserWindow);
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0)
			void createWindow(BrowserWindow);
	});
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
}

void bootstrapElectron();
