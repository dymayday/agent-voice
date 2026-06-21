<script lang="ts">
	import { onMount, tick } from "svelte";
	import ConfirmDialog from "../components/ConfirmDialog.svelte";
	import { agentVoice } from "../lib/api";

	type AgentId = "pi" | "claude" | "codex" | "opencode";
	type InstallState = "installed" | "not_installed" | "unsupported" | "unknown";
	type PendingAction = { agent: AgentId; kind: "install" | "uninstall" } | null;

	const agents: Array<{ id: AgentId; label: string; target: string }> = [
		{ id: "pi", label: "Pi", target: "~/.pi/extensions/agent-voice" },
		{ id: "claude", label: "Claude", target: "~/.claude/settings.json" },
		{ id: "codex", label: "Codex", target: "~/.codex/hooks.json" },
		{ id: "opencode", label: "OpenCode", target: "~/.config/opencode/plugin/agent-voice.js" },
	];

	let states = $state<Record<AgentId, InstallState>>({
		pi: "unknown",
		claude: "unknown",
		codex: "unknown",
		opencode: "unknown",
	});
	let loading = $state(true);
	let error = $state("");
	let message = $state("");
	let pendingAction = $state<PendingAction>(null);
	let returnFocusTo = $state<HTMLElement | null>(null);

	function labelFor(agent: AgentId): string {
		return agents.find((item) => item.id === agent)?.label ?? agent;
	}

	function targetFor(agent: AgentId): string {
		return agents.find((item) => item.id === agent)?.target ?? "target unavailable";
	}

	function stateCopy(state: InstallState): string {
		if (state === "installed") return "installed";
		if (state === "not_installed") return "not installed";
		if (state === "unsupported") return "unsupported";
		return "unknown";
	}

	function unsafeDisabledReason(state: InstallState): string {
		if (state === "unknown") return "Install state is unknown; unsafe actions are disabled until diagnostics are reviewed.";
		if (state === "unsupported") return "This hook target is unsupported on this system.";
		return "";
	}

	async function loadStates(): Promise<void> {
		loading = true;
		error = "";
		try {
			const result = await agentVoice.status.get();
			if (!result.ok) {
				error = result.error.message;
				return;
			}
			states = { ...states, ...(result.value.install ?? {}) } as Record<AgentId, InstallState>;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			loading = false;
		}
	}

	function requestAction(agent: AgentId, kind: "install" | "uninstall", event: MouseEvent): void {
		pendingAction = { agent, kind };
		returnFocusTo = event.currentTarget as HTMLElement;
	}

	function closeConfirm(): void {
		pendingAction = null;
	}

	async function confirmAction(): Promise<void> {
		if (!pendingAction) return;
		const { agent, kind } = pendingAction;
		pendingAction = null;
		message = "";
		error = "";
		const result = kind === "install"
			? await agentVoice.hooks.install(agent)
			: await agentVoice.hooks.uninstall(agent);
		if (result.ok) {
			message = `${labelFor(agent)} hook ${kind === "install" ? "installed" : "uninstalled"}.`;
			await loadStates();
			await tick();
			const renderedKind = states[agent] === "installed" ? "uninstall" : "install";
			returnFocusTo = document.querySelector<HTMLElement>(
				`[data-hook-action="${agent}-${renderedKind}"]`,
			) ?? returnFocusTo;
		} else {
			error = result.error.message;
		}
	}

	const confirmTitle = $derived(
		pendingAction
			? `Confirm ${pendingAction.kind} for ${labelFor(pendingAction.agent)}`
			: "Confirm hook change",
	);
	const confirmMessage = $derived(
		pendingAction
			? `This will ${pendingAction.kind} the ${labelFor(pendingAction.agent)} hook at ${targetFor(pendingAction.agent)}.`
			: "Confirm hook change.",
	);
	const confirmExpected = $derived(
		pendingAction
			? `${pendingAction.kind} ${labelFor(pendingAction.agent)}`.toUpperCase()
			: "CONFIRM",
	);
	const confirmLabel = $derived(
		pendingAction
			? `Confirm ${pendingAction.kind} ${labelFor(pendingAction.agent)}`
			: "Confirm hook change",
	);

	async function copyDiagnostics(agent: AgentId): Promise<void> {
		const text = `${labelFor(agent)} hook diagnostics\nState: ${stateCopy(states[agent])}\nTarget: ${targetFor(agent)}`;
		try {
			await navigator.clipboard?.writeText?.(text);
			message = `${labelFor(agent)} diagnostics copied.`;
		} catch {
			message = text;
		}
	}

	onMount(() => {
		void loadStates();
	});
</script>

<section class="route-panel hooks-panel" aria-labelledby="hooks-heading">
	<p class="eyebrow">Agent Wiring</p>
	<h2 id="hooks-heading" tabindex="-1">Hooks</h2>
	<p class="route-intro">Review and manage Pi, Claude, Codex, and OpenCode hook installs.</p>

	{#if loading}
		<p role="status">Loading hook states…</p>
	{:else}
		<div class="hook-grid" aria-label="Agent hook states">
			{#each agents as agent}
				{@const state = states[agent.id]}
				<article class={`hook-card ${state}`}>
					<header>
						<h3>{agent.label}</h3>
						<strong>{stateCopy(state)}</strong>
					</header>
					<p><span>Target path:</span> {agent.target}</p>
					{#if unsafeDisabledReason(state)}
						<p class="conflict">{unsafeDisabledReason(state)}</p>
					{/if}
					<div class="hook-actions">
						{#if state === "installed"}
							<button type="button" data-hook-action={`${agent.id}-uninstall`} onclick={(event) => requestAction(agent.id, "uninstall", event)}>Uninstall {agent.label}</button>
						{:else}
							<button
								type="button"
								disabled={state === "unknown" || state === "unsupported"}
								data-hook-action={`${agent.id}-install`}
								onclick={(event) => requestAction(agent.id, "install", event)}
							>
								Install {agent.label}
							</button>
						{/if}
						<button type="button" onclick={() => copyDiagnostics(agent.id)}>Copy {agent.label} Diagnostics</button>
					</div>
				</article>
			{/each}
		</div>
	{/if}

	<ConfirmDialog
		open={pendingAction !== null}
		title={confirmTitle}
		message={confirmMessage}
		expectedText={confirmExpected}
		{confirmLabel}
		dangerCopy="Review the hook target before changing local agent configuration files."
		{returnFocusTo}
		onConfirm={confirmAction}
		onClose={closeConfirm}
	/>

	{#if message}
		<p class="notice" role="status">{message}</p>
	{/if}
	{#if error}
		<p class="notice danger" role="alert">{error}</p>
	{/if}
</section>

<style>
	.hooks-panel {
		display: grid;
		gap: 1rem;
	}

	.route-intro,
	.hook-card p {
		color: #a9b6c7;
	}

	.hook-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 1rem;
	}

	.hook-card,
	.notice {
		border: 1px solid rgba(148, 163, 184, 0.22);
		border-radius: 1rem;
		padding: 1rem;
		background: rgba(15, 23, 42, 0.64);
	}

	.hook-card.installed {
		border-color: rgba(140, 255, 107, 0.42);
	}

	.hook-card.unknown,
	.hook-card.unsupported {
		border-color: rgba(255, 203, 107, 0.48);
	}

	.hook-card header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: baseline;
	}

	.hook-card h3,
	.notice {
		margin: 0;
	}

	.hook-card span,
	.hook-card strong {
		color: #ecf6ff;
	}

	.conflict {
		color: #ffe2ad !important;
	}

	.hook-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}

	button {
		border: 1px solid rgba(148, 163, 184, 0.28);
		border-radius: 0.85rem;
		padding: 0.65rem 0.75rem;
		background: rgba(15, 23, 42, 0.8);
		color: #ecf6ff;
		font-weight: 850;
	}

	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}


	.notice.danger {
		border-color: rgba(255, 107, 146, 0.55);
		color: #fecdd3;
	}
</style>
