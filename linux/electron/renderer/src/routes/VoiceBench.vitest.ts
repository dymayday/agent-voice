import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import VoiceBench from "./VoiceBench.svelte";
import { installMockAgentVoice } from "../lib/test-api-mock";

function success<T>(value: T) {
	return { ok: true as const, value };
}

describe("VoiceBench", () => {
	test("renders voice controls, privacy labels, and runs a voice test", async () => {
		const voiceTest = vi.fn(async () => success({ status: "played" }));
		const update = vi.fn(async (input) =>
			success({
				summarizer: {
					mode: input.mode ?? "heuristic",
					thinking: input.thinking ?? "low",
					piModel: input.model ?? "pi-model",
				},
				tts: { voice: "af_heart" },
			}),
		);
		installMockAgentVoice({
			config: {
				get: async () => ({
					summarizer: { mode: "heuristic", thinking: "low", piModel: "pi-model" },
					tts: { voice: "af_heart" },
				}),
				update,
			},
			voice: { test: voiceTest, speakLatest: async () => success({}) },
		});

		render(VoiceBench);

		expect(await screen.findByDisplayValue("af_heart")).toBeInTheDocument();
		expect(screen.getByLabelText(/summarizer mode/i)).toHaveValue("heuristic");
		expect(screen.getByLabelText(/thinking/i)).toHaveValue("low");
		expect(screen.getByLabelText(/model/i)).toHaveValue("pi-model");
		expect(screen.getByText(/local only heuristic summaries/i)).toBeInTheDocument();
		expect(screen.getByText(/provider backed external summaries/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/decorative voice waveform/i)).toBeInTheDocument();

		await fireEvent.click(screen.getByRole("button", { name: /play voice test/i }));
		expect(voiceTest).toHaveBeenCalledWith("Agent Voice Linux sound check.");

		await fireEvent.change(screen.getByLabelText(/summarizer mode/i), {
			target: { value: "default" },
		});
		await waitFor(() => expect(update).toHaveBeenCalledWith({ mode: "default" }));

		expect(screen.queryByText(/pause/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/resume/i)).not.toBeInTheDocument();
	});
});
