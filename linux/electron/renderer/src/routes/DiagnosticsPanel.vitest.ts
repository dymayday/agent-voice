import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { installMockAgentVoice } from "../lib/test-api-mock";
import DiagnosticsPanel from "./DiagnosticsPanel.svelte";

const longFailedText = `${"A failed Codex job containing project context. ".repeat(8)}tail that should not be visible after truncation`;

const diagnosticsPreview = {
	snapshot: {
		version: 1,
		createdAt: "2026-06-21T17:00:00.000Z",
		doctor: {
			version: 1,
			checks: [
				{
					id: "daemon.running",
					ok: false,
					severity: "warning",
					message: "Daemon is not running",
					action: "Start daemon",
				},
				{
					id: "kokoro.resourceScript.exists",
					ok: true,
					severity: "info",
					message: "Bundled Kokoro setup resource exists",
				},
			],
		},
		checks: [
			{
				id: "daemon.running",
				ok: false,
				severity: "warning",
				message: "Daemon is not running",
				action: "Start daemon",
			},
			{
				id: "kokoro.resourceScript.exists",
				ok: true,
				severity: "info",
				message: "Bundled Kokoro setup resource exists",
			},
		],
		status: {
			version: 1,
			buildId: "build-2026-linux",
			daemon: { state: "stale", running: false, pid: 4412 },
			queues: { pending: 1, processing: 0, done: 9, failed: 1, skipped: 1 },
			config: { enabled: true, agents: { pi: true, claude: true, codex: true, opencode: true } },
			install: { pi: "installed", claude: "not_installed", codex: "unknown", opencode: "installed" },
			paths: {
				home: "/home/operator/.agent-voice",
				config: "/home/operator/.agent-voice/config.json",
				db: "/home/operator/.agent-voice/queue.db",
			},
			ui: { state: "needs_attention", attention: ["Daemon is not running"] },
		},
		paths: {
			home: "/home/operator/.agent-voice",
			config: "/home/operator/.agent-voice/config.json",
			db: "/home/operator/.agent-voice/queue.db",
		},
		build: { buildId: "build-2026-linux", runtime: "bun" },
		playback: {
			state: "error",
			backend: "paplay",
			checked: ["paplay", "aplay"],
			message: "Playback backend failed during the latest probe",
			lastError: "ENOENT: paplay exited before audio playback",
		},
		hooks: { pi: "installed", claude: "not_installed", codex: "unknown", opencode: "installed" },
		hookTargets: [
			{ agent: "pi", state: "installed", target: "/home/operator/.pi/extensions/agent-voice.js" },
			{ agent: "codex", state: "unknown", target: "/home/operator/.codex/hooks.json" },
		],
		failedJobs: [
			{
				id: "failed-1",
				agent: "codex",
				status: "failed",
				text: longFailedText,
				cwd: "/work/private-project",
				createdAt: "2026-06-21T16:58:00.000Z",
				finishedAt: "2026-06-21T16:59:00.000Z",
				summarizerUsed: "codex",
				lastError: "Provider timeout while summarizing",
				attempts: 2,
			},
		],
		skippedJobs: [
			{
				id: "skipped-1",
				agent: "pi",
				status: "skipped",
				text: "Skipped job text because the system was disabled.",
				createdAt: "2026-06-21T16:57:00.000Z",
				skipReason: "disabled_system",
				attempts: 0,
			},
		],
	},
	sensitivity: [
		{
			id: "local-paths",
			label: "Local filesystem paths",
			detail: "Snapshot includes Agent Voice Home and hook target paths.",
		},
		{
			id: "job-text",
			label: "Job text and logs",
			detail: "Failed/skipped job text and errors are sensitive.",
		},
		{
			id: "playback-diagnostics",
			label: "Playback diagnostics",
			detail: "Playback backend detection details may be local.",
		},
	],
};

function diagnosticsResult() {
	return { ok: true as const, value: diagnosticsPreview };
}

describe("DiagnosticsPanel", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	test("renders privacy-safe diagnostic preview sections without environment variables", async () => {
		installMockAgentVoice({
			diagnostics: {
				snapshot: vi.fn(async () => diagnosticsResult()),
			},
		});

		render(DiagnosticsPanel);

		expect(await screen.findByRole("heading", { name: /doctor summary/i })).toBeInTheDocument();
		expect(screen.getByText("Daemon is not running")).toBeInTheDocument();
		expect(screen.getByText("/home/operator/.agent-voice/config.json")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: /runtime & build/i })).toBeInTheDocument();
		expect(screen.getByText("bun")).toBeInTheDocument();
		expect(screen.getByText("build-2026-linux")).toBeInTheDocument();
		expect(screen.getByText("paplay")).toBeInTheDocument();
		expect(screen.getAllByText(/ENOENT: paplay/i).length).toBeGreaterThan(0);
		expect(screen.getByText("/home/operator/.pi/extensions/agent-voice.js")).toBeInTheDocument();
		expect(screen.getAllByText("failed-1").length).toBeGreaterThan(0);
		expect(screen.getAllByText(/Provider timeout while summarizing/).length).toBeGreaterThan(0);
		expect(screen.getAllByText("skipped-1").length).toBeGreaterThan(0);
		expect(screen.getAllByText(/disabled_system/).length).toBeGreaterThan(0);
		expect(screen.getByText("Local filesystem paths")).toBeInTheDocument();
		expect(screen.getByText("Job text and logs")).toBeInTheDocument();
		expect(screen.getByText("Playback diagnostics")).toBeInTheDocument();
		expect(
			screen.getAllByText(/A failed Codex job containing project context\..*truncated/i).length,
		).toBeGreaterThan(0);
		expect(screen.queryByText(/tail that should not be visible/i)).not.toBeInTheDocument();
		expect(screen.getByLabelText(/diagnostics copy preview/i)).toHaveTextContent("failed-1");
		expect(screen.queryByText(/environment variables/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/process\.env/i)).not.toBeInTheDocument();
	});

	test("copies only after preview is visible, reports success, and restores focus", async () => {
		const writeText = vi.fn(async (_text: string) => undefined);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		installMockAgentVoice({
			diagnostics: {
				snapshot: vi.fn(async () => diagnosticsResult()),
			},
		});
		render(DiagnosticsPanel);

		const preview = await screen.findByLabelText(/diagnostics copy preview/i);
		const copyButton = screen.getByRole("button", { name: /copy diagnostics preview/i });
		copyButton.focus();
		await fireEvent.click(copyButton);

		await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		const copiedText = writeText.mock.calls.at(0)?.[0];
		expect(copiedText).toContain("failed-1");
		expect(copiedText).toBe(preview.textContent);
		expect(screen.getByText(/copied diagnostics preview/i)).toBeInTheDocument();
		expect(copyButton).toHaveFocus();
	});
});
