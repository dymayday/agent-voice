<script lang="ts">
	interface Props {
		kind: "local" | "provider";
		label?: string;
	}

	let { kind, label = kind === "local" ? "Local only" : "Provider backed" }: Props = $props();
</script>

<span class={`privacy-label ${kind}`}>
	<span aria-hidden="true">{kind === "local" ? "●" : "◆"}</span>
	{label}
</span>

<style>
	.privacy-label {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		width: fit-content;
		border: 1px solid rgba(148, 163, 184, 0.24);
		border-radius: 999px;
		padding: 0.25rem 0.55rem;
		font-size: 0.82rem;
		font-weight: 850;
	}

	.privacy-label.local {
		border-color: rgba(140, 255, 107, 0.42);
		color: #d9ffcf;
	}

	.privacy-label.provider {
		border-color: rgba(255, 203, 107, 0.48);
		color: #ffe2ad;
	}
</style>
