import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import App from "./App.svelte";
import ConfirmDialog from "./components/ConfirmDialog.svelte";
import HomeSignalFeed from "./routes/HomeSignalFeed.svelte";
import SetupRepair from "./routes/SetupRepair.svelte";
import { installMockAgentVoice } from "./lib/test-api-mock";

function success<T>(value: T) {
	return { ok: true as const, value };
}

afterEach(() => cleanup());

describe("renderer accessibility integration", () => {
	test("route changes expose the Operator Rail landmark and focus the page heading", async () => {
		render(App);

		expect(screen.getByRole("navigation", { name: /operator rail/i })).toBeInTheDocument();
		const voiceBenchButton = screen.getByRole("button", { name: "Voice Bench" });
		await fireEvent.click(voiceBenchButton);

		const pageTitle = document.getElementById("page-title");
		await waitFor(() => expect(document.activeElement).toBe(pageTitle));
		expect(voiceBenchButton).toHaveAttribute("aria-current", "page");
	});

	test("confirmation dialogs trap focus, close on Escape, and return focus", async () => {
		const trigger = document.createElement("button");
		trigger.textContent = "Trigger clear";
		document.body.appendChild(trigger);
		trigger.focus();
		const onClose = vi.fn();
		render(ConfirmDialog, {
			open: true,
			title: "Clear active jobs",
			message: "Irreversible removal of active jobs.",
			expectedText: "CLEAR ACTIVE",
			returnFocusTo: trigger,
			onConfirm: vi.fn(),
			onClose,
		});
		const dialog = screen.getByRole("dialog");
		const input = screen.getByLabelText(/type clear active/i);
		const cancel = screen.getByRole("button", { name: /cancel/i });

		await waitFor(() => expect(document.activeElement).toBe(input));
		await fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
		expect(document.activeElement).toBe(cancel);
		await fireEvent.keyDown(dialog, { key: "Tab" });
		expect(document.activeElement).toBe(input);
		await fireEvent.keyDown(dialog, { key: "Escape" });
		expect(onClose).toHaveBeenCalledOnce();
		await waitFor(() => expect(document.activeElement).toBe(trigger));
		trigger.remove();
	});

	test("setup route exposes an aria-live progress log", async () => {
		installMockAgentVoice({
			kokoro: {
				status: async () => success({ installed: false, managedHome: "/tmp/agent-voice" }),
				setup: {
					start: async () => success({ sessionId: "session-1" }),
					cancel: async () => success({ cancelled: true }),
				},
			},
		});
		render(SetupRepair);

		const log = screen.getByRole("log", { name: /setup progress/i });
		expect(log).toHaveAttribute("aria-live", "polite");
	});

	test("reduced-motion CSS disables animations and transitions", () => {
		const css = readFileSync("linux/electron/renderer/src/app.css", "utf8");
		expect(css).toContain("prefers-reduced-motion: reduce");
		expect(css).toContain("transition-duration: 0.01ms");
		expect(css).toContain("animation-duration: 0.01ms");
	});

	test("status cards include text labels independent of color", async () => {
		installMockAgentVoice({
			status: {
				get: async () =>
					success({
						version: 1,
						buildId: null,
						daemon: { state: "running", running: true, pid: 123 },
						kokoro: { state: "missing", message: "Install Kokoro" },
						playback: { state: "available", backend: "paplay" },
						queue: { pending: 0, processing: 0, done: 0, failed: 0, skipped: 0 },
						attention: [],
					}),
			},
		});
		render(HomeSignalFeed);

		expect(await screen.findByText(/daemon running/i)).toBeInTheDocument();
		expect(screen.getByText(/kokoro missing/i)).toBeInTheDocument();
		expect(screen.getByText(/playback available/i)).toBeInTheDocument();
	});
});
