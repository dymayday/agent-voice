import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";
import ConfirmDialog from "./ConfirmDialog.svelte";

afterEach(() => {
	cleanup();
});

describe("ConfirmDialog", () => {
	test("requires confirmation text before confirming", async () => {
		const onConfirm = vi.fn();
		render(ConfirmDialog, {
			open: true,
			title: "Clear failed jobs",
			message: "Clear failed jobs with irreversible removal.",
			expectedText: "CLEAR FAILED",
			onConfirm,
			onClose: vi.fn(),
		});

		const confirm = screen.getByRole("button", { name: /confirm/i });
		expect(confirm).toBeDisabled();
		await fireEvent.input(screen.getByLabelText(/type clear failed/i), {
			target: { value: "CLEAR FAILED" },
		});
		expect(confirm).not.toBeDisabled();
		await fireEvent.click(confirm);
		expect(onConfirm).toHaveBeenCalledOnce();
	});

	test("Escape closes and returns focus to the trigger", async () => {
		const trigger = document.createElement("button");
		trigger.textContent = "Clear active";
		document.body.appendChild(trigger);
		trigger.focus();
		const onClose = vi.fn();
		render(ConfirmDialog, {
			open: true,
			title: "Clear active jobs",
			message: "Clear active jobs with irreversible removal.",
			expectedText: "CLEAR ACTIVE",
			returnFocusTo: trigger,
			onConfirm: vi.fn(),
			onClose,
		});

		await fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

		expect(onClose).toHaveBeenCalledOnce();
		await waitFor(() => expect(document.activeElement).toBe(trigger));
		trigger.remove();
	});
});
