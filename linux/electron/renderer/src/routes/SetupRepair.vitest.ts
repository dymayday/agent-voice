import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";

import { installMockAgentVoice } from "../lib/test-api-mock";
import SetupRepair from "./SetupRepair.svelte";

const ok = <T>(value: T) => ({ ok: true as const, value });
const fail = (message: string) => ({
	ok: false as const,
	error: { code: "INTERNAL" as const, message, recoverable: true },
});
type SetupStartResult =
	| ReturnType<typeof ok<{ sessionId: string }>>
	| ReturnType<typeof fail>;

function setupApi() {
	let setupListener: ((payload: unknown) => void) | undefined;
	const unsubscribe = vi.fn();
	const status = vi.fn(async () =>
		ok({
			managedHome: "/tmp/agent-voice/kokoro",
			installed: false,
			scriptPath: "/tmp/agent-voice/kokoro/kokoro.py",
			pythonPath: "/tmp/agent-voice/kokoro/.venv/bin/python",
			resourceScriptPath: "/repo/resources/kokoro.py",
			resourceScriptExists: true,
			lockPath: "/tmp/agent-voice/kokoro/setup.lock",
			checks: [{ id: "deps", ok: false, message: "Python dependencies missing" }],
		}),
	);
	const start = vi.fn(async (): Promise<SetupStartResult> =>
		ok({ sessionId: "session-1" }),
	);
	const cancel = vi.fn(async () => ok({ cancelled: true }));
	const subscribe = vi.fn((_eventName, listener, _options) => {
		setupListener = listener;
		return unsubscribe;
	});

	installMockAgentVoice({
		kokoro: {
			status,
			setup: { start, cancel },
		},
		events: { subscribe },
	});

	return {
		status,
		start,
		cancel,
		subscribe,
		unsubscribe,
		emit: (payload: unknown) => setupListener?.(payload),
	};
}

async function consentAndStart() {
	await fireEvent.click(screen.getByLabelText(/i consent/i));
	await fireEvent.click(screen.getByRole("button", { name: /start setup/i }));
	await waitFor(() =>
		expect(screen.getByRole("button", { name: /cancel setup/i })).toBeEnabled(),
	);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("Setup & Repair route", () => {
	test("loads Kokoro status and renders explicit managed setup consent copy", async () => {
		const api = setupApi();
		render(SetupRepair);

		expect(await screen.findByText(/managed uv/i)).toBeInTheDocument();
		expect(screen.getByText(/python dependencies/i)).toBeInTheDocument();
		expect(screen.getByText(/model files/i)).toBeInTheDocument();
		expect(screen.getByText(/network/i)).toBeInTheDocument();
		expect(screen.getByText(/disk/i)).toBeInTheDocument();
		expect(screen.getAllByText(/Agent Voice Home/i).length).toBeGreaterThan(0);
		expect(await screen.findByText(/\/tmp\/agent-voice\/kokoro/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /start setup/i })).toBeDisabled();
		expect(api.status).toHaveBeenCalledTimes(1);
	});

	test("does not start setup until consent is checked", async () => {
		const api = setupApi();
		render(SetupRepair);
		const startButton = await screen.findByRole("button", { name: /start setup/i });

		await fireEvent.click(startButton);

		expect(startButton).toBeDisabled();
		expect(api.start).not.toHaveBeenCalled();
	});

	test("starts setup with consent and subscribes to the returned session progress stream", async () => {
		const api = setupApi();
		render(SetupRepair);

		await consentAndStart();
		api.emit({
			sessionId: "session-1",
			event: { type: "log", stream: "stdout", message: "installing deps" },
		});

		expect(api.start).toHaveBeenCalledWith({
			consentToken: expect.stringMatching(/^renderer-consent-/),
		});
		expect(api.subscribe).toHaveBeenCalledWith(
			"kokoro.setup",
			expect.any(Function),
			{ sessionId: "session-1" },
		);
		await waitFor(() =>
			expect(
				screen.getByRole("log", { name: /setup progress/i }),
			).toHaveTextContent(/stdout: installing deps/),
		);
	});

	test("cancel sends the active session id and explains best-effort cancellation", async () => {
		const api = setupApi();
		render(SetupRepair);
		await consentAndStart();

		await fireEvent.click(screen.getByRole("button", { name: /cancel setup/i }));

		expect(api.cancel).toHaveBeenCalledWith("session-1");
		expect(api.unsubscribe).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("status")).toHaveTextContent(/best-effort/i);
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole("heading", { name: /setup & repair/i }),
			),
		);
	});

	test("renders missing and wrong session stream errors", async () => {
		const api = setupApi();
		render(SetupRepair);
		await consentAndStart();

		api.emit({ event: { type: "log", stream: "stdout", message: "lost" } });
		expect(await screen.findByText(/without a session id/i)).toBeInTheDocument();
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole("heading", { name: /setup & repair/i }),
			),
		);

		cleanup();
		const secondApi = setupApi();
		render(SetupRepair);
		await consentAndStart();
		secondApi.emit({
			sessionId: "other-session",
			event: { type: "log", stream: "stdout", message: "wrong" },
		});

		expect(
			await screen.findByText(/different setup session/i),
		).toBeInTheDocument();
	});

	test("failed diagnostics survive retry and error focus moves to the status heading", async () => {
		const api = setupApi();
		render(SetupRepair);
		await consentAndStart();

		api.emit({
			sessionId: "session-1",
			event: { type: "complete", ok: false, error: "uv download checksum mismatch" },
		});

		expect(
			within(await screen.findByRole("alert", { name: /failed diagnostics/i })).getByText(
				/uv download checksum mismatch/i,
			),
		).toBeInTheDocument();
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole("heading", { name: /setup & repair/i }),
			),
		);

		await fireEvent.click(screen.getByRole("button", { name: /retry setup/i }));

		expect(api.start).toHaveBeenCalledTimes(2);
		expect(
			within(screen.getByRole("alert", { name: /failed diagnostics/i })).getByText(
				/uv download checksum mismatch/i,
			),
		).toBeInTheDocument();
	});

	test("successful completion focuses the status heading", async () => {
		const api = setupApi();
		render(SetupRepair);
		await consentAndStart();

		api.emit({ sessionId: "session-1", event: { type: "complete", ok: true } });

		expect(await screen.findByText(/setup complete/i)).toBeInTheDocument();
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole("heading", { name: /setup & repair/i }),
			),
		);
	});

	test("start failures render diagnostics without clearing previous failed diagnostics", async () => {
		const api = setupApi();
		api.start.mockResolvedValueOnce(fail("network unavailable"));
		render(SetupRepair);
		await fireEvent.click(await screen.findByLabelText(/i consent/i));

		await fireEvent.click(screen.getByRole("button", { name: /start setup/i }));

		expect(await screen.findByText(/network unavailable/i)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /retry setup/i })).toBeEnabled();
	});
});
