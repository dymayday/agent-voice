import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";

import App from "./App.svelte";
import { installMockAgentVoice } from "./lib/test-api-mock";

describe("Operator Console shell", () => {
	afterEach(() => cleanup());

	test("renders Operator Rail sections and hides pause/resume", () => {
		installMockAgentVoice();
		render(App);

		expect(
			screen.getByRole("navigation", { name: /operator rail/i }),
		).toBeInTheDocument();
		for (const name of [
			"Home",
			"Voice Bench",
			"Queue & History",
			"Setup & Repair",
			"Hooks",
			"Diagnostics",
			"Settings",
		]) {
			expect(screen.getByRole("button", { name })).toBeInTheDocument();
		}
		expect(screen.queryByText(/pause/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/resume/i)).not.toBeInTheDocument();
	});

	test("accepts internal main-process route navigation events", async () => {
		installMockAgentVoice();
		render(App);

		window.dispatchEvent(
			new CustomEvent("agent-voice:navigate", { detail: "queue-history" }),
		);

		await waitFor(() =>
			expect(
				screen.getByRole("heading", { level: 1, name: "Queue & History" }),
			).toHaveFocus(),
		);
	});
});
