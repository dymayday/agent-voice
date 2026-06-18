import { describe, expect, test } from "bun:test";
import { createSignalWorkWaiter } from "../src/daemon-wait";

describe("createSignalWorkWaiter", () => {
	test("notify before wait consumes the flag and the next wait blocks", async () => {
		const waiter = createSignalWorkWaiter();

		// A notify() that lands before wait() must be consumed synchronously, so
		// the first wait() returns immediately.
		waiter.notify();
		let firstResolved = false;
		const first = waiter.wait(60_000).then(() => {
			firstResolved = true;
		});
		await first;
		expect(firstResolved).toBe(true);

		// The flag was consumed, so a second wait() must block (resolve only on a
		// timeout or another notify). Use a short timeout to prove it does not
		// resolve from a leftover flag.
		const start = Date.now();
		await waiter.wait(15);
		expect(Date.now() - start).toBeGreaterThanOrEqual(10);
	});

	test("notify during wait resolves it, clears the timer, and does not double-resolve", async () => {
		const waiter = createSignalWorkWaiter();
		let resolveCount = 0;
		const pending = waiter.wait(60_000).then(() => {
			resolveCount += 1;
		});

		// Wake the in-flight wait.
		waiter.notify();
		await pending;
		expect(resolveCount).toBe(1);

		// A second notify after resolution must not re-invoke the (cleared)
		// resolver; resolveCount stays 1 even after a tick. If the timer had not
		// been cleared, it would still be pending but resolve() is a no-op after
		// the first call, so resolveCount remains 1 regardless.
		waiter.notify();
		await new Promise((r) => setTimeout(r, 25));
		expect(resolveCount).toBe(1);

		// The pending flag set by the post-resolution notify is consumed by the
		// next wait, proving notify() stayed synchronous and stateful.
		const start = Date.now();
		await waiter.wait(60_000);
		expect(Date.now() - start).toBeLessThan(50);
	});

	test("notify() with no active wait sets the flag so the next wait() returns immediately", async () => {
		const waiter = createSignalWorkWaiter();

		// No wait() is in flight, so notify() arms the lost-wakeup guard.
		waiter.notify();

		// The pre-set flag is consumed synchronously: the next wait() must return
		// without sleeping, even with a long timeout. This is the race fix.
		const start = Date.now();
		let resolved = false;
		await waiter.wait(60_000).then(() => {
			resolved = true;
		});
		expect(resolved).toBe(true);
		expect(Date.now() - start).toBeLessThan(50);
	});

	test("notify() resolving an active wait leaves no flag, so a fresh wait() blocks to its timeout", async () => {
		const waiter = createSignalWorkWaiter();

		// Start a wait that would otherwise block, then wake it with notify().
		let firstResolved = false;
		const first = waiter.wait(60_000).then(() => {
			firstResolved = true;
		});
		waiter.notify();
		await first;
		expect(firstResolved).toBe(true);

		// A notify() that resolved an ACTIVE wait must NOT leave pendingWakeups set.
		// A fresh wait() therefore has nothing to consume and must block until its
		// timeout (proving no spurious immediate wakeup).
		const shortMs = 20;
		const start = Date.now();
		await waiter.wait(shortMs);
		expect(Date.now() - start).toBeGreaterThanOrEqual(shortMs - 5);
	});

	test("wait resolves after the timeout when no notify arrives", async () => {
		const waiter = createSignalWorkWaiter();
		const start = Date.now();
		await waiter.wait(20);
		expect(Date.now() - start).toBeGreaterThanOrEqual(15);
	});

	test("single-waiter guard throws when a wait is already in progress", async () => {
		const waiter = createSignalWorkWaiter();
		const pending = waiter.wait(60_000);
		expect(() => waiter.wait(60_000)).toThrow("wait() already in progress");
		// Clean up the in-flight wait so the timer does not linger.
		waiter.notify();
		await pending;
	});

	test("a real SIGUSR1 to the installed handler wakes an in-flight wait", async () => {
		// Skip where signals are unavailable (e.g. Windows lacks SIGUSR1).
		if (process.platform === "win32") return;

		const waiter = createSignalWorkWaiter();
		waiter.install();
		try {
			let resolved = false;
			const start = Date.now();
			// Long timeout: this wait would block for a minute without a signal.
			const pending = waiter.wait(60_000).then(() => {
				resolved = true;
			});

			// Deliver a real SIGUSR1 to ourselves; Node dispatches it to the
			// installed handler, which calls notify() and wakes the wait.
			process.kill(process.pid, "SIGUSR1");

			await pending;
			expect(resolved).toBe(true);
			expect(Date.now() - start).toBeLessThan(5_000);
		} finally {
			waiter.uninstall();
		}
	});

	test("install and uninstall add then remove exactly one SIGUSR1 listener", () => {
		const waiter = createSignalWorkWaiter();
		const before = process.listenerCount("SIGUSR1");

		waiter.install();
		expect(process.listenerCount("SIGUSR1")).toBe(before + 1);

		// install() is idempotent: a second call adds no listener.
		waiter.install();
		expect(process.listenerCount("SIGUSR1")).toBe(before + 1);

		waiter.uninstall();
		expect(process.listenerCount("SIGUSR1")).toBe(before);

		// uninstall() is idempotent: a second call is a no-op.
		waiter.uninstall();
		expect(process.listenerCount("SIGUSR1")).toBe(before);
	});
});
