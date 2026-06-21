<script lang="ts">
	import { onMount } from "svelte";
	import type { AppHistoryJob, AppHistoryPageInfo } from "../../../../../src/history";
	import type { QueueSnapshotJob, UiQueueSnapshot } from "../../../../../src/app-service";
	import ConfirmDialog from "../components/ConfirmDialog.svelte";
	import { agentVoice } from "../lib/api";

	type ClearKind = "active" | "failed";

	let jobs = $state<AppHistoryJob[]>([]);
	let queueSnapshot = $state<UiQueueSnapshot | null>(null);
	let pageInfo = $state<AppHistoryPageInfo>({ limit: 10, hasMore: false, nextCursor: null });
	let loading = $state(true);
	let loadingMore = $state(false);
	let error = $state("");
	let message = $state("");
	let confirmKind = $state<ClearKind | null>(null);
	let returnFocusTo = $state<HTMLElement | null>(null);

	async function loadQueueSnapshot(): Promise<void> {
		error = "";
		try {
			const result = await agentVoice.queue.snapshot();
			if (!result.ok) {
				error = result.error.message;
				return;
			}
			queueSnapshot = result.value;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		}
	}

	async function loadHistory(before: string | undefined = undefined): Promise<void> {
		if (before) loadingMore = true;
		else loading = true;
		error = "";
		try {
			const result = await agentVoice.history.list({ limit: 10, ...(before ? { before } : {}) });
			if (!result.ok) {
				error = result.error.message;
				return;
			}
			jobs = before ? [...jobs, ...result.value.jobs] : result.value.jobs;
			pageInfo = result.value.pageInfo;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			loading = false;
			loadingMore = false;
		}
	}

	function openConfirm(kind: ClearKind, event: MouseEvent): void {
		confirmKind = kind;
		returnFocusTo = event.currentTarget as HTMLElement;
	}

	function closeConfirm(): void {
		confirmKind = null;
	}

	async function reloadInitial(): Promise<void> {
		loading = true;
		try {
			await Promise.all([loadQueueSnapshot(), loadHistory()]);
		} finally {
			loading = false;
		}
	}

	async function confirmClear(): Promise<void> {
		if (!confirmKind) return;
		const result = confirmKind === "active"
			? await agentVoice.queue.clearActive()
			: await agentVoice.queue.clearFailed();
		if (result.ok) {
			message = `Cleared ${result.value.cleared} ${confirmKind} job(s).`;
			await reloadInitial();
		} else {
			error = result.error.message;
		}
	}

	const activeJobs = $derived<QueueSnapshotJob[]>([
		...(queueSnapshot?.processing ?? []),
		...(queueSnapshot?.pending ?? []),
	]);

	const confirmTitle = $derived(
		confirmKind === "active" ? "Clear active queue" : "Clear failed jobs",
	);
	const confirmExpected = $derived(
		confirmKind === "active" ? "CLEAR ACTIVE" : "CLEAR FAILED",
	);
	const confirmMessage = $derived(
		confirmKind === "active"
			? "This removes pending and processing jobs from the active queue."
			: "This removes failed jobs and their diagnostic details from the queue.",
	);

	onMount(() => {
		void reloadInitial();
	});
</script>

<section class="route-panel queue-history" aria-labelledby="queue-history-heading">
	<p class="eyebrow">Queue Control</p>
	<h2 id="queue-history-heading" tabindex="-1">Queue &amp; History</h2>
	<p class="route-intro">Inspect active speech jobs, failures, skipped events, and completed history.</p>

	<div class="danger-actions" aria-label="Queue cleanup actions">
		<button type="button" onclick={(event) => openConfirm("active", event)}>Clear Active</button>
		<button type="button" onclick={(event) => openConfirm("failed", event)}>Clear Failed</button>
	</div>

	{#if message}
		<p class="notice" role="status">{message}</p>
	{/if}
	{#if error}
		<p class="notice danger" role="alert">{error}</p>
	{/if}

	{#if loading}
		<p role="status">Loading queue history…</p>
	{:else}
		<section class="active-queue" aria-labelledby="active-queue-heading">
			<h3 id="active-queue-heading">Active queue</h3>
			{#if activeJobs.length === 0}
				<p>No pending or processing jobs.</p>
			{:else}
				<div class="job-list" aria-label="Active queue rows">
					{#each activeJobs as job}
						<article class={`job-row ${job.status}`}>
							<header>
								<h4>{job.agent} · {job.status}</h4>
								<span>{job.createdAt}</span>
							</header>
							<p>{job.text}</p>
							<dl>
								<div><dt>Attempts</dt><dd>{job.attempts}</dd></div>
								{#if job.cwd}<div><dt>Working directory</dt><dd>{job.cwd}</dd></div>{/if}
								{#if job.claimedAt}<div><dt>Claimed at</dt><dd>{job.claimedAt}</dd></div>{/if}
								{#if job.nextAttemptAt}<div><dt>Next attempt</dt><dd>{job.nextAttemptAt}</dd></div>{/if}
							</dl>
						</article>
					{/each}
				</div>
			{/if}
		</section>

		<section class="history-queue" aria-labelledby="history-queue-heading">
			<h3 id="history-queue-heading">Completed history</h3>
			{#if jobs.length === 0}
				<p>No completed history yet.</p>
			{:else}
				<div class="job-list" aria-label="Queue history rows">
			{#each jobs as job}
				<article class={`job-row ${job.status}`}>
					<header>
						<h3>{job.agent} · {job.status}</h3>
						<span>{job.createdAt}</span>
					</header>
					<p>{job.text}</p>
					<dl>
						<div><dt>Attempts</dt><dd>{job.attempts}</dd></div>
						{#if job.cwd}<div><dt>Working directory</dt><dd>{job.cwd}</dd></div>{/if}
						{#if job.summary}<div><dt>Summary</dt><dd>{job.summary}</dd></div>{/if}
						{#if job.summarizerUsed}<div><dt>Source</dt><dd>{job.summarizerUsed}</dd></div>{/if}
						{#if job.lastError}<div><dt>Raw error</dt><dd>{job.lastError}</dd></div>{/if}
						{#if job.skipReason}<div><dt>Skip reason</dt><dd>{job.skipReason}</dd></div>{/if}
					</dl>
				</article>
			{/each}
				</div>
			{/if}
		</section>
	{/if}

	{#if pageInfo.hasMore && pageInfo.nextCursor}
		<button type="button" class="load-more" disabled={loadingMore} onclick={() => loadHistory(pageInfo.nextCursor ?? undefined)}>
			{loadingMore ? "Loading…" : "Load More"}
		</button>
	{/if}

	<ConfirmDialog
		open={confirmKind !== null}
		title={confirmTitle}
		message={confirmMessage}
		expectedText={confirmExpected}
		confirmLabel="Remove jobs"
		{returnFocusTo}
		onConfirm={confirmClear}
		onClose={closeConfirm}
	/>
</section>

<style>
	.queue-history {
		display: grid;
		gap: 1rem;
	}

	.route-intro,
	.job-row span,
	dt {
		color: #a9b6c7;
	}

	.danger-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	button {
		border: 1px solid rgba(148, 163, 184, 0.28);
		border-radius: 0.85rem;
		padding: 0.65rem 0.8rem;
		background: rgba(15, 23, 42, 0.8);
		color: #ecf6ff;
		font-weight: 850;
	}

	.danger-actions button {
		border-color: rgba(255, 107, 146, 0.45);
	}

	.job-list {
		display: grid;
		gap: 0.85rem;
	}

	.job-row,
	.notice {
		border: 1px solid rgba(148, 163, 184, 0.22);
		border-radius: 1rem;
		padding: 1rem;
		background: rgba(15, 23, 42, 0.64);
	}

	.job-row.failed {
		border-color: rgba(255, 107, 146, 0.5);
	}

	.job-row.skipped {
		border-color: rgba(255, 203, 107, 0.42);
	}

	.job-row header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: baseline;
	}

	.job-row h3,
	.job-row h4,
	.job-row p,
	.notice {
		margin: 0;
	}

	dl {
		display: grid;
		gap: 0.5rem;
		margin: 0.85rem 0 0;
	}

	dt,
	dd {
		margin: 0;
	}

	dd {
		word-break: break-word;
	}

	.notice.danger {
		border-color: rgba(255, 107, 146, 0.55);
		color: #fecdd3;
	}
</style>
