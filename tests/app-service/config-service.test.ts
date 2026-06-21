import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config";
import { resolvePaths } from "../../src/paths";
import {
	getAppConfig,
	setCapsuleEnabled,
	updateSummarizerSettings,
} from "../../src/app-service/config-service";

function tempPaths() {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-app-service-"));
	return { home, paths: resolvePaths({ AGENT_VOICE_HOME: home }) };
}

describe("app-service config", () => {
	test("capsule defaults disabled", () => {
		const { home, paths } = tempPaths();
		try {
			expect(getAppConfig(paths).ui?.desktopCapsule?.enabled).toBe(false);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("setCapsuleEnabled persists enabled", () => {
		const { home, paths } = tempPaths();
		try {
			const result = setCapsuleEnabled(true, paths);
			expect(result).toEqual({
				ok: true,
				value: expect.objectContaining({
					ui: { desktopCapsule: { enabled: true } },
				}),
			});
			expect(getAppConfig(paths).ui?.desktopCapsule?.enabled).toBe(true);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("older config missing ui loads with capsule disabled", () => {
		const { home, paths } = tempPaths();
		try {
			writeFileSync(
				paths.config,
				JSON.stringify({ enabled: false, summarizer: { timeoutSeconds: 9 } }),
			);

			expect(loadConfig(paths).ui.desktopCapsule.enabled).toBe(false);
			expect(getAppConfig(paths).ui?.desktopCapsule?.enabled).toBe(false);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("invalid summarizer update returns typed error", () => {
		const { home, paths } = tempPaths();
		try {
			const result = updateSummarizerSettings({ thinking: "maximum" }, paths);

			expect(existsSync(paths.config)).toBe(false);
			expect(result).toEqual({
				ok: false,
				error: expect.objectContaining({
					code: "BAD_INPUT",
					message: expect.stringContaining("summarizer.thinking"),
					recoverable: true,
				}),
			});
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("valid summarizer update persists", () => {
		const { home, paths } = tempPaths();
		try {
			const result = updateSummarizerSettings(
				{ thinking: "low", mode: "heuristic" },
				paths,
			);

			expect(result.ok).toBe(true);
			const config = getAppConfig(paths);
			expect(config.summarizer?.thinking).toBe("low");
			expect(config.summarizer?.priority).toEqual(["heuristic"]);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
