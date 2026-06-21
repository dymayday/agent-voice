import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import type { SystemStatus } from "../../src/app-service/types";
import { deriveFirstRunActions } from "../../src/app-service/first-run-actions";

function status(overrides: Partial<SystemStatus> = {}): SystemStatus {
	return {
		version: 1,
		buildId: null,
		daemon: { state: "running", running: true, pid: 123 },
		kokoro: { state: "ready" },
		playback: { state: "available", backend: "paplay" },
		queue: { pending: 0, processing: 0, done: 0, failed: 0, skipped: 0 },
		attention: [],
		install: {
			claude: "installed",
			codex: "installed",
			opencode: "installed",
			pi: "installed",
		},
		...overrides,
	};
}

describe("deriveFirstRunActions", () => {
	test("prioritizes playback before Kokoro setup and daemon start", () => {
		const actions = deriveFirstRunActions(
			status({ daemon: { state: "stopped", running: false, pid: null } }),
			{ playbackReady: false, kokoroReady: false },
		);

		expect(actions.map((action) => action.id)).toEqual([
			"install-playback-tool",
			"setup-kokoro",
			"start-daemon",
			"privacy-review",
		]);
	});

	test("puts Kokoro setup before daemon start when playback is ready", () => {
		const actions = deriveFirstRunActions(
			status({ daemon: { state: "stopped", running: false, pid: null } }),
			{ playbackReady: true, kokoroReady: false },
		);

		expect(actions.map((action) => action.id)).toEqual([
			"setup-kokoro",
			"start-daemon",
			"privacy-review",
		]);
	});

	test("includes daemon start when daemon is stopped", () => {
		const actions = deriveFirstRunActions(
			status({ daemon: { state: "stopped", running: false, pid: null } }),
			{ playbackReady: true, kokoroReady: true },
		);

		expect(actions.map((action) => action.id)).toContain("start-daemon");
	});

	test("includes daemon start when daemon lock is stale", () => {
		const actions = deriveFirstRunActions(
			status({ daemon: { state: "stale", running: false, pid: 123 } }),
			{ playbackReady: true, kokoroReady: true },
		);

		expect(actions.map((action) => action.id)).toContain("start-daemon");
	});

	test("includes hook install when any agent install state is not installed or unknown", () => {
		const actions = deriveFirstRunActions(
			status({
				install: {
					claude: "installed",
					codex: "unknown",
					opencode: "installed",
					pi: "not_installed",
				},
			}),
			{ playbackReady: true, kokoroReady: true },
		);

		expect(actions.map((action) => action.id)).toContain("install-hooks");
	});

	test("always appends one privacy review action", () => {
		const actions = deriveFirstRunActions(
			status({ daemon: { state: "stopped", running: false, pid: null } }),
			{ playbackReady: false, kokoroReady: false },
		);
		const ids = actions.map((action) => action.id);

		expect(ids.at(-1)).toBe("privacy-review");
		expect(ids.filter((id) => id === "privacy-review")).toHaveLength(1);
		expect(new Set(ids).size).toBe(ids.length);
		for (const action of actions) {
			expect(action.title).toEqual(expect.any(String));
			expect(action.detail).toEqual(expect.any(String));
			expect(action.cta).toEqual(expect.any(String));
		}
	});
});

describe("first-run-actions module boundary", () => {
	test("does not import Node, Bun, or app runtime modules", () => {
		const source = readFileSync(
			new URL("../../src/app-service/first-run-actions.ts", import.meta.url),
			"utf8",
		);

		expect(source).not.toContain("node:");
		expect(source).not.toContain("bun:sqlite");
		expect(source).not.toContain('from "../kokoro-setup"');
		expect(source).not.toContain("from '../kokoro-setup'");
		expect(source).not.toContain('from "../db"');
		expect(source).not.toContain("from '../db'");
		expect(source).not.toContain('from "../store"');
		expect(source).not.toContain("from '../store'");
	});
});
