import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";

import App from "./App.svelte";

describe("Operator Console shell", () => {
	test("renders Operator Rail sections and hides pause/resume", () => {
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
});
