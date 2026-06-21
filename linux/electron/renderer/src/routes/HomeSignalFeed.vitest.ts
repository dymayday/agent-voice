import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installMockAgentVoice } from "../lib/test-api-mock";
import type { AgentVoiceRendererApi } from "../lib/types";
import HomeSignalFeed from "./HomeSignalFeed.svelte";

const ok = <T>(value: T) => ({ ok: true as const, value });

function statusPayload() {
	return {
		version: 1 as const,
		buildId: "dev-build",
		daemon: { state: "stopped" as const, running: false, pid: null },
		kokoro: { state: "missing" as const, message: "Kokoro voice is missing." },
		playback: {
			state: "missing" as const,
			message: "Install paplay or aplay.",
		},
		queue: { pending: 2, processing: 1, done: 4, failed: 1, skipped: 0 },
		attention: ["Playback backend missing", "Kokoro setup required"],
		firstRunActions: [
			{
				id: "setup-kokoro",
				title: "Set up Kokoro voice",
				detail: "Install managed local speech assets.",
				cta: "Set up Kokoro",
			},
		],
	};
}

describe("HomeSignalFeed", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	test("renders status, degraded action, safe actions, and hides pause/resume", async () => {
		installMockAgentVoice({
			status: { get: vi.fn(async () => ok(statusPayload())) },
		});

		render(HomeSignalFeed);

		expect(await screen.findByText("Signal Feed"))
			.toBeInTheDocument();
		expect(await screen.findByText("Daemon stopped"))
			.toBeInTheDocument();
		expect(screen.getByText("Kokoro missing")).toBeInTheDocument();
		expect(screen.getByText("Playback missing")).toBeInTheDocument();
		expect(screen.getByText("Pending")).toBeInTheDocument();
		expect(screen.getByText("2")).toBeInTheDocument();
		expect(screen.getByText("Set up Kokoro voice")).toBeInTheDocument();
		expect(screen.getByText("Install managed local speech assets.")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Speak Latest" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Voice Test" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Open Diagnostics" }),
		).toBeInTheDocument();
		expect(screen.queryByText(/pause/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/resume/i)).not.toBeInTheDocument();
	});

	test("Speak Latest and Voice Test call the preload API", async () => {
		const speakLatest = vi.fn(async () => ok({ spoken: true }));
		const testVoice = vi.fn(async () => ok({ status: "played" }));
		installMockAgentVoice({
			status: { get: vi.fn(async () => ok(statusPayload())) },
			voice: {
				speakLatest,
				test: testVoice,
			} as Partial<AgentVoiceRendererApi["voice"]> as AgentVoiceRendererApi["voice"],
		});

		render(HomeSignalFeed);
		await screen.findByText("Daemon stopped");

		await fireEvent.click(screen.getByRole("button", { name: "Speak Latest" }));
		await fireEvent.click(screen.getByRole("button", { name: "Voice Test" }));

		expect(speakLatest).toHaveBeenCalledTimes(1);
		expect(testVoice).toHaveBeenCalledWith("Agent Voice Linux sound check.");
	});

	test("Open Diagnostics shows route-local visual feedback", async () => {
		installMockAgentVoice({
			status: { get: vi.fn(async () => ok(statusPayload())) },
		});

		render(HomeSignalFeed);
		await screen.findByText("Daemon stopped");
		await fireEvent.click(screen.getByRole("button", { name: "Open Diagnostics" }));

		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent(
				"Diagnostics panel requested",
			),
		);
	});
});
