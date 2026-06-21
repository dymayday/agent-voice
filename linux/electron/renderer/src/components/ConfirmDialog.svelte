<script lang="ts">
	import { tick } from "svelte";

	interface Props {
		open: boolean;
		title: string;
		message: string;
		expectedText: string;
		confirmLabel?: string;
		dangerCopy?: string;
		returnFocusTo?: HTMLElement | null;
		onConfirm: () => void | Promise<void>;
		onClose: () => void;
	}

	let {
		open,
		title,
		message,
		expectedText,
		confirmLabel = "Confirm",
		dangerCopy = "This is an irreversible removal action.",
		returnFocusTo = null,
		onConfirm,
		onClose,
	}: Props = $props();

	let typed = $state("");
	let confirmInput = $state<HTMLInputElement | null>(null);
	let dialogElement = $state<HTMLDivElement | null>(null);
	const canConfirm = $derived(typed === expectedText);

	async function close(): Promise<void> {
		typed = "";
		onClose();
		await tick();
		returnFocusTo?.focus();
	}

	async function confirm(): Promise<void> {
		if (!canConfirm) return;
		await onConfirm();
		await close();
	}

	function focusableElements(): HTMLElement[] {
		if (!dialogElement) return [];
		return Array.from(
			dialogElement.querySelectorAll<HTMLElement>(
				'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
			),
		);
	}

	function trapFocus(event: KeyboardEvent): void {
		const focusable = focusableElements();
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			event.preventDefault();
			void close();
		} else if (event.key === "Tab") {
			trapFocus(event);
		}
	}

	$effect(() => {
		if (open) {
			typed = "";
			void tick().then(() => confirmInput?.focus());
		}
	});
</script>

{#if open}
	<div class="dialog-backdrop" role="presentation">
		<div
			bind:this={dialogElement}
			class="confirm-dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby="confirm-title"
			tabindex="-1"
			onkeydown={onKeydown}
		>
			<h2 id="confirm-title">{title}</h2>
			<p>{message}</p>
			<p class="danger-copy">{dangerCopy}</p>
			<label>
				<span>Type {expectedText} to continue</span>
				<input bind:this={confirmInput} bind:value={typed} />
			</label>
			<div class="dialog-actions">
				<button type="button" onclick={close}>Cancel</button>
				<button type="button" disabled={!canConfirm} onclick={confirm}>{confirmLabel}</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.dialog-backdrop {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgba(0, 0, 0, 0.62);
		z-index: 20;
	}

	.confirm-dialog {
		display: grid;
		gap: 0.85rem;
		width: min(34rem, 100%);
		border: 1px solid rgba(255, 107, 146, 0.55);
		border-radius: 1.2rem;
		padding: 1.25rem;
		background: #111827;
		box-shadow: 0 1.5rem 5rem rgba(0, 0, 0, 0.45);
	}

	.confirm-dialog h2,
	.confirm-dialog p {
		margin: 0;
	}

	.danger-copy {
		color: #fecdd3;
		font-weight: 850;
	}

	label {
		display: grid;
		gap: 0.4rem;
	}

	input {
		border: 1px solid rgba(148, 163, 184, 0.28);
		border-radius: 0.8rem;
		padding: 0.65rem 0.75rem;
		background: rgba(7, 10, 18, 0.72);
		color: #ecf6ff;
	}

	.dialog-actions {
		display: flex;
		justify-content: end;
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

	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
