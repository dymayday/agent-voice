import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installMockAgentVoice } from "../lib/test-api-mock";
import SettingsPanel from "./SettingsPanel.svelte";

const ok = <T>(value: T) => ({ ok: true as const, value });

function config(enabled: boolean) {
	return {
		enabled: true,
		summarizer: { mode: "default" as const, thinking: "minimal" as const, piModel: "gpt-5" },
		tts: { voice: "af_heart" },
		ui: { desktopCapsule: { enabled } },
	};
}

describe("SettingsPanel", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	test("loads config and renders the Desktop Capsule toggle without pause/resume", async () => {
		installMockAgentVoice({
			config: {
				get: vi.fn(async () => config(false)),
				update: vi.fn(async () => ok(config(false))),
			},
		});

		render(SettingsPanel);

		const toggle = await screen.findByRole("switch", {
			name: /desktop capsule/i,
		});
		expect(toggle).not.toBeChecked();
		expect(screen.getByText(/floating safe-action capsule/i)).toBeInTheDocument();
		expect(screen.queryByText(/pause/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/resume/i)).not.toBeInTheDocument();
	});

	test("Desktop Capsule toggle calls capsule.setEnabled for enable and disable", async () => {
		const setEnabled = vi
			.fn()
			.mockResolvedValueOnce(ok(config(true)))
			.mockResolvedValueOnce(ok(config(false)));
		installMockAgentVoice({
			config: {
				get: vi.fn(async () => config(false)),
				update: vi.fn(async () => ok(config(false))),
			},
			capsule: {
				setEnabled,
				openConsole: vi.fn(async () => ok({ action: "openConsole" as const })),
			},
		});

		render(SettingsPanel);
		const toggle = await screen.findByRole("switch", {
			name: /desktop capsule/i,
		});

		await fireEvent.click(toggle);
		expect(setEnabled).toHaveBeenCalledWith(true);
		expect(await screen.findByText("Desktop Capsule enabled")).toBeInTheDocument();

		await fireEvent.click(toggle);
		expect(setEnabled).toHaveBeenCalledWith(false);
		expect(await screen.findByText("Desktop Capsule disabled")).toBeInTheDocument();
	});
});
