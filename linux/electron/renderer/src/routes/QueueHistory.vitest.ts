import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";
import QueueHistory from "./QueueHistory.svelte";
import { installMockAgentVoice } from "../lib/test-api-mock";

function success<T>(value: T) {
	return { ok: true as const, value };
}

afterEach(() => {
	cleanup();
});

const failedJob = {
	id: "job-1",
	agent: "pi",
	status: "failed" as const,
	text: "The provider failed after summarizing raw text.",
	createdAt: "2026-06-21T00:00:00.000Z",
	summary: "A failed summary",
	summarizerUsed: "pi-fast",
	lastError: "boom raw error",
	attempts: 3,
};

describe("QueueHistory", () => {
	test("renders rows, failed details, and loads more with cursor", async () => {
		const historyList = vi
			.fn()
			.mockResolvedValueOnce(
				success({
					version: 1,
					jobs: [failedJob],
					pageInfo: { limit: 10, hasMore: true, nextCursor: "cursor-1" },
				}),
			)
			.mockResolvedValueOnce(
				success({
					version: 1,
					jobs: [
						{
							id: "job-2",
							agent: "codex",
							status: "skipped",
							text: "Skipped text",
							createdAt: "2026-06-20T00:00:00.000Z",
							skipReason: "disabled_system",
							attempts: 0,
						},
					],
					pageInfo: { limit: 10, hasMore: false, nextCursor: null },
				}),
			);
		installMockAgentVoice({ history: { list: historyList } });

		render(QueueHistory);

		expect(await screen.findByText(/boom raw error/i)).toBeInTheDocument();
		expect(screen.getByText(/a failed summary/i)).toBeInTheDocument();
		expect(screen.getByText(/pi-fast/i)).toBeInTheDocument();
		await fireEvent.click(screen.getByRole("button", { name: /load more/i }));
		expect(historyList).toHaveBeenLastCalledWith({ limit: 10, before: "cursor-1" });
		expect(await screen.findByText(/disabled_system/i)).toBeInTheDocument();
	});

	test("clear active and failed require confirmation", async () => {
		const clearActive = vi.fn(async () => success({ cleared: 2 }));
		const clearFailed = vi.fn(async () => success({ cleared: 1 }));
		installMockAgentVoice({
			history: {
				list: async () =>
					success({
						version: 1,
						jobs: [failedJob],
						pageInfo: { limit: 10, hasMore: false, nextCursor: null },
					}),
			},
			queue: { clearActive, clearFailed },
		});

		render(QueueHistory);
		await screen.findByText(/boom raw error/i);

		await fireEvent.click(screen.getByRole("button", { name: /clear active/i }));
		expect(screen.getByRole("dialog")).toHaveTextContent(/irreversible removal/i);
		expect(screen.getByRole("button", { name: /remove jobs/i })).toBeDisabled();
		await fireEvent.input(screen.getByLabelText(/type clear active/i), {
			target: { value: "CLEAR ACTIVE" },
		});
		await fireEvent.click(screen.getByRole("button", { name: /remove jobs/i }));
		await waitFor(() => expect(clearActive).toHaveBeenCalledOnce());

		await waitFor(() =>
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
		);
		await fireEvent.click(screen.getByRole("button", { name: /clear failed/i }));
		await fireEvent.input(await screen.findByLabelText(/type clear failed/i), {
			target: { value: "CLEAR FAILED" },
		});
		await fireEvent.click(screen.getByRole("button", { name: /remove jobs/i }));
		await waitFor(() => expect(clearFailed).toHaveBeenCalledOnce());
	});
});
