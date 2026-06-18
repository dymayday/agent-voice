/**
 * Event-driven wakeup primitive for the daemon loop.
 *
 * The daemon sleeps until either a new job is signalled or a time-aware
 * deadline elapses. The classic lost-wakeup race (a signal arriving between the
 * queue check and the start of the wait) is closed with an in-process boolean
 * guard (`pendingWakeups`): `notify()` sets it; `wait()` consumes it and returns
 * immediately instead of sleeping.
 *
 * Single-threaded assumption: the daemon loop is sequential, so only one
 * `wait()` is ever in flight at a time and `notify()` runs synchronously on the
 * same JS thread (it is driven by a `SIGUSR1` handler, which Node dispatches on
 * the main thread between ticks).
 */
export interface WorkWaiter {
	/** Resolves on a `notify()` or after `timeoutMs`, whichever is first. */
	wait(timeoutMs: number): Promise<void>;
	/** Mark work available; wake an in-flight `wait()`. Fully synchronous. */
	notify(): void;
}

export interface SignalWorkWaiter extends WorkWaiter {
	/** Register the SIGUSR1 handler. Idempotent. Real entrypoint only. */
	install(): void;
	/** Remove the SIGUSR1 handler. Idempotent. Used on shutdown and in tests. */
	uninstall(): void;
}

export function createSignalWorkWaiter(): SignalWorkWaiter {
	let pendingWakeups = false;
	let resolveActive: (() => void) | null = null;
	let installed = false;

	function notify(): void {
		// Fully synchronous: no await, runs on the SIGUSR1 dispatch tick.
		if (resolveActive) {
			// An active wait() is sleeping: resolve it directly. The resolveActive
			// closure clears the timer and nulls itself. We do NOT set pendingWakeups
			// here — doing so would leave the flag set after the wakeup and cause a
			// spurious immediate return on the next wait().
			const resolve = resolveActive;
			resolveActive = null;
			resolve();
		} else {
			// No active waiter: arm the lost-wakeup guard so a notify() that lands
			// between the queue check and the next wait() is consumed, not lost.
			pendingWakeups = true;
		}
	}

	function wait(timeoutMs: number): Promise<void> {
		// Single-waiter guard: the loop is sequential, so a second concurrent
		// wait() can only come from a coding bug.
		if (resolveActive !== null) {
			throw new Error("wait() already in progress");
		}
		// Consume a pending wakeup synchronously, before creating any promise,
		// so a notify() that landed between the queue check and here is not lost.
		if (pendingWakeups) {
			pendingWakeups = false;
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			let timer: ReturnType<typeof setTimeout>;
			resolveActive = () => {
				clearTimeout(timer);
				resolveActive = null;
				resolve();
			};
			timer = setTimeout(() => {
				resolveActive = null;
				pendingWakeups = false;
				resolve();
			}, timeoutMs);
			// Never keep the process alive (or leak into later tests) on the timer.
			timer.unref?.();
		});
	}

	// Named handler so uninstall() can remove exactly this listener.
	function handleSignal(): void {
		notify();
	}

	function install(): void {
		if (installed) return;
		installed = true;
		process.on("SIGUSR1", handleSignal);
	}

	function uninstall(): void {
		if (!installed) return;
		installed = false;
		process.removeListener("SIGUSR1", handleSignal);
	}

	return { wait, notify, install, uninstall };
}
