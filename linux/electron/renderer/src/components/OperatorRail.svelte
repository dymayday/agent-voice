<script lang="ts">
	import { ROUTES, type RouteId } from "../lib/types";

	interface Props {
		activeRoute: RouteId;
		onNavigate: (route: RouteId) => void;
	}

	let { activeRoute, onNavigate }: Props = $props();
</script>

<nav class="operator-rail" aria-label="Operator Rail">
	<div class="rail-brand" aria-hidden="true">
		<span class="rail-mark">AV</span>
		<span class="rail-pulse"></span>
	</div>
	<div class="rail-copy">
		<p class="eyebrow">Linux Control</p>
		<p class="rail-title">Operator Rail</p>
	</div>
	<div class="rail-actions">
		{#each ROUTES as route}
			<button
				type="button"
				class:active={route.id === activeRoute}
				aria-current={route.id === activeRoute ? "page" : undefined}
				title={route.description}
				onclick={() => onNavigate(route.id)}
			>
				<span>{route.label}</span>
			</button>
		{/each}
	</div>
</nav>
