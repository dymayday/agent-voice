<script lang="ts">
	import OperatorRail from "./components/OperatorRail.svelte";
	import { ROUTES, type RouteId } from "./lib/types";
	import DiagnosticsPanel from "./routes/DiagnosticsPanel.svelte";
	import HomeSignalFeed from "./routes/HomeSignalFeed.svelte";
	import HooksPanel from "./routes/HooksPanel.svelte";
	import QueueHistory from "./routes/QueueHistory.svelte";
	import SettingsPanel from "./routes/SettingsPanel.svelte";
	import SetupRepair from "./routes/SetupRepair.svelte";
	import VoiceBench from "./routes/VoiceBench.svelte";

	let activeRoute = $state<RouteId>("home");

	const activeRouteMeta = $derived(
		ROUTES.find((route) => route.id === activeRoute) ?? ROUTES[0],
	);

	function navigate(route: RouteId): void {
		activeRoute = route;
	}
</script>

<div class="app-shell">
	<OperatorRail {activeRoute} onNavigate={navigate} />

	<main class="console-stage" aria-labelledby="page-title">
		<header class="console-hero">
			<p class="eyebrow">Agent Voice Operator Console</p>
			<h1 id="page-title">{activeRouteMeta.label}</h1>
			<p>{activeRouteMeta.description}</p>
		</header>

		{#if activeRoute === "home"}
			<HomeSignalFeed />
		{:else if activeRoute === "voice-bench"}
			<VoiceBench />
		{:else if activeRoute === "queue-history"}
			<QueueHistory />
		{:else if activeRoute === "setup-repair"}
			<SetupRepair />
		{:else if activeRoute === "hooks"}
			<HooksPanel />
		{:else if activeRoute === "diagnostics"}
			<DiagnosticsPanel />
		{:else if activeRoute === "settings"}
			<SettingsPanel />
		{/if}
	</main>
</div>
