import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";
import HooksPanel from "./HooksPanel.svelte";
import { installMockAgentVoice } from "../lib/test-api-mock";

function success<T>(value: T) {
	return { ok: true as const, value };
}

afterEach(() => cleanup());

describe("HooksPanel", () => {
	test("renders hook states, targets, diagnostics, and guarded actions", async () => {
		const install = vi.fn(async () => success({ message: "installed" }));
		const uninstall = vi.fn(async () => success({ message: "uninstalled" }));
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText: vi.fn(async () => undefined) },
			configurable: true,
		});
		installMockAgentVoice({
			status: {
				get: async () =>
					success({
						version: 1,
						buildId: null,
						daemon: { state: "running", running: true, pid: 123 },
						kokoro: { state: "ready" },
						playback: { state: "available", backend: "paplay" },
						queue: { pending: 0, processing: 0, done: 0, failed: 0, skipped: 0 },
						attention: [],
						install: {
							pi: "installed",
							claude: "not_installed",
							codex: "unknown",
							opencode: "unsupported",
						},
					}),
			},
			hooks: { install, uninstall },
		});

		render(HooksPanel);

		expect(await screen.findByText("Pi")).toBeInTheDocument();
		for (const name of ["Claude", "Codex", "OpenCode"]) {
			expect(screen.getByText(name)).toBeInTheDocument();
		}
		expect(screen.getByText("~/.pi/extensions/agent-voice")).toBeInTheDocument();
		expect(screen.getByText("~/.claude/settings.json")).toBeInTheDocument();
		expect(screen.getByText(/install state is unknown/i)).toBeInTheDocument();
		expect(screen.getByText(/unsupported on this system/i)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /install codex/i })).toBeDisabled();
		expect(screen.getByRole("button", { name: /install opencode/i })).toBeDisabled();

		await fireEvent.click(screen.getByRole("button", { name: /install claude/i }));
		expect(screen.getByRole("dialog")).toHaveTextContent(/claude hook at/i);
		expect(screen.getByRole("dialog")).toHaveTextContent(/~\/\.claude\/settings\.json/i);
		await fireEvent.click(screen.getByRole("button", { name: /confirm install claude/i }));
		await waitFor(() => expect(install).toHaveBeenCalledWith("claude"));

		await fireEvent.click(screen.getByRole("button", { name: /uninstall pi/i }));
		expect(screen.getByRole("dialog")).toHaveTextContent(/pi hook at/i);
		await fireEvent.click(screen.getByRole("button", { name: /confirm uninstall pi/i }));
		await waitFor(() => expect(uninstall).toHaveBeenCalledWith("pi"));

		await fireEvent.click(screen.getByRole("button", { name: /copy codex diagnostics/i }));
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
			expect.stringContaining("Codex hook diagnostics"),
		);
	});
});
