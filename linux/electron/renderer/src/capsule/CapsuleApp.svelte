<script lang="ts">
	import { agentVoice } from "../lib/api";

	let message = $state("Ready for safe actions");

	async function openConsole(): Promise<void> {
		const result = await agentVoice.capsule.openConsole();
		message = result.ok ? "Console requested" : result.error.message;
	}

	async function speakLatest(): Promise<void> {
		const result = await agentVoice.voice.speakLatest();
		message = result.ok ? "Speak Latest requested" : result.error.message;
	}

	function viewQueue(): void {
		message = "Queue view requested";
	}
</script>

<main class="capsule" aria-label="Agent Voice Desktop Capsule">
	<p>Agent Voice</p>
	<div class="capsule-actions" aria-label="Safe capsule actions">
		<button type="button" onclick={openConsole}>Open Console</button>
		<button type="button" onclick={speakLatest}>Speak Latest</button>
		<button type="button" onclick={viewQueue}>View Queue</button>
	</div>
	<p role="status">{message}</p>
</main>

<style>
	.capsule {
		display: grid;
		gap: 0.75rem;
		min-width: 15rem;
		padding: 1rem;
		border: 1px solid rgba(87, 229, 255, 0.35);
		border-radius: 1.25rem;
		background: rgba(7, 10, 18, 0.92);
		color: #ecf6ff;
	}

	.capsule p {
		margin: 0;
	}

	.capsule-actions {
		display: grid;
		gap: 0.5rem;
	}

	button {
		border: 1px solid rgba(148, 163, 184, 0.28);
		border-radius: 0.85rem;
		padding: 0.65rem 0.75rem;
		background: rgba(15, 23, 42, 0.8);
		color: #ecf6ff;
		font-weight: 800;
	}
</style>
