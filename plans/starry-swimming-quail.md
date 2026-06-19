# Plan: lower idle power — status snapshot file + visibility-gated GUI refresh

## Context

agent-voice already shipped two power wins (event-driven SIGUSR1 daemon; GUI split-cadence refresh). A multi-agent investigation (then adversarial verification) found the next-biggest idle costs and ruled out the cheap-but-useless ones. The user picked the two top verified items:

1. **(HIGH) Status snapshot file.** While any GUI window/popover is open, `AppModel` spawns a fresh Bun CLI (`bin/agent-voice status --json`) every ~2s — each spawn fork/execs bash+Bun, transpiles `cli.ts`, cold-opens SQLite, exits (~30–50ms CPU, ~30 spawns/min). These are real recurring fork/exec wakeups. Fix: the long-lived daemon writes an atomic `run/status.json`; the GUI reads it in-process and only falls back to spawning when the file can't be trusted.
2. **(MEDIUM) Visibility gating.** `AppModel.startAutoRefresh` ref-counts across views via `.onAppear`/`.onDisappear`, but `onDisappear` fires on window *close*, not occlude/minimize/background — so an open-but-hidden Dashboard (it auto-opens on cold launch) keeps polling at full rate. The app has **zero** visibility/focus APIs today. Fix: gate the loop on real app visibility/focus.

Implement Feature 1 first: then Feature 2's "refresh on reveal" is already a cheap file read instead of a spawn.

## Feature 1 — daemon publishes `run/status.json`, GUI reads it

### TypeScript
- **`src/status.ts`** — add a pure `composeStatusSnapshot({daemon:{running,pid}, queues, config, paths})` that returns the existing `AppStatusSnapshot` shape, reusing `deriveUiState`. Refactor `buildAppStatusSnapshot` (status.ts:58-76) to delegate to it so the spawn path stays byte-identical and UI-state derivation is single-sourced. (Chosen over reusing `buildAppStatusSnapshot` in the daemon because that re-opens a 2nd readonly SQLite connection, re-reads the pid lock, and re-`loadConfig`s — all of which the loop already has in hand.)
- **`src/daemon.ts`** — add `renameSync` to the fs import; add:
  - `statusSnapshotPath(paths)` → `join(paths.run, "status.json")`
  - `writeStatusSnapshotAtomic(paths, json)` → `ensureRunDir`, write `${final}.${process.pid}.tmp` (same dir → same FS), `renameSync` over final.
  - `clearStatusSnapshot(paths)` → `rmSync(..., {force:true})`.
  - In `runDaemonLoop` (daemon.ts:298-392): a `publishSnapshot(currentConfig)` closure that builds `composeStatusSnapshot({daemon:{running:true,pid:process.pid}, queues:countByStatus(db), config:currentConfig, paths})`, `formatAppStatusJson`, and writes **only if the JSON differs from an in-memory `lastSnapshotJson`** (avoids needless idle disk writes). Call it (a) once after `openDb` **before** the `while` (daemon.ts:339); (b) at the end of each iteration, after the prune block and after `waitMs` is computed but **before** `await waitForWork` (so the idle snapshot is on disk before the daemon parks up to 30s). Covers processed/failed/retry/idle and config hot-reload.
- **`src/cli.ts`** — in the daemon-command `finally` (cli.ts:733-735, next to `clearDaemonLock`) call `clearStatusSnapshot(paths)`. No "stopped" snapshot is written: a missing file → GUI cleanly falls back to spawn.

### Swift
- **`AgentVoiceCLI.swift`** — rewrite `status()` (AgentVoiceCLI.swift:92-95): first try `readTrustedStatusSnapshot()`, else the existing spawn body (extract verbatim as `spawnStatus()`).
  - `readTrustedStatusSnapshot()`: locate via existing `effectiveAgentVoiceHome()` + `run/status.json`; `Data(contentsOf:)` → `JSONDecoder().decode(AgentVoiceStatusSnapshot.self)`. **Authority rule:** trust only when `snapshot.daemon.running == true` AND `snapshot.daemon.pid` is alive; else return nil → spawn fallback (== today's behavior, authoritative for stopped/stale).
  - `isProcessAlive(pid)`: `import Darwin`; `pid>0 && (kill(pid_t(pid),0)==0 || errno==EPERM)`.
  - mtime is intentionally NOT a validity signal — at idle the file is legitimately old but valid; a *live writing daemon* is the freshness proxy.

## Feature 2 — gate the auto-refresh loop on visibility/focus

### `AppModel.swift` (replace 158-196)
- Promote interval/divisor locals to fields; add `isHostVisible = true`, `isHostActive = true`, `inactiveIntervalNanoseconds` (~12s). Default-visible keeps all existing tests green.
- Split count bookkeeping from task lifecycle:
  - `startAutoRefresh(...)`: `subscriberCount += 1`, store cadence, `ensureLoopRunning()`.
  - `stopAutoRefresh()`: keep the `> 0` guard; decrement; `cancelLoop()` at 0.
  - `setHostVisibility(_:)`: idempotent guard; `true → ensureLoopRunning()`, `false → cancelLoop()` (KEEP count).
  - `setHostActive(_:)`: just sets the flag (loop reads interval each tick).
  - `ensureLoopRunning()`: guard `subscriberCount>0 && isHostVisible && task==nil`; the Task loop resets `tick=0` on (re)start → reveal does an immediate full refresh; each tick sleeps `effectiveIntervalNanoseconds` (active → 2s, inactive → ~12s, no restart needed).
  - `isAutoRefreshRunning { autoRefreshTask != nil }` stays; reads true in the default-visible case.

### `DockMenuController.swift` (`AgentVoiceDockMenuDelegate`)
- Add `applicationDidFinishLaunching` registering NotificationCenter observers on `NSApp`: `didChangeOcclusionStateNotification` → `setHostVisibility(NSApp.occlusionState.contains(.visible))`; `didBecomeActiveNotification` → `setHostActive(true)` + re-seed visibility (recovers any missed occlusion event); `didResignActiveNotification` → `setHostActive(false)`. Seed `setHostVisibility(...)` once at launch. Use `MainActor.assumeIsolated` (delivery on `.main`).
- **Keep the `.onAppear { model.startAutoRefresh() }` / `.onDisappear { model.stopAutoRefresh() }` literals byte-for-byte** in DashboardView/AttentionDetailView/MenuBarSentinelView (pinned by source-string tests). Visibility gating layers on top.
- **R7:** insert `applicationDidFinishLaunching` **after `applicationDockMenu`** so it doesn't fall inside any `sourceSlice(from:to:)` marker pair in `DockMenuSourceTests`; re-check the marker pairs against the chosen line before committing.

## Tests (test-first per feature)

- **NEW `tests/status-snapshot.test.ts`:** `composeStatusSnapshot` byte-identical to `buildAppStatusSnapshot` for equal inputs; `writeStatusSnapshotAtomic` creates `run/`, writes `status.json`, leaves no `.tmp`, sequential writes → final==last & parseable; `clearStatusSnapshot` idempotent.
- **NEW daemon-loop tests in `tests/daemon.test.ts`:** publishes `running:true,pid:process.pid` before iteration one (`maxIterations:0` exercises site (a) only); republishes queue counts after a processed job (`maxIterations:1`); skips identical write across two idle iterations. (Add additive `snapshotWrites` to `DaemonLoopResult` for observability — confirm no test asserts whole-object equality on the loop result.)
- **NEW `AgentVoiceCLISnapshotTests.swift`:** temp `agentVoiceHome`; valid file w/ `pid:getpid()` → returns snapshot with **zero** captured requests; dead pid / missing / corrupt / `running:false` → spawn fallback (`["status","--json"]`).
- **NEW AppModelTests cases:** hidden cancels loop but keeps subscribers; idempotent visibility; start-while-hidden does not run; reveal performs immediate full refresh; `setHostActive` does not restart; default-visible unchanged.
- **NEW source-string assertions** in `DockMenuSourceTests.swift` for the added delegate text.
- **EXISTING that must stay green / be updated:**
  - `tests/status-json.test.ts` (no running daemon → still uses spawn path; unaffected), `tests/integration-daemon.test.ts`, `tests/daemon.test.ts` config-reload cases (now also drop a `run/status.json` in temp home — they assert via DB `readJob`, so fine).
  - **R4 (must-handle):** every AppModelTests/AgentVoiceCLITests case that asserts `requests` starts with `["status","--json"]` currently builds the CLI with `agentVoiceHome=nil` → resolves to real `~/.agent-voice`. **Pin `agentVoiceHome` to a temp dir** in those cases so a real local `run/status.json` can't short-circuit the spawn.
  - `AgentVoiceAppSourceTests` (onAppear/onDisappear literals kept) — verify unchanged.

## Risks
- **R3 (medium, documented):** crash + immediate PID reuse + stale `running:true` file → GUI briefly trusts a dead daemon. Mitigated by `clearStatusSnapshot` on clean shutdown (common case leaves no file); residual == existing accepted `notifyDaemon`/`stopDaemon` TOCTOU. Optional later hardening: boot-nonce in both `daemon.pid` and the snapshot.
- **R4 (must-handle):** see tests above — most likely breakage.
- **R7 (low):** source-slice fragility — see insertion point above.
- Missed occlusion notifications self-heal via launch seed + `didBecomeActive` re-seed + any `onAppear`; never worse than today.

## Verification
- `bun test` (all TS green: new snapshot/daemon tests + existing status-json/daemon/integration).
- `swift test` in `macos/AgentVoiceApp` (new + existing AppModel/CLI/source tests green).
- `bun run typecheck`.
- Manual / measured (build the app via `scripts/build-macos-app.sh`): with the Dashboard open and idle, `sudo fs_usage -w -f exec | grep -E 'agent-voice|bun'` shows ~0 `status` spawns (was ~30/min); occlude/background the window → spawns and file reads stop; reveal → immediate refresh. Confirm `~/.agent-voice/run/status.json` updates on job state changes and is removed on daemon stop. Cross-check Activity Monitor Energy tab before/after.
