<script lang="ts">
	import { onMount } from "svelte";
	import type { AppConfigDraft } from "../../../../../src/app-service";
	import { agentVoice } from "../lib/api";

	let config = $state<AppConfigDraft | null>(null);
	let capsuleEnabled = $state(false);
	let loading = $state(true);
	let saving = $state(false);
	let message = $state("");
	let error = $state("");

	function applyConfig(nextConfig: AppConfigDraft): void {
		config = nextConfig;
		capsuleEnabled = nextConfig.ui?.desktopCapsule?.enabled === true;
	}

	async function loadConfig(): Promise<void> {
		loading = true;
		error = "";
		try {
			applyConfig(await agentVoice.config.get());
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			loading = false;
		}
	}

	async function toggleCapsule(event: Event): Promise<void> {
		const target = event.currentTarget as HTMLInputElement;
		const nextEnabled = target.checked;
		saving = true;
		message = "";
		error = "";
		try {
			const result = await agentVoice.capsule.setEnabled(nextEnabled);
			if (result.ok) {
				applyConfig(result.value);
				message = nextEnabled
					? "Desktop Capsule enabled"
					: "Desktop Capsule disabled";
			} else {
				capsuleEnabled = !nextEnabled;
				error = result.error.message;
			}
		} catch (caught) {
			capsuleEnabled = !nextEnabled;
			error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			saving = false;
		}
	}

	onMount(() => {
		void loadConfig();
	});
</script>

<section class="route-panel settings-panel" aria-labelledby="settings-heading">
	<p class="eyebrow">Preferences</p>
	<h2 id="settings-heading" tabindex="-1">Settings</h2>
	<p class="route-intro">
		Configure summarizer defaults and the optional Desktop Capsule.
	</p>

	{#if loading}
		<p role="status">Loading settings…</p>
	{:else if error && !config}
		<p class="notice danger" role="alert">{error}</p>
	{:else}
		<section class="setting-card" aria-labelledby="capsule-heading">
			<div>
				<h3 id="capsule-heading">Desktop Capsule</h3>
				<p>
					A floating safe-action capsule for Open Console, Speak Latest, and View Queue.
				</p>
			</div>

			<label class="switch-row">
				<span>Desktop Capsule</span>
				<input
					type="checkbox"
					role="switch"
					checked={capsuleEnabled}
					disabled={saving}
					onchange={toggleCapsule}
				/>
			</label>
		</section>

		<section class="setting-card" aria-labelledby="summary-heading">
			<h3 id="summary-heading">Current voice defaults</h3>
			<dl>
				<div>
					<dt>Summarizer mode</dt>
					<dd>{config?.summarizer?.mode ?? "default"}</dd>
				</div>
				<div>
					<dt>Thinking</dt>
					<dd>{config?.summarizer?.thinking ?? "default"}</dd>
				</div>
				<div>
					<dt>Voice</dt>
					<dd>{config?.tts?.voice ?? "default"}</dd>
				</div>
			</dl>
		</section>
	{/if}

	{#if message}
		<p class="notice" role="status">{message}</p>
	{/if}
	{#if error && config}
		<p class="notice danger" role="alert">{error}</p>
	{/if}
</section>

<style>
	.settings-panel {
		display: grid;
		gap: 1rem;
	}

	.route-intro,
	.setting-card p,
	dt {
		color: #a9b6c7;
	}

	.setting-card,
	.notice {
		border: 1px solid rgba(148, 163, 184, 0.22);
		border-radius: 1rem;
		padding: 1rem;
		background: rgba(15, 23, 42, 0.64);
	}

	.setting-card {
		display: grid;
		gap: 1rem;
	}

	.setting-card h3 {
		margin: 0 0 0.35rem;
	}

	.switch-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		font-weight: 850;
	}

	.switch-row input {
		width: 3.25rem;
		height: 1.65rem;
		accent-color: #57e5ff;
	}

	dl {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: 0.75rem;
		margin: 0;
	}

	dt,
	dd {
		margin: 0;
	}

	dd {
		font-weight: 850;
	}

	.notice {
		margin: 0;
	}

	.notice.danger {
		border-color: rgba(255, 107, 146, 0.55);
		color: #fecdd3;
	}
</style>
