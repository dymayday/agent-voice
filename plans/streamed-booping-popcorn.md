# Plan: Event-driven daemon wakeup (B) + GUI diagnostics cadence split (C2)

## Context

The app burns power 24/7 in two always-on loops, neither of which needs to run that hot:

1. **Daemon busy-poll** — `runDaemonLoop` (`src/daemon.ts:289-344`) wakes every **200ms** when idle and runs two SQLite queries (`recoverStale` + `claimNextDue` via `processNextJob`), ~432k wakeups/day doing nothing. The fixed timer also defeats macOS App Nap.
2. **GUI over-refresh** — `AppModel.refresh()` (`AppModel.swift:67-124`) spawns **four** CLI subprocesses every **2s** (`status`, `doctor`, `config`, conditional `history`). Each is a full Bun cold-start. `doctor`/`config` almost never change second-to-second.

**Goal:** (B) make the daemon event-driven — sleep until signaled of a new job or a time-aware deadline — without losing work or hurting responsiveness (including future-scheduled retries). (C2) keep `status`/`history` fresh every 2s in the GUI but refresh `doctor`/`config` on a ~30s cadence. Net effect: idle CPU → ~0, GUI process spawns down ~50–75%, while the app still *feels* instant and fresh.

Key constraint discovered: retries set a **future** `next_attempt_at` (`queue.ts:166-192`) with no enqueue event, so the daemon wait must be **time-aware**, not purely signal-driven.

---

## Part B — Engine: event-driven, time-aware daemon wait

### B1. Wakeup IPC = Unix `SIGUSR1` + in-process guard
The enqueue path already knows the daemon PID (`readDaemonLock`, `daemon.ts:79`). On insert it sends `SIGUSR1`; the daemon installs a handler that wakes its wait. Chosen over `fs.watch` (FSEvents latency/missed-event quirks) and FIFO (heavier, cleanup) — signal is instant, file-free, and trivially testable via injected deps.

The classic lost-wakeup race (signal arrives between the queue check and the start of the wait) is closed with an in-process boolean guard (`pendingWakeups`): the handler sets it; `wait()` consumes it and returns immediately instead of sleeping.

### B2. New file `src/daemon-wait.ts`
```ts
export interface WorkWaiter {
  wait(timeoutMs: number): Promise<void>; // resolves on notify() or after timeoutMs
  notify(): void;                         // mark work available; wake an in-flight wait
}
export function createSignalWorkWaiter(): WorkWaiter & {
  install(): void;    // process.on('SIGUSR1', notify) — real entrypoint only
  uninstall(): void;  // remove listener (shutdown/tests)
};
```
State: `pendingWakeups: boolean`, `resolveActive: (()=>void)|null`, `installed: boolean`.
- `notify()`: fully synchronous (no `await`). Set `pendingWakeups=true`; if `resolveActive`, call+clear it.
- `wait(ms)`:
  - **Single-waiter guard:** if `resolveActive !== null` → `throw new Error("wait() already in progress")` (the loop is sequential, so this only fires on a coding bug).
  - If `pendingWakeups` → set it `false` and `return Promise.resolve()` synchronously, **before** creating any promise (race fix).
  - Else `new Promise(resolve => { let timer; resolveActive = () => { clearTimeout(timer); resolveActive=null; resolve(); }; timer = setTimeout(() => { resolveActive=null; pendingWakeups=false; resolve(); }, ms); timer.unref?.(); })`.
  - **Must `clearTimeout` on the notify-wake path** (via the `resolveActive` wrapper above) and `unref()` the timer so it never keeps the process alive or leaks into later tests. The timeout path also clears `pendingWakeups`.
- `install()`: idempotent (guard on `installed`); registers a **named** handler so `uninstall()` can `process.removeListener('SIGUSR1', handler)`. Document the single-threaded assumption.
- Note: each signal-driven wake costs one extra `processNextJob` spin (the next `wait()` consumes the pending flag) — intentional, not a bug.

### B3. New store queries (`src/store.ts`) — uses existing `idx_jobs_inflight` (`db.ts:31`)
```ts
export function getNextDueTime(db: Database): string | null;       // earliest pending due-time, or null if no pending
export function msUntilNextDue(db: Database, now: Date): number | null; // null=no pending; <=0=due now; else ms
```
Use an **index-friendly** form (avoids the non-covering `COALESCE`-in-`MIN` scan): a `NULL` `next_attempt_at` pending row means "due now", otherwise take the `MIN` of the future timestamps:
```sql
SELECT
  CASE WHEN EXISTS(SELECT 1 FROM jobs WHERE status='pending' AND next_attempt_at IS NULL)
       THEN '0000-01-01T00:00:00.000Z'
       ELSE (SELECT MIN(next_attempt_at) FROM jobs WHERE status='pending' AND next_attempt_at IS NOT NULL)
  END AS m
```
This matches `claimNextDue` semantics (`store.ts:172`: `next_attempt_at IS NULL OR next_attempt_at <= now`) exactly.
- **Return-shape correctness:** `.get()` on an aggregate ALWAYS returns a row object, never `null`. Cast as `{ m: string | null }` and `return row.m` — do NOT write `... | null` / `if (!row)` (dead code).
- `msUntilNextDue`: `m===null` → `null`; sentinel/unparseable/past → `0`; else `Date.parse(m) - now.getTime()`.

### B4. `runDaemonLoop` changes (`src/daemon.ts`)
- `DaemonCliDeps` gains: `waitForWork?: (timeoutMs: number) => Promise<void>` and `notifier?: WorkWaiter` (both optional).
- Repurpose `pollIntervalMs` as **safety-net cap**; add `const DEFAULT_SAFETY_NET_MS = 30_000`.
- `const safetyNetMs = deps.pollIntervalMs ?? DEFAULT_SAFETY_NET_MS;`
- `const waitForWork = deps.waitForWork ?? ((ms) => sleep(ms));` (fallback preserves old behavior).
- Replace the idle branch (`daemon.ts:338`):
```ts
if (result.kind === "idle") {
  const dueInMs = msUntilNextDue(db, clock());
  const waitMs = dueInMs === null ? safetyNetMs : Math.max(0, Math.min(safetyNetMs, dueInMs));
  if (waitMs > 0) await waitForWork(waitMs);
}
```
`msUntilNextDue` runs on **every idle iteration** (a new, cheap indexed query) — even with `safetyNetMs=0`. That's intended.

**Test compatibility:** existing daemon tests pass `pollIntervalMs: 0` and no `waitForWork` → `safetyNetMs=0` → `waitMs=0` → wait skipped → loop behaves exactly as today (plus one harmless `msUntilNextDue` query per idle iteration). No existing test changes needed.

**Single-writer note:** `msUntilNextDue` counts only `status='pending'`. A job can't go stale mid-idle-wait (an idle daemon has nothing in `processing`); an orphan `processing` row from a crashed prior daemon is recovered on iteration 1 (process-then-wait order, `daemon.ts:328` before `:338`). Add a comment asserting the single-writer invariant.

### B5. Enqueue → signal (`src/cli.ts`)
Enqueue handler (`cli.ts:622`) currently ignores the return. Capture `inserted` and, when true, call a new best-effort helper:
```ts
// src/daemon.ts (exported)
export function notifyDaemon(paths: AgentVoicePaths, deps: DaemonCliDeps = {}): void;
```
Logic, fully best-effort — **must never throw or block out of the enqueue success path**:
- Wrap the **whole body** (including `readDaemonLock`, which re-throws non-`ENOENT` errors like `EACCES`, `daemon.ts:85`) in try/catch.
- `const pid = readDaemonLock(paths)`; if `null` → return.
- Liveness pre-check: `if (!(deps.isPidAlive ?? defaultIsPidAlive)(pid)) return;` (avoid signalling a reused PID).
- `try { (deps.killProcess ?? defaultKillProcess)(pid, "SIGUSR1") } catch (err) { const code=(err as NodeJS.ErrnoException).code; if (code!=='ESRCH'&&code!=='EPERM') { /* unexpected: warn to stderr, do NOT rethrow */ } }`. Scope the catch so a misbehaving test double surfaces as a warning rather than silent swallow — but enqueue still exits 0.
- Thread `io.daemonDeps` so tests inject a `killProcess` recorder. Duplicate enqueue (`inserted=false`) → no signal.

> **PID-reuse TOCTOU (accepted, documented):** between `readDaemonLock` and `kill`, the daemon could die and the PID be reused. This is the *same* risk the existing `stopDaemon` SIGTERM path already carries (`daemon.ts:408`). Worst realistic case: a missed wakeup (covered by the safety net) or a stray SIGUSR1. Do **not** describe this as "robust"; accept and note it.

### B6. `recoverStale` — leave as-is (decision)
Keep `recoverStale` inside `processNextJob` (`processor.ts:51`); do **not** throttle. It only matters across daemon restarts (single synchronous processor), and the event-driven loop already drops its frequency from ~5/s to ~1/30s. This keeps `processor.ts` and all processor tests untouched (avoids breaking `daemon.test.ts:401-425`).

### B7. Signal handler install/teardown (`src/cli.ts` daemon command, `cli.ts:676-713`)
**Decision: install ONLY the SIGUSR1 wakeup handler. Do NOT add SIGTERM/SIGINT handlers** — keep their default-terminate disposition. This deliberately avoids the audit-found regressions: catching SIGTERM without `process.exit` would remove the hard-kill safety (a job wedged in Kokoro `speak` could make `stop` hang while `stopDaemon` already cleared the lock and reported `stopped`), and would race the lock between `stopDaemon` (`daemon.ts:410`) and a daemon `finally`. Default terminate preserves exactly today's stop semantics (`stopDaemon` writes intentional-stop, clears the lock, sends SIGTERM; an in-flight job left `processing` is recovered by `recoverStale` on next start).

SIGUSR1 wiring (real entrypoint only, never inside `runDaemonLoop` so tests don't register process-wide handlers):
- **Install BEFORE the PID lock is written** (`enterForegroundDaemon` at `cli.ts:691` writes the lock). Since enqueue discovers the PID only via that lock, installing first closes the startup window where a SIGUSR1 (default disposition = terminate) could kill the just-spawned daemon.
- Pass the waiter into `runDaemonLoop` as `deps.notifier`/`deps.waitForWork` (derive `waitForWork` from the SAME `notifier.wait` so wake and wait are one object).
- In `finally`: `waiter.uninstall()` (named-handler `removeListener`, idempotent) so the in-process daemon-command tests don't accumulate SIGUSR1 listeners across `bun test`.

### B8. Poke the daemon on config mutations (fixes idle config-reload regression)
The daemon reloads config only at the top of a loop iteration (`currentDaemonConfig`, `daemon.ts:232-256`). With a 30s idle wait, a config change (voice, thinking, summarizer model/mode, enable/disable, hook install) would take up to 30s to affect *spoken* output, even though the GUI updates instantly. Fix: after any config-mutating CLI command writes config, call `notifyDaemon(paths)` (the same best-effort SIGUSR1 poke). The wake runs one loop iteration → `currentDaemonConfig` sees the new mtime → reloads. Implementer: grep `cli.ts` for every site that writes config (the `setVoice`/`setSummarizer*`/`setSummarizerMode`/`enable`/`disable`/hook-install handlers, or a shared `writeConfig` chokepoint) and add the poke after a successful write. `notifyDaemon` stays best-effort, so no-daemon/stale-PID is a silent no-op.

### B9. Wall-clock retention pruning (fixes pruning starvation)
Pruning runs on `iterations % pruneEveryIterations` (`daemon.ts:334`, default 300). At ~1 idle iteration / 30s that stretches from ~1/min to ~1/2.5h — and on a mostly-idle daemon may effectively never fire. Convert to a **wall-clock** schedule: track `lastPruneMs`; prune when `clock().getTime() - lastPruneMs >= pruneIntervalMs` (new dep, default `3_600_000` = 1h), then reset `lastPruneMs`. **Keep `pruneEveryIterations` as an additional trigger** (`if (pruneEvery && iterations % pruneEvery === 0) || wallClockElapsed`) so existing tests that set `pruneEveryIterations` to force a prune stay green — verify which tests rely on it and preserve their behavior.

---

## Part C2 — GUI: decouple doctor/config from the 2s status tick

### C2-1. `refresh()` stays byte-identical (hard requirement)
Every GUI test drives `refresh()`/`perform()` directly and asserts the exact `[status, history?, doctor, config]` order. `refresh()` must keep that behavior. Only the **auto-refresh loop body** changes.

### C2-2. Extract sections + fix `lastError` aggregation (BLOCKER)
Splitting `refresh()` naïvely makes each section overwrite the single `lastError`, so a status-only tick would erase a live diagnostics error (and vice-versa) — it would flicker every 2s. Fix with **two error slots** and a recompute:
```swift
private var lastStatusError: String?
private var lastDiagnosticsError: String?
private func recomputeLastError() {
    let parts = [lastStatusError, lastDiagnosticsError].compactMap { $0 }
    lastError = parts.isEmpty ? nil : parts.joined(separator: "\n")
}

// status + conditional history; sets status/history, lastStatusError, then recomputeLastError()
private func refreshStatusSection() async
// doctor + config + draft sync (103-112) + kokoro finalization (119-122); sets lastDiagnosticsError, then recomputeLastError()
private func refreshDiagnosticsSection() async

private func refreshStatus() async      { await refreshStatusSection() }
private func refreshDiagnostics() async { await refreshDiagnosticsSection() }
```
- `refresh()` calls `refreshStatusSection()` then `refreshDiagnosticsSection()` — same CLI request order `[status, history?, doctor, config]`, same observable effects (its tests stay green). Each section recomputes the merged `lastError`, so the final value after a full `refresh()` is identical to today.
- Keep the kokoro finalization (`kokoroSetupDetectionError` + `resetStaleKokoroSetupSuccessIfNeeded`, `AppModel.swift:119-122`) **inside** `refreshDiagnosticsSection()`, AFTER `doctorReport`/`config` are assigned (it reads the freshly-set values via `hasMissingKokoroDiagnostics`, `AppModel.swift:553-563`). One source of truth; the diagnostics-only tick gets it too.
- `refreshStatus`/`refreshDiagnostics` are `private` — the auto-refresh loop calls them via `self?.` from inside the class; cadence tests drive them through `startAutoRefresh`.

### C2-3. Rewrite `startAutoRefresh` loop (`AppModel.swift:126-143`)
```swift
public static let defaultDiagnosticsRefreshEveryTicks = 15  // 15 * 2s ≈ 30s
public func startAutoRefresh(everyNanoseconds: UInt64 = defaultAutoRefreshIntervalNanoseconds,
                             diagnosticsEveryTicks: Int = defaultDiagnosticsRefreshEveryTicks) {
  // ...ref-count unchanged...
  let intervalNanoseconds = max(everyNanoseconds, 1_000_000)
  let tickDivisor = max(1, diagnosticsEveryTicks)   // capture before the closure; fixes the everyTicks name error
  autoRefreshTask = Task { [weak self] in
    var tick = 0
    while !Task.isCancelled {
      if tick == 0 { await self?.refresh() }                          // first tick = full
      else {
        await self?.refreshStatus()                                   // every 2s
        if tick % tickDivisor == 0 { await self?.refreshDiagnostics() } // every ~30s
      }
      tick &+= 1
      do { try await Task.sleep(nanoseconds: intervalNanoseconds) } catch { break }
    }
  }
}
```
First tick = full `refresh()` → preserves `testAutoRefreshImmediatelyRefreshesWhenFirstSurfaceAppears` (asserts first 4 requests = status,history,doctor,config). The added param has a default, so existing `startAutoRefresh()` / `startAutoRefresh(everyNanoseconds:)` call-sites and the ref-count tests compile and pass unchanged.

### C2-4. All existing freshness triggers preserved
Manual Refresh buttons, `perform()` (after every config mutation), `clearFailedJobs()`, Kokoro setup-complete, and every `onAppear` first-tick all still call full `refresh()`. Drafts + kokoro-staleness live in the diagnostics section, so they update on full refresh and every ~30s tick — never churned by a bare status poll.

---

## Critical files
- `src/daemon-wait.ts` (new) — WorkWaiter / signal waiter
- `src/store.ts` — `getNextDueTime`, `msUntilNextDue`
- `src/daemon.ts` — deps, time-aware idle wait, `notifyDaemon`
- `src/cli.ts` — notify-on-insert; daemon-command signal handlers
- `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift` — section split + loop cadence

## Tests
- **New (engine):** `tests/store.test.ts` due-time queries (empty→null, NULL-pending→due-now, future→positive ms, past→≤0, ignores non-pending); `tests/daemon-wait.test.ts` (notify-before-wait consumes flag & next wait blocks; notify-during-wait resolves & clears timer, no double-resolve; timeout path; single-waiter guard throws; `install/uninstall` add/remove exactly one `SIGUSR1` listener via `process.listenerCount`); daemon idle-wait `waitMs = min(safetyNet, msUntilNextDue)` via injected `waitForWork` recorder + seeded future-retry row; `enqueue-cli.test.ts` notify-on-insert (inject `killProcess` recorder: inserted→one SIGUSR1, duplicate→none, dead/missing lock→none, all exit 0); wall-clock prune fires on elapsed `pruneIntervalMs` with an injected clock; config-mutation command pokes the daemon.
- **New (GUI):** cadence — tick0 full `[status,history?,doctor,config]`, tick1 `[status]` only, tickN (`diagnosticsEveryTicks:2`) includes doctor+config; **`lastError` preserves a diagnostics error across a successful status-only tick** (drives the BLOCKER-1 scenario through `startAutoRefresh`).
- **Unchanged (verified):** integration-daemon, daemon prewarm/config-reload (don't exercise idle wait), enqueue-cli existing cases, all `AppModel*Tests` direct-`refresh()`/`perform()` order assertions, ref-count start/stop, draft-preservation, kokoro-staleness reset.

## Execution pipeline (autopilot)
1. **Audit** the plan with skill-backed specialist agents (architect, typescript-reviewer, code-reviewer/Swift); fold fixes into this plan.
2. **Branch** `feat/event-driven-daemon-and-gui-cadence` off master.
3. **Implement in parallel** — Engine (B) and GUI (C2) are file-disjoint: one agent on `src/*` + TS tests, one on `AppModel.swift` + Swift tests.
4. **Verify**: `bun test` (root) and `swift test` in `macos/AgentVoiceApp`; typecheck.
5. **PR** + run a **Workflow** to review and fix findings before finishing.

## Verification (end-to-end)
- **Idle CPU**: start daemon, drain queue, sample `ps -o %cpu -p $(cat $AGENT_VOICE_HOME/run/daemon.pid)` over ~60s → ~0% (was steady from 200ms poll).
- **Immediate fire**: idle daemon + `printf done | agent-voice enqueue --format text --agent claude` → spoken within ~1s; `status --json` pending→done promptly.
- **Retry on time**: force a summarizer failure → job gets future `next_attempt_at` ~30s out → retried within ~1s of that timestamp (log timestamps).
- **No lost wakeup**: burst-enqueue 50 jobs while idle → all reach `done`, none stuck past the 30s safety net.
- **Graceful stop**: `agent-voice stop` → `daemon.pid` removed, status `stopped` (not stale).
- **GUI fresh**: dashboard status/history update ~2s; doctor/config-derived displays refresh on appear + ~30s; a voice change reflects instantly (perform()→full refresh).
