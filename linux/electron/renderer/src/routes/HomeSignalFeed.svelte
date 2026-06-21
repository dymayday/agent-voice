<script lang="ts">
	import { onMount } from "svelte";
	import type { SystemStatus } from "../../../../../src/app-service";
	import StatusBadge from "../components/StatusBadge.svelte";
	import { agentVoice } from "../lib/api";

	interface FirstRunAction {
		id: string;
		title: string;
		detail: string;
		cta?: string;
	}

	type StatusWithActions = SystemStatus & {
		firstRunActions?: FirstRunAction[];
	};

	let status = $state<StatusWithActions | null>(null);
	let loading = $state(true);
	let error = $state("");
	let actionMessage = $state("");
	let diagnosticsRequested = $state(false);

	function titleCase(value: string): string {
		return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
	}

	function toneForState(
		state: string,
	): "ready" | "warning" | "danger" | "neutral" {
		if (["running", "ready", "available"].includes(state)) return "ready";
		if (["missing", "stopped", "stale", "installing"].includes(state))
			return "warning";
		if (state === "error") return "danger";
		return "neutral";
	}

	function actionsFromStatus(current: StatusWithActions): FirstRunAction[] {
		if (Array.isArray(current.firstRunActions)) return current.firstRunActions;
		return current.attention.map((message, index) => ({
			id: `attention-${index}`,
			title: message,
			detail: "Review this degraded status before relying on speech output.",
		}));
	}

	async function loadStatus(): Promise<void> {
		loading = true;
		error = "";
		try {
			const result = await agentVoice.status.get();
			if (result.ok) status = result.value as StatusWithActions;
			else error = result.error.message;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			loading = false;
		}
	}

	async function speakLatest(): Promise<void> {
		actionMessage = "";
		const result = await agentVoice.voice.speakLatest();
		actionMessage = result.ok
			? "Speak Latest requested"
			: result.error.message;
	}

	async function runVoiceTest(): Promise<void> {
		actionMessage = "";
		const result = await agentVoice.voice.test("Agent Voice Linux sound check.");
		actionMessage = result.ok ? "Voice Test requested" : result.error.message;
	}

	function openDiagnostics(): void {
		diagnosticsRequested = true;
		actionMessage = "Diagnostics panel requested";
	}

	onMount(() => {
		void loadStatus();
	});
</script>

<section class="route-panel signal-feed" aria-labelledby="home-heading">
	<p class="eyebrow">Signal Feed</p>
	<h2 id="home-heading" tabindex="-1">Home</h2>
	<p class="route-intro">
		Live daemon, queue, playback, and first-run status for the Linux Operator Console.
	</p>

	{#if loading}
		<p role="status">Loading status…</p>
	{:else if error}
		<div class="notice danger" role="alert">{error}</div>
	{:else if status}
		<div class="status-grid" aria-label="System status">
			<StatusBadge
				label="Daemon"
				value={`Daemon ${status.daemon.state}`}
				detail={status.daemon.pid ? `PID ${status.daemon.pid}` : "No active daemon PID"}
				tone={toneForState(status.daemon.state)}
			/>
			<StatusBadge
				label="Kokoro"
				value={`Kokoro ${status.kokoro.state}`}
				detail={status.kokoro.message ?? status.kokoro.voice ?? "Managed local voice"}
				tone={toneForState(status.kokoro.state)}
			/>
			<StatusBadge
				label="Playback"
				value={`Playback ${status.playback.state}`}
				detail={status.playback.message ?? status.playback.backend ?? "System playback probe"}
				tone={toneForState(status.playback.state)}
			/>
		</div>

		<div class="queue-strip" aria-label="Queue counts">
			{#each Object.entries(status.queue) as [name, count]}
				<div>
					<span>{titleCase(name)}</span>
					<strong>{count}</strong>
				</div>
			{/each}
		</div>

		<section class="action-panel" aria-labelledby="first-run-heading">
			<h3 id="first-run-heading">First-run and degraded actions</h3>
			{#if actionsFromStatus(status).length > 0}
				<div class="action-list">
					{#each actionsFromStatus(status) as action}
						<article class="action-card">
							<h4>{action.title}</h4>
							<p>{action.detail}</p>
							{#if action.cta}
								<span>{action.cta}</span>
							{/if}
						</article>
					{/each}
				</div>
			{:else}
				<p>All first-run checks look ready.</p>
			{/if}
		</section>
	{/if}

	<div class="safe-actions" aria-label="Safe actions">
		<button type="button" onclick={speakLatest}>Speak Latest</button>
		<button type="button" onclick={runVoiceTest}>Voice Test</button>
		<button type="button" onclick={openDiagnostics}>Open Diagnostics</button>
	</div>

	{#if actionMessage}
		<p class="notice" role="status">{actionMessage}</p>
	{:else if diagnosticsRequested}
		<p class="notice" role="status">Diagnostics panel requested</p>
	{/if}
</section>

<style>
	.signal-feed {
		display: grid;
		gap: 1.25rem;
	}

	.route-intro {
		max-width: 48rem;
		color: #a9b6c7;
	}

	.status-grid,
	.action-list,
	.safe-actions {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.85rem;
	}

	.queue-strip {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
		gap: 0.65rem;
	}

	.queue-strip div,
	.action-card,
	.notice {
		border: 1px solid rgba(148, 163, 184, 0.22);
		border-radius: 1rem;
		padding: 1rem;
		background: rgba(15, 23, 42, 0.64);
	}

	.queue-strip span,
	.action-card p {
		color: #a9b6c7;
	}

	.queue-strip span,
	.queue-strip strong {
		display: block;
	}

	.queue-strip strong {
		font-size: 1.6rem;
	}

	.action-panel h3,
	.action-card h4 {
		margin-top: 0;
	}

	.action-card span {
		color: #57e5ff;
		font-weight: 800;
	}

	.safe-actions button {
		border: 1px solid rgba(87, 229, 255, 0.4);
		border-radius: 1rem;
		padding: 0.85rem 1rem;
		background: rgba(87, 229, 255, 0.12);
		color: #ecf6ff;
		font-weight: 850;
	}

	.notice {
		margin: 0;
		color: #dbeafe;
	}

	.notice.danger {
		border-color: rgba(255, 107, 146, 0.55);
		color: #fecdd3;
	}
</style>
