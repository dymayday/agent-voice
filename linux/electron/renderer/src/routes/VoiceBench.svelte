<script lang="ts">
	import { onMount } from "svelte";
	import PrivacyLabel from "../components/PrivacyLabel.svelte";
	import { agentVoice } from "../lib/api";
	import type { AppConfigDraft } from "../../../../../src/app-service";

	let config = $state<AppConfigDraft | null>(null);
	let testText = $state("Agent Voice Linux sound check.");
	let mode = $state("default");
	let thinking = $state("minimal");
	let model = $state("");
	let voice = $state("default");
	let loading = $state(true);
	let saving = $state(false);
	let message = $state("");
	let error = $state("");

	const privacyKind = $derived(mode === "heuristic" ? "local" : "provider");

	function applyConfig(nextConfig: AppConfigDraft): void {
		config = nextConfig;
		mode = nextConfig.summarizer?.mode ?? "default";
		thinking = nextConfig.summarizer?.thinking ?? "minimal";
		model =
			nextConfig.summarizer?.piModel ??
			nextConfig.summarizer?.codexModel ??
			nextConfig.summarizer?.opencodeModel ??
			"";
		voice = nextConfig.tts?.voice ?? "default";
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

	async function saveConfig(patch: { mode?: string; thinking?: string; model?: string }): Promise<void> {
		saving = true;
		message = "";
		error = "";
		try {
			const result = await agentVoice.config.update(patch);
			if (result.ok) {
				applyConfig(result.value);
				message = "Voice Bench settings saved.";
			} else {
				error = result.error.message;
			}
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			saving = false;
		}
	}

	async function runVoiceTest(): Promise<void> {
		message = "";
		error = "";
		try {
			const result = await agentVoice.voice.test(testText);
			message = result.ok ? "Voice test requested." : result.error.message;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		}
	}

	onMount(() => {
		void loadConfig();
	});
</script>

<section class="route-panel voice-bench" aria-labelledby="voice-bench-heading">
	<p class="eyebrow">Playback Lab</p>
	<h2 id="voice-bench-heading" tabindex="-1">Voice Bench</h2>
	<p class="route-intro">Test Linux playback, voice output, and summarizer privacy settings.</p>

	{#if loading}
		<p role="status">Loading voice settings…</p>
	{:else if error && !config}
		<p class="notice danger" role="alert">{error}</p>
	{:else}
		<div class="bench-grid">
			<section class="bench-card" aria-labelledby="soundcheck-heading">
				<h3 id="soundcheck-heading">Voice test</h3>
				<label>
					<span>Test phrase</span>
					<textarea bind:value={testText} rows="4"></textarea>
				</label>
				<div class="waveform" aria-label="Decorative voice waveform" aria-hidden="false">
					<span></span><span></span><span></span><span></span><span></span>
				</div>
				<button type="button" onclick={runVoiceTest}>Play Voice Test</button>
			</section>

			<section class="bench-card" aria-labelledby="config-heading">
				<h3 id="config-heading">Summarizer controls</h3>
				<label>
					<span>Voice</span>
					<input value={voice} readonly />
				</label>
				<label>
					<span>Summarizer mode</span>
					<select
						bind:value={mode}
						disabled={saving}
						onchange={() => saveConfig({ mode })}
					>
						<option value="default">default</option>
						<option value="heuristic">heuristic</option>
					</select>
				</label>
				<label>
					<span>Thinking</span>
					<select
						bind:value={thinking}
						disabled={saving}
						onchange={() => saveConfig({ thinking })}
					>
						<option value="off">off</option>
						<option value="minimal">minimal</option>
						<option value="low">low</option>
						<option value="medium">medium</option>
						<option value="high">high</option>
						<option value="xhigh">xhigh</option>
					</select>
				</label>
				<label>
					<span>Model</span>
					<input
						bind:value={model}
						disabled={saving}
						onchange={() => saveConfig({ model })}
					/>
				</label>
			</section>
		</div>

		<section class="bench-card privacy-card" aria-labelledby="privacy-heading">
			<h3 id="privacy-heading">Privacy matrix</h3>
			<PrivacyLabel kind="local" label="Local only heuristic summaries" />
			<PrivacyLabel kind="provider" label="Provider backed external summaries" />
			<p>
				Current selection: <PrivacyLabel kind={privacyKind} />
			</p>
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
	.voice-bench,
	.bench-card {
		display: grid;
		gap: 1rem;
	}

	.route-intro,
	label span,
	.bench-card p {
		color: #a9b6c7;
	}

	.bench-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 1rem;
	}

	.bench-card,
	.notice {
		border: 1px solid rgba(148, 163, 184, 0.22);
		border-radius: 1rem;
		padding: 1rem;
		background: rgba(15, 23, 42, 0.64);
	}

	.bench-card h3 {
		margin: 0;
	}

	label {
		display: grid;
		gap: 0.4rem;
	}

	input,
	select,
	textarea {
		box-sizing: border-box;
		width: 100%;
		border: 1px solid rgba(148, 163, 184, 0.28);
		border-radius: 0.8rem;
		padding: 0.65rem 0.75rem;
		background: rgba(7, 10, 18, 0.72);
		color: #ecf6ff;
	}

	button {
		border: 1px solid rgba(87, 229, 255, 0.4);
		border-radius: 0.9rem;
		padding: 0.75rem 0.9rem;
		background: rgba(87, 229, 255, 0.14);
		color: #ecf6ff;
		font-weight: 850;
	}

	.waveform {
		display: inline-flex;
		align-items: end;
		gap: 0.3rem;
		height: 2.4rem;
	}

	.waveform span {
		width: 0.45rem;
		border-radius: 999px;
		background: linear-gradient(#57e5ff, #ff6bd6);
		animation: voice-wave 900ms ease-in-out infinite alternate;
	}

	.waveform span:nth-child(1) { height: 32%; }
	.waveform span:nth-child(2) { height: 70%; animation-delay: 100ms; }
	.waveform span:nth-child(3) { height: 45%; animation-delay: 200ms; }
	.waveform span:nth-child(4) { height: 86%; animation-delay: 300ms; }
	.waveform span:nth-child(5) { height: 55%; animation-delay: 400ms; }

	.privacy-card p {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.notice {
		margin: 0;
	}

	.notice.danger {
		border-color: rgba(255, 107, 146, 0.55);
		color: #fecdd3;
	}

	@keyframes voice-wave {
		to { transform: scaleY(0.55); }
	}

	@media (prefers-reduced-motion: reduce) {
		.waveform span {
			animation: none;
		}
	}
</style>
