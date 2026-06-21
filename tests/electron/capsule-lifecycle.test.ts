import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	createCapsuleController,
	createDesktopCapsuleController,
} from "../../linux/electron/main";
import { AGENT_VOICE_CHANNELS } from "../../linux/electron/ipc-contract";

class FakeBrowserWindow {
	options: unknown;
	loadedUrl = "";
	closed = false;
	showCount = 0;
	focusCount = 0;
	sent: unknown[][] = [];
	private listeners = new Map<string, () => void>();
	webContents = {
		send: (...args: unknown[]) => this.sent.push(args),
	};

	constructor(options: unknown) {
		this.options = options;
	}

	loadURL(url: string): Promise<void> {
		this.loadedUrl = url;
		return Promise.resolve();
	}

	loadFile(file: string, options?: { query?: Record<string, string> }): Promise<void> {
		this.loadedUrl = options?.query?.view
			? `${file}?view=${options.query.view}`
			: file;
		return Promise.resolve();
	}

	on(event: string, listener: () => void): void {
		this.listeners.set(event, listener);
	}

	isDestroyed(): boolean {
		return this.closed;
	}

	show(): void {
		this.showCount += 1;
	}

	focus(): void {
		this.focusCount += 1;
	}

	close(): void {
		this.closed = true;
		this.listeners.get("closed")?.();
	}
}

describe("capsule lifecycle", () => {
	test("setting gates capsule creation and destruction", () => {
		const events: string[] = [];
		const controller = createCapsuleController({
			create: () => events.push("create"),
			destroy: () => events.push("destroy"),
			focusConsole: () => events.push("focus"),
		});
		controller.setEnabled(true);
		controller.setEnabled(false);
		expect(events).toEqual(["create", "destroy"]);
	});

	test("desktop capsule creates a real safe BrowserWindow and routes View Queue", () => {
		const windows: FakeBrowserWindow[] = [];
		const mainWindow = new FakeBrowserWindow({});
		class BrowserWindowFake extends FakeBrowserWindow {
			constructor(options: unknown) {
				super(options);
				windows.push(this);
			}
		}

		const controller = createDesktopCapsuleController({
			BrowserWindow: BrowserWindowFake as never,
			capsulePreloadPath: "/tmp/capsule-preload.js",
			getMainWindow: () => mainWindow as never,
			rendererUrl: "http://127.0.0.1:5173",
		});

		controller.setEnabled(true);
		expect(windows).toHaveLength(1);
		expect(windows[0].options).toMatchObject({
			width: 320,
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				preload: "/tmp/capsule-preload.js",
			},
		});
		expect(windows[0].loadedUrl).toBe("http://127.0.0.1:5173?view=capsule");

		controller.viewQueue();
		expect(mainWindow.sent).toEqual([
			[AGENT_VOICE_CHANNELS.routeNavigate, "queue-history"],
		]);
		expect(mainWindow.showCount).toBe(1);
		expect(mainWindow.focusCount).toBe(1);

		controller.setEnabled(false);
		expect(windows[0].closed).toBe(true);
	});

	test("capsule preload exposes only safe capsule actions", () => {
		const source = readFileSync("linux/electron/capsule-preload.ts", "utf8");
		expect(source).toContain("voiceSpeakLatest");
		expect(source).toContain("capsuleOpenConsole");
		expect(source).toContain("capsuleViewQueue");
		for (const forbidden of [
			"queueClearActive",
			"queueClearFailed",
			"daemonStop",
			"hooksInstall",
			"hooksUninstall",
			"configUpdate",
		]) {
			expect(source).not.toContain(forbidden);
		}
	});

	test("capsule action surface excludes destructive actions", () => {
		const controller = createCapsuleController({
			create() {},
			destroy() {},
			focusConsole() {},
		});
		expect(controller.allowedActions()).toEqual([
			"openConsole",
			"speakLatest",
			"viewQueue",
		]);
		expect(controller.allowedActions()).not.toContain("clearFailed");
		expect(controller.allowedActions()).not.toContain("installHook");
	});
});
