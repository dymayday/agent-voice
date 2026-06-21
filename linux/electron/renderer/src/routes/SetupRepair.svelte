<script lang="ts">
	import { onDestroy, onMount, tick } from "svelte";
	import { getAgentVoice } from "../lib/api";

	type Phase = "idle" | "starting" | "running" | "done" | "error" | "cancelled";
	type UnknownRecord = Record<string, unknown>;

	let statusHeading: HTMLHeadingElement | undefined;
	let phase = $state<Phase>("idle");
	let consentGranted = $state(false);
	let statusMessage = $state("Checking managed Kokoro status…");
	let managedHome = $state<string | null>(null);
	let statusChecks = $state<Array<{ id: string; ok: boolean; message: string }>>([]);
	let activeSessionId = $state<string | null>(null);
	let progressLines = $state<string[]>([]);
	let failedDiagnostics = $state<string | null>(null);
	let sessionError = $state<string | null>(null);
	let cancellationMessage = $state<string | null>(null);
	let unsubscribeSetup: (() => void) | null = null;

	const startLabel = $derived(phase === "error" ? "Retry setup" : "Start setup");
	const canStart = $derived(consentGranted && phase !== "starting" && phase !== "running");

	function isRecord(value: unknown): value is UnknownRecord {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}

	function messageFromResult(result: unknown, fallback: string): string {
		if (
			isRecord(result) &&
			result.ok === false &&
			isRecord(result.error) &&
			typeof result.error.message === "string"
		) {
			return result.error.message;
		}
		return fallback;
	}

	function resultValue<T = unknown>(result: unknown): T | null {
		if (isRecord(result) && result.ok === true && "value" in result) {
			return result.value as T;
		}
		return null;
	}

	function appendProgress(line: string): void {
		progressLines = [...progressLines, line];
	}

	function stopListening(): void {
		unsubscribeSetup?.();
		unsubscribeSetup = null;
	}

	function clearActiveSession(): void {
		stopListening();
		activeSessionId = null;
	}

	async function focusStatusHeading(): Promise<void> {
		await tick();
		statusHeading?.focus();
	}

	async function loadStatus(): Promise<void> {
		try {
			const result = await getAgentVoice().kokoro.status();
			const value = resultValue<{
				installed?: boolean;
				managedHome?: string;
				checks?: Array<{ id: string; ok: boolean; message: string }>;
			}>(result);
			if (!value) {
				statusMessage = messageFromResult(
					result,
					"Unable to read managed Kokoro status.",
				);
				return;
			}
			managedHome = typeof value.managedHome === "string" ? value.managedHome : null;
			statusChecks = Array.isArray(value.checks) ? value.checks : [];
			statusMessage = value.installed
				? "Managed Kokoro is installed and ready."
				: "Managed Kokoro setup is not complete.";
		} catch (error) {
			statusMessage = error instanceof Error ? error.message : String(error);
		}
	}

	function rendererConsentToken(): string {
		return `renderer-consent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	}

	function setupEventLine(event: unknown): string {
		if (!isRecord(event) || typeof event.type !== "string") {
			return "Received setup event with an unknown shape.";
		}
		if (event.type === "log") {
			const stream = typeof event.stream === "string" ? event.stream : "log";
			const message = typeof event.message === "string" ? event.message : "";
			return `${stream}: ${message}`.trim();
		}
		if (event.type === "step") {
			const title = typeof event.title === "string" ? event.title : "Setup step";
			const status = typeof event.status === "string" ? event.status : "updated";
			const error = typeof event.error === "string" ? ` — ${event.error}` : "";
			return `${title}: ${status}${error}`;
		}
		if (event.type === "complete") {
			return event.ok === true
				? "Setup complete."
				: `Setup failed: ${typeof event.error === "string" ? event.error : "unknown error"}`;
		}
		return `Received setup event: ${event.type}`;
	}

	function failForSession(message: string): void {
		sessionError = message;
		phase = "error";
		clearActiveSession();
		void focusStatusHeading();
	}

	function handleSetupEvent(event: unknown): void {
		appendProgress(setupEventLine(event));
		if (!isRecord(event)) return;
		if (event.type === "step" && typeof event.error === "string") {
			failedDiagnostics = event.error;
		}
		if (event.type !== "complete") return;

		clearActiveSession();
		if (event.ok === true) {
			phase = "done";
			statusMessage = "Setup complete.";
			void loadStatus();
		} else {
			phase = "error";
			failedDiagnostics =
				typeof event.error === "string"
					? event.error
					: "Kokoro setup failed without detailed diagnostics.";
		}
		void focusStatusHeading();
	}

	function handleSetupEnvelope(payload: unknown): void {
		if (!isRecord(payload) || typeof payload.sessionId !== "string") {
			failForSession("Received a setup progress event without a session id.");
			return;
		}
		if (payload.sessionId !== activeSessionId) {
			failForSession(
				`Received setup progress for a different setup session (${payload.sessionId}).`,
			);
			return;
		}
		handleSetupEvent(payload.event);
	}

	async function startSetup(): Promise<void> {
		if (!consentGranted) {
			sessionError = "Consent is required before managed Kokoro setup can start.";
			await focusStatusHeading();
			return;
		}

		phase = "starting";
		sessionError = null;
		cancellationMessage = null;
		progressLines = [];
		clearActiveSession();

		try {
			const result = await getAgentVoice().kokoro.setup.start({
				consentToken: rendererConsentToken(),
			});
			const value = resultValue<{ sessionId?: string }>(result);
			if (!value || typeof value.sessionId !== "string") {
				phase = "error";
				failedDiagnostics = messageFromResult(
					result,
					"Kokoro setup did not return a session id.",
				);
				await focusStatusHeading();
				return;
			}
			activeSessionId = value.sessionId;
			unsubscribeSetup = getAgentVoice().events.subscribe(
				"kokoro.setup",
				handleSetupEnvelope,
				{ sessionId: value.sessionId },
			);
			phase = "running";
			appendProgress(`Session ${value.sessionId} started.`);
		} catch (error) {
			phase = "error";
			failedDiagnostics = error instanceof Error ? error.message : String(error);
			await focusStatusHeading();
		}
	}

	async function cancelSetup(): Promise<void> {
		if (!activeSessionId) {
			failForSession("Cannot cancel setup because no setup session is active.");
			return;
		}

		const sessionId = activeSessionId;
		try {
			const result = await getAgentVoice().kokoro.setup.cancel(sessionId);
			if (isRecord(result) && result.ok === false) {
				phase = "error";
				failedDiagnostics = messageFromResult(result, "Unable to cancel setup.");
				await focusStatusHeading();
				return;
			}
			phase = "cancelled";
			clearActiveSession();
			cancellationMessage = `Cancel requested for ${sessionId}. This is best-effort: Agent Voice stops listening to this setup stream, but an already-running managed uv or Python process may finish in the background.`;
			appendProgress(`Cancel requested for ${sessionId}; listener detached.`);
			await focusStatusHeading();
		} catch (error) {
			phase = "error";
			failedDiagnostics = error instanceof Error ? error.message : String(error);
			await focusStatusHeading();
		}
	}

	onMount(() => {
		void loadStatus();
	});

	onDestroy(() => {
		stopListening();
	});
</script>

<section class="route-panel setup-repair" aria-labelledby="setup-repair-heading">
	<p class="eyebrow">Recovery</p>
	<h2 id="setup-repair-heading" tabindex="-1" bind:this={statusHeading}>
		Setup &amp; Repair
	</h2>
	<p class="status-line">{statusMessage}</p>

	{#if managedHome}
		<dl class="status-details" aria-label="Managed Kokoro paths">
			<div>
				<dt>Agent Voice Home</dt>
				<dd>{managedHome}</dd>
			</div>
		</dl>
	{/if}

	{#if statusChecks.length > 0}
		<ul class="check-list" aria-label="Kokoro setup checks">
			{#each statusChecks as check}
				<li class:ok={check.ok}>
					<strong>{check.id}</strong>: {check.message}
				</li>
			{/each}
		</ul>
	{/if}

	<div class="consent-card" aria-labelledby="consent-heading">
		<h3 id="consent-heading">Managed setup consent</h3>
		<ul>
			<li>Managed uv: Agent Voice may install and run its managed uv tool.</li>
			<li>Python dependencies: setup creates a managed virtual environment.</li>
			<li>Model files: Kokoro model files may be downloaded and cached.</li>
			<li>Network access is used for downloads when required.</li>
			<li>Disk space is used under Agent Voice Home for tools, dependencies, and cached assets.</li>
		</ul>
		<label class="consent-toggle">
			<input
				type="checkbox"
				bind:checked={consentGranted}
				disabled={phase === "starting" || phase === "running"}
			/>
			<span>I consent to managed Kokoro setup using Agent Voice Home.</span>
		</label>
	</div>

	<div class="setup-actions">
		<button type="button" onclick={startSetup} disabled={!canStart}>{startLabel}</button>
		{#if phase === "running"}
			<button type="button" class="secondary" onclick={cancelSetup}>Cancel setup</button>
		{/if}
	</div>
	{#if !consentGranted}
		<p class="hint">Consent is required before setup can start.</p>
	{/if}

	{#if activeSessionId}
		<p class="session-chip">Active session: {activeSessionId}</p>
	{/if}
	{#if cancellationMessage}
		<p class="notice" role="status">{cancellationMessage}</p>
	{/if}
	{#if sessionError}
		<div class="alert" role="alert">{sessionError}</div>
	{/if}
	{#if failedDiagnostics}
		<div class="alert" role="alert" aria-label="Failed diagnostics">
			<h3>Failed diagnostics</h3>
			<p>{failedDiagnostics}</p>
		</div>
	{/if}

	<div class="progress-log" role="log" aria-live="polite" aria-label="Setup progress">
		{#if progressLines.length === 0}
			<p>No setup progress yet.</p>
		{:else}
			<ol>
				{#each progressLines as line}
					<li>{line}</li>
				{/each}
			</ol>
		{/if}
	</div>
</section>

<style>
	.setup-repair {
		display: grid;
		gap: 1rem;
	}

	.status-line,
	.hint,
	.session-chip,
	.notice {
		margin: 0;
	}

	.status-details {
		margin: 0;
		padding: 0.9rem 1rem;
		border: 1px solid rgba(148, 163, 184, 0.2);
		border-radius: 1rem;
		background: rgba(15, 23, 42, 0.55);
	}

	.status-details div {
		display: grid;
		gap: 0.25rem;
	}

	dt {
		color: #57e5ff;
		font-weight: 800;
	}

	dd {
		margin: 0;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		word-break: break-word;
	}

	.check-list,
	.consent-card ul {
		margin: 0;
		padding-left: 1.2rem;
	}

	.check-list li,
	.consent-card li {
		margin: 0.35rem 0;
	}

	.check-list li::marker {
		color: #ffbd5a;
	}

	.check-list li.ok::marker {
		color: #8cff6b;
	}

	.consent-card {
		padding: 1rem;
		border: 1px solid rgba(87, 229, 255, 0.25);
		border-radius: 1.2rem;
		background: rgba(87, 229, 255, 0.08);
	}

	.consent-card h3,
	.alert h3 {
		margin: 0 0 0.65rem;
	}

	.consent-toggle {
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
		margin-top: 0.9rem;
		font-weight: 800;
	}

	.consent-toggle input {
		margin-top: 0.25rem;
		accent-color: #57e5ff;
	}

	.setup-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.setup-actions button {
		border: 0;
		border-radius: 0.9rem;
		padding: 0.75rem 1rem;
		background: linear-gradient(135deg, #57e5ff, #ff6bd6);
		color: #051018;
		font-weight: 900;
	}

	.setup-actions button.secondary {
		border: 1px solid rgba(255, 189, 90, 0.45);
		background: rgba(255, 189, 90, 0.1);
		color: #ffe1ad;
	}

	.setup-actions button:disabled {
		cursor: not-allowed;
		filter: grayscale(1);
		opacity: 0.58;
	}

	.hint,
	.session-chip,
	.notice {
		color: #a9b6c7;
	}

	.alert {
		padding: 1rem;
		border: 1px solid rgba(255, 107, 107, 0.45);
		border-radius: 1rem;
		background: rgba(255, 107, 107, 0.1);
		color: #ffd6d6;
	}

	.alert p {
		margin: 0;
	}

	.progress-log {
		min-height: 4rem;
		padding: 1rem;
		border: 1px solid rgba(148, 163, 184, 0.2);
		border-radius: 1rem;
		background: rgba(2, 6, 23, 0.45);
	}

	.progress-log p,
	.progress-log ol {
		margin: 0;
	}

	.progress-log ol {
		padding-left: 1.25rem;
	}
</style>
