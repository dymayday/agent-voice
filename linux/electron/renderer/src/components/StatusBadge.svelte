<script lang="ts">
	interface Props {
		label: string;
		value: string;
		detail?: string;
		tone?: "ready" | "warning" | "danger" | "neutral";
	}

	let { label, value, detail = "", tone = "neutral" }: Props = $props();
</script>

<article class={`status-badge ${tone}`} aria-label={`${label}: ${value}`}>
	<p>{label}</p>
	<strong>{value}</strong>
	{#if detail}
		<span>{detail}</span>
	{/if}
</article>

<style>
	.status-badge {
		min-width: 0;
		border: 1px solid rgba(148, 163, 184, 0.22);
		border-radius: 1rem;
		padding: 1rem;
		background: rgba(15, 23, 42, 0.72);
	}

	.status-badge p,
	.status-badge span {
		margin: 0;
		color: #a9b6c7;
	}

	.status-badge p {
		font-size: 0.76rem;
		font-weight: 850;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.status-badge strong {
		display: block;
		margin: 0.35rem 0;
		color: #ecf6ff;
		font-size: 1.15rem;
	}

	.status-badge.ready {
		border-color: rgba(140, 255, 107, 0.42);
	}

	.status-badge.warning {
		border-color: rgba(255, 203, 107, 0.48);
	}

	.status-badge.danger {
		border-color: rgba(255, 107, 146, 0.55);
	}
</style>
