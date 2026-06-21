<script lang="ts">
	import { onMount, tick } from "svelte";
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
	let pageTitle = $state<HTMLHeadingElement | null>(null);

	const activeRouteMeta = $derived(
		ROUTES.find((route) => route.id === activeRoute) ?? ROUTES[0],
	);

	async function focusPageTitle(): Promise<void> {
		await tick();
		pageTitle?.focus();
	}

	function isRouteId(value: unknown): value is RouteId {
		return typeof value === "string" && ROUTES.some((route) => route.id === value);
	}

	function navigate(route: RouteId): void {
		activeRoute = route;
		void focusPageTitle();
	}

	onMount(() => {
		const listener = (event: Event) => {
			const route = event instanceof CustomEvent ? event.detail : undefined;
			if (isRouteId(route)) navigate(route);
		};
		window.addEventListener("agent-voice:navigate", listener);
		return () => window.removeEventListener("agent-voice:navigate", listener);
	});
</script>

<div class="app-shell">
	<OperatorRail {activeRoute} onNavigate={navigate} />

	<main class="console-stage" aria-labelledby="page-title">
		<header class="console-hero">
			<p class="eyebrow">Agent Voice Operator Console</p>
			<h1 id="page-title" tabindex="-1" bind:this={pageTitle}>{activeRouteMeta.label}</h1>
			<p>{activeRouteMeta.description}</p>
		</header>

		{#if activeRoute === "home"}
			<HomeSignalFeed onNavigate={navigate} />
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
