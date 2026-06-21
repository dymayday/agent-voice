import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";

import App from "./App.svelte";

describe("App", () => {
	test("renders the operator console title", () => {
		render(App);

		expect(
			screen.getByText("Agent Voice Operator Console"),
		).toBeInTheDocument();
	});
});
