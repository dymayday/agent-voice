<script lang="ts">
	import { onMount, tick } from "svelte";
	import { getAgentVoice } from "../lib/api";

	type Severity = "info" | "warning" | "error" | string;
	type JsonRecord = Record<string, unknown>;

	interface DoctorCheck {
		id: string;
		ok?: boolean;
		severity?: Severity;
		message: string;
		action?: string;
	}

	interface SensitivityItem {
		id: string;
		label: string;
		detail?: string;
	}

	interface JobContext {
		id: string;
		agent: string;
		status: string;
		text?: string;
		cwd?: string;
		createdAt?: string;
		finishedAt?: string;
		summarizerUsed?: string;
		skipReason?: string;
		lastError?: string;
		attempts?: number;
	}

	interface HookTarget {
		agent: string;
		state?: string;
		target?: string;
	}

	interface DiagnosticsSnapshot extends JsonRecord {
		checks?: DoctorCheck[];
		doctor?: { checks?: DoctorCheck[] };
		paths?: JsonRecord;
		status?: JsonRecord;
		build?: JsonRecord;
		playback?: JsonRecord;
		hooks?: JsonRecord;
		hookTargets?: HookTarget[];
		failedJobs?: JobContext[];
		skippedJobs?: JobContext[];
	}

	interface DiagnosticsPreview {
		snapshot: DiagnosticsSnapshot;
		sensitivity: SensitivityItem[];
	}

	const TEXT_LIMIT = 220;
	const PREVIEW_LIMIT = 6000;

	let loading = $state(true);
	let errorMessage = $state("");
	let diagnostics = $state<DiagnosticsPreview | null>(null);
	let copyStatus = $state("");
	let copyButton = $state<HTMLButtonElement | null>(null);

	const snapshot = $derived(diagnostics?.snapshot ?? null);
	const checks = $derived(readChecks(snapshot));
	const pathEntries = $derived(recordEntries(snapshot?.paths));
	const hookTargets = $derived(readHookTargets(snapshot));
	const failedJobs = $derived(readJobs(snapshot, "failedJobs"));
	const skippedJobs = $derived(readJobs(snapshot, "skippedJobs"));
	const sensitivity = $derived(diagnostics?.sensitivity ?? []);
	const previewSnapshot = $derived(snapshot ? truncateDiagnosticStrings(snapshot) : null);
	const previewText = $derived(previewSnapshot ? truncatePreview(JSON.stringify(previewSnapshot, null, 2)) : "");
	const errorCount = $derived(checks.filter((check) => check.severity === "error").length);
	const warningCount = $derived(
		checks.filter((check) => check.severity === "warning").length,
	);

	onMount(() => {
		void loadDiagnostics();
	});

	function isRecord(value: unknown): value is JsonRecord {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}

	function stringValue(value: unknown, fallback = "Unavailable"): string {
		if (typeof value === "string" && value.length > 0) return value;
		if (typeof value === "number" || typeof value === "boolean") return String(value);
		return fallback;
	}

	function readNested(record: unknown, keys: string[]): unknown {
		let current: unknown = record;
		for (const key of keys) {
			if (!isRecord(current)) return undefined;
			current = current[key];
		}
		return current;
	}

	function recordEntries(record: unknown): Array<[string, string]> {
		if (!isRecord(record)) return [];
		return Object.entries(record).map(([key, value]) => [key, stringValue(value)]);
	}

	function readChecks(currentSnapshot: DiagnosticsSnapshot | null): DoctorCheck[] {
		const directChecks = currentSnapshot?.checks;
		if (Array.isArray(directChecks)) return directChecks;
		const doctorChecks = currentSnapshot?.doctor?.checks;
		if (Array.isArray(doctorChecks)) return doctorChecks;
		return [];
	}

	function readJobs(
		currentSnapshot: DiagnosticsSnapshot | null,
		key: "failedJobs" | "skippedJobs",
	): JobContext[] {
		const jobs = currentSnapshot?.[key];
		return Array.isArray(jobs) ? jobs : [];
	}

	function readHookTargets(currentSnapshot: DiagnosticsSnapshot | null): HookTarget[] {
		const explicitTargets = currentSnapshot?.hookTargets;
		if (Array.isArray(explicitTargets) && explicitTargets.length > 0) {
			return explicitTargets;
		}
		if (!isRecord(currentSnapshot?.hooks)) return [];
		return Object.entries(currentSnapshot.hooks).map(([agent, state]) => ({
			agent,
			state: stringValue(state),
			target: "Target path unavailable in diagnostics preview",
		}));
	}

	function normalizePreview(value: unknown): DiagnosticsPreview {
		if (isRecord(value) && isRecord(value.snapshot)) {
			const rawSensitivity = Array.isArray(value.sensitivity)
				? value.sensitivity
				: [];
			return {
				snapshot: value.snapshot as DiagnosticsSnapshot,
				sensitivity: rawSensitivity.filter(isSensitivityItem),
			};
		}
		return {
			snapshot: isRecord(value) ? (value as DiagnosticsSnapshot) : { value },
			sensitivity: [],
		};
	}

	function isSensitivityItem(value: unknown): value is SensitivityItem {
		return isRecord(value) && typeof value.id === "string" && typeof value.label === "string";
	}

	function resultValue(result: unknown): unknown {
		if (isRecord(result) && result.ok === true && "value" in result) return result.value;
		if (isRecord(result) && result.ok === false && isRecord(result.error)) {
			throw new Error(stringValue(result.error.message, "Diagnostics snapshot failed"));
		}
		return result;
	}

	async function loadDiagnostics(): Promise<void> {
		loading = true;
		errorMessage = "";
		copyStatus = "";
		try {
			const result = await getAgentVoice().diagnostics.snapshot();
			diagnostics = normalizePreview(resultValue(result));
		} catch (error) {
			diagnostics = null;
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			loading = false;
		}
	}

	function truncateText(value: string | undefined): string {
		if (!value) return "";
		if (value.length <= TEXT_LIMIT) return value;
		return `${value.slice(0, TEXT_LIMIT)}… [truncated]`;
	}

	function truncatePreview(value: string): string {
		if (value.length <= PREVIEW_LIMIT) return value;
		return `${value.slice(0, PREVIEW_LIMIT)}\n… [truncated diagnostics preview]`;
	}

	function truncateDiagnosticStrings(value: unknown, key = ""): unknown {
		if (typeof value === "string") {
			return ["text", "summary", "lastError", "skipReason", "message", "action"].includes(key)
				? truncateText(value)
				: value;
		}
		if (Array.isArray(value)) {
			return value.map((item) => truncateDiagnosticStrings(item));
		}
		if (!isRecord(value)) return value;
		return Object.fromEntries(
			Object.entries(value).map(([childKey, childValue]) => [
				childKey,
				truncateDiagnosticStrings(childValue, childKey),
			]),
		);
	}

	function buildId(currentSnapshot: DiagnosticsSnapshot | null): string {
		return stringValue(
			currentSnapshot?.build?.buildId ?? readNested(currentSnapshot?.status, ["buildId"]),
			"dev / unstamped",
		);
	}

	function runtime(currentSnapshot: DiagnosticsSnapshot | null): string {
		return stringValue(currentSnapshot?.build?.runtime);
	}

	function playbackValue(key: string, fallback = "Unavailable"): string {
		return stringValue(snapshot?.playback?.[key], fallback);
	}

	function checkedPlayback(): string {
		const checked = snapshot?.playback?.checked;
		return Array.isArray(checked) ? checked.map((item) => stringValue(item)).join(", ") : "None reported";
	}

	async function copyPreview(): Promise<void> {
		if (!previewText) return;
		const focusTarget = document.activeElement instanceof HTMLElement
			? document.activeElement
			: copyButton;
		copyStatus = "";
		try {
			if (!navigator.clipboard?.writeText) {
				throw new Error("Clipboard API is unavailable");
			}
			await navigator.clipboard.writeText(previewText);
			copyStatus = "Copied diagnostics preview.";
		} catch (error) {
			copyStatus = error instanceof Error ? error.message : String(error);
		} finally {
			await tick();
			focusTarget?.focus();
		}
	}
</script>

<section class="route-panel diagnostics-panel" aria-labelledby="diagnostics-heading">
	<p class="eyebrow">Evidence</p>
	<h2 id="diagnostics-heading" tabindex="-1">Diagnostics</h2>
	<p class="intro">Preview privacy-labeled diagnostic snapshots before copying details.</p>

	{#if loading}
		<p role="status">Loading diagnostics preview…</p>
	{:else if errorMessage}
		<div class="notice error" role="alert">
			<p>Diagnostics preview failed.</p>
			<p>{errorMessage}</p>
			<button type="button" onclick={loadDiagnostics}>Retry diagnostics</button>
		</div>
	{:else if snapshot}
		<div class="diagnostics-grid">
			<section class="card" aria-labelledby="doctor-summary-heading">
				<h3 id="doctor-summary-heading">Doctor Summary</h3>
				<p class="summary-line">
					{checks.length} checks · {errorCount} errors · {warningCount} warnings
				</p>
				<ul class="check-list">
					{#each checks as check (check.id)}
						<li>
							<span class={`severity ${check.severity ?? "info"}`}>{check.severity ?? "info"}</span>
							<div>
								<strong>{check.message}</strong>
								{#if check.action}
									<p>Action: {check.action}</p>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			</section>

			<section class="card" aria-labelledby="paths-heading">
				<h3 id="paths-heading">Local Paths</h3>
				<dl>
					{#each pathEntries as [key, value] (key)}
						<dt>{key}</dt>
						<dd>{value}</dd>
					{/each}
				</dl>
			</section>

			<section class="card" aria-labelledby="runtime-heading">
				<h3 id="runtime-heading">Runtime &amp; Build</h3>
				<dl>
					<dt>Runtime</dt>
					<dd>{runtime(snapshot)}</dd>
					<dt>Build ID</dt>
					<dd>{buildId(snapshot)}</dd>
					<dt>Daemon</dt>
					<dd>{stringValue(readNested(snapshot.status, ["daemon", "state"]))}</dd>
				</dl>
			</section>

			<section class="card" aria-labelledby="playback-heading">
				<h3 id="playback-heading">Playback</h3>
				<dl>
					<dt>State</dt>
					<dd>{playbackValue("state")}</dd>
					<dt>Backend</dt>
					<dd>{playbackValue("backend")}</dd>
					<dt>Checked</dt>
					<dd>{checkedPlayback()}</dd>
					<dt>Message</dt>
					<dd>{playbackValue("message")}</dd>
					{#if snapshot.playback?.lastError}
						<dt>Last error</dt>
						<dd>{stringValue(snapshot.playback.lastError)}</dd>
					{/if}
				</dl>
			</section>

			<section class="card wide" aria-labelledby="hook-targets-heading">
				<h3 id="hook-targets-heading">Hook Targets</h3>
				<div class="table-like">
					{#each hookTargets as hook (hook.agent)}
						<article>
							<strong>{hook.agent}</strong>
							<span>{hook.state ?? "unknown"}</span>
							<code>{hook.target ?? "Target path unavailable in diagnostics preview"}</code>
						</article>
					{/each}
				</div>
			</section>

			<section class="card wide" aria-labelledby="jobs-heading">
				<h3 id="jobs-heading">Failed and Skipped Job Text</h3>
				{#if failedJobs.length === 0 && skippedJobs.length === 0}
					<p>No failed or skipped job context in the preview.</p>
				{/if}
				{#each failedJobs as job (job.id)}
					<article class="job-card failed">
						<p class="job-title"><strong>{job.id}</strong> · {job.agent} · failed</p>
						<p>{truncateText(job.text)}</p>
						{#if job.lastError}<p>Error: {truncateText(job.lastError)}</p>{/if}
						{#if job.summarizerUsed}<p>Summarizer: {job.summarizerUsed}</p>{/if}
						{#if job.cwd}<p>CWD: {job.cwd}</p>{/if}
					</article>
				{/each}
				{#each skippedJobs as job (job.id)}
					<article class="job-card skipped">
						<p class="job-title"><strong>{job.id}</strong> · {job.agent} · skipped</p>
						<p>{truncateText(job.text)}</p>
						{#if job.skipReason}<p>Skip reason: {job.skipReason}</p>{/if}
					</article>
				{/each}
			</section>

			<section class="card wide" aria-labelledby="sensitivity-heading">
				<h3 id="sensitivity-heading">Sensitivity Labels</h3>
				{#if sensitivity.length === 0}
					<p>No sensitivity labels were reported for this preview.</p>
				{:else}
					<ul class="sensitivity-list">
						{#each sensitivity as item (item.id)}
							<li>
								<strong>{item.label}</strong>
								{#if item.detail}<p>{item.detail}</p>{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="card wide preview-card" aria-labelledby="preview-heading">
				<h3 id="preview-heading">Preview Before Copy</h3>
				<p>Review this exact privacy-labeled preview before copying it.</p>
				<pre aria-label="Diagnostics copy preview">{previewText}</pre>
				<div class="copy-row">
					<button
						type="button"
						bind:this={copyButton}
						onclick={copyPreview}
						disabled={!previewText}
					>
						Copy diagnostics preview
					</button>
					{#if copyStatus}<p role="status">{copyStatus}</p>{/if}
				</div>
			</section>
		</div>
	{/if}
</section>

<style>
	.diagnostics-panel .intro {
		color: #a9b6c7;
	}

	.diagnostics-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 1rem;
		margin-top: 1.25rem;
	}

	.card {
		border: 1px solid rgba(148, 163, 184, 0.18);
		border-radius: 1.1rem;
		padding: 1rem;
		background: rgba(2, 6, 23, 0.46);
	}

	.card.wide {
		grid-column: 1 / -1;
	}

	.card h3 {
		margin: 0 0 0.75rem;
		font-size: 1.15rem;
	}

	.summary-line,
	.card p {
		color: #cbd5e1;
	}

	dl {
		display: grid;
		gap: 0.35rem 0.75rem;
		grid-template-columns: max-content minmax(0, 1fr);
		margin: 0;
	}

	dt {
		color: #57e5ff;
		font-weight: 800;
		text-transform: capitalize;
	}

	dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
		color: #e2e8f0;
	}

	.check-list,
	.sensitivity-list {
		display: grid;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.check-list li,
	.sensitivity-list li,
	.job-card,
	.table-like article {
		border: 1px solid rgba(148, 163, 184, 0.14);
		border-radius: 0.85rem;
		padding: 0.85rem;
		background: rgba(15, 23, 42, 0.52);
	}

	.check-list li {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.severity {
		display: inline-flex;
		border-radius: 999px;
		padding: 0.2rem 0.55rem;
		background: rgba(148, 163, 184, 0.18);
		color: #e2e8f0;
		font-size: 0.72rem;
		font-weight: 900;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.severity.warning {
		background: rgba(250, 204, 21, 0.14);
		color: #fde68a;
	}

	.severity.error {
		background: rgba(248, 113, 113, 0.14);
		color: #fecaca;
	}

	.table-like {
		display: grid;
		gap: 0.65rem;
	}

	.table-like article {
		display: grid;
		grid-template-columns: 7rem 8rem minmax(0, 1fr);
		gap: 0.75rem;
		align-items: center;
	}

	code,
	pre {
		font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
	}

	code {
		overflow-wrap: anywhere;
		color: #bfdbfe;
	}

	.job-card {
		margin-top: 0.75rem;
	}

	.job-title {
		margin-top: 0;
	}

	.preview-card pre {
		max-height: 20rem;
		overflow: auto;
		margin: 0.75rem 0;
		padding: 1rem;
		border-radius: 0.85rem;
		background: #020617;
		color: #dbeafe;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.copy-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.copy-row button,
	.notice button {
		border: 0;
		border-radius: 999px;
		padding: 0.75rem 1rem;
		background: linear-gradient(135deg, #57e5ff, #ff6bd6);
		color: #051018;
		font-weight: 900;
	}

	.copy-row button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.notice.error {
		border: 1px solid rgba(248, 113, 113, 0.5);
		border-radius: 1rem;
		padding: 1rem;
		background: rgba(127, 29, 29, 0.25);
	}

	@media (max-width: 720px) {
		.table-like article,
		dl {
			grid-template-columns: 1fr;
		}
	}
</style>
