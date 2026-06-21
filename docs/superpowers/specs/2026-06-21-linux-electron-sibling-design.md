# Linux Electron Sibling Design

Date: 2026-06-21
Branch/worktree: `feature/linux-electron-sibling` at `.worktrees/linux-electron-sibling`

## Summary

Add a Linux Electron app as a first-class sibling to the existing macOS SwiftUI app. The Linux app must offer the same practical Agent Voice feature surface, except pause/resume is intentionally hidden in v1 because the CLI currently rejects those commands as unimplemented.

The Linux UI is not a macOS menu-bar clone. It uses an **Operator Rail** full-window console with a **Signal Feed** home panel, a dedicated **Voice Bench** tab, and an optional user-enabled **Desktop Capsule** for low-attention status and safe quick actions.

The macOS Swift app must not be touched by this feature. TypeScript internals may be refactored if public CLI behavior and JSON output stay compatible for the macOS app.

## User Decisions Captured

- Renderer stack: **Svelte + Vite + TypeScript**.
- Electron architecture: **shared TypeScript app-service layer**, not raw renderer shelling.
- TypeScript internals may be refactored if public CLI behavior remains compatible.
- macOS Swift app is out of scope and must not be edited.
- Linux v1 is **dev-build only**; AppImage/`.deb` packaging is deferred.
- Linux audio may use system tools first.
- Pause/resume controls are hidden in Linux v1.
- Desktop Capsule ships in v1 as an optional enable/disable setting.
- To avoid misleading pause semantics, Linux v1 capsule does **not** include `snooze`, `stay quiet`, or pause-like controls.

## Goals

- Add a Linux Electron dev app using Svelte + Vite + TypeScript.
- Preserve existing CLI behavior and macOS compatibility.
- Refactor TypeScript internals into a shared app-service layer usable by CLI and Electron.
- Provide Linux voice playback through detected system tools, initially `paplay`/`aplay`.
- Implement a complete Linux functional surface for daemon, Kokoro setup/repair, voice test, queue/history, diagnostics, hooks, summarizer controls, settings, and optional Desktop Capsule.
- Keep the Electron renderer sandboxed behind a narrow typed preload API.

## Non-goals

- Do not edit Swift/macOS app source files.
- Do not redesign the macOS UI.
- Do not implement pause/resume in Linux v1; hide or omit the controls.
- Do not implement snooze/stay-quiet capsule controls in v1.
- Do not build AppImage, `.deb`, signing, autoupdate, or production packaging yet.
- Do not make the capsule mandatory or the only route to important flows.
- Do not expose generic shell execution or arbitrary CLI arguments to the renderer.

## Milestone Scope

### Must ship in Linux dev v1

- Electron main/preload/renderer app launches via a dev script.
- Svelte Operator Rail full window with core navigation.
- Shared app-service foundation with typed domain methods.
- Home / Signal Feed status summary and latest event.
- Voice Bench with voice test, voice selection, summarizer controls, and text privacy labels.
- Queue & History with failed-job detail, cursor pagination, and guarded clear actions.
- Setup & Repair with consent, JSONL progress, logs, cancel/retry, errors, and copy diagnostics.
- Hooks panel for Pi, Claude, Codex, and OpenCode with state, target paths, conflicts, install/uninstall.
- Diagnostics panel with doctor report, copyable/previewed snapshot, paths, runtime info, and Linux audio backend detection.
- Settings panel with Desktop Capsule enable/disable.
- Optional Desktop Capsule gated by setting, with safe actions only: Open Console, Speak Latest, View Queue.
- Linux audio playback backend detection for `paplay` then `aplay`.
- Tests for shared service, CLI compatibility, Electron preload API shape, key Svelte states, Linux playback detection, and capsule gating.

### Should ship if it does not threaten must-have quality

- Basic command palette for visible commands.
- Polished Voice Bench waveform/visual meter, static under reduced motion.
- Additional Linux playback fallback after `paplay`/`aplay` if evidence supports it.
- Search/filter in Queue & History.

### Could ship later

- AppImage/`.deb` packaging.
- Real pause/resume or snooze semantics.
- Tray/AppIndicator integration beyond the optional floating capsule.
- Advanced theming beyond accessibility-critical contrast/reduced-motion support.
- Full production packaging with bundled/managed runtime.

## Feature Parity Matrix

| Capability | Current CLI/app surface | Linux UI surface | App-service method(s) | v1 status | Acceptance evidence |
|---|---|---|---|---|---|
| Daemon status | `status --json`, macOS Dashboard | Home, Diagnostics | `getStatus()` | must | status service test; Home renders running/stopped/stale/attention |
| Start daemon | `daemon`/start command path, macOS action | Home quick action, Diagnostics | `startDaemon()` | must | service action test; manual dev start |
| Stop daemon | CLI stop path, macOS action | Home/Diagnostics guarded action | `stopDaemon()` | must | service action test; manual dev stop |
| Pause/resume | CLI rejects as not implemented | hidden in Linux UI | none in UI | explicitly deferred | component test asserts no pause/resume controls |
| Voice test | `test <text>` and macOS Soundcheck | Voice Bench, Home quick action | `runVoiceTest(text?)` | must | Linux playback detection tests; manual voice test attempts backend |
| Kokoro setup status | `kokoro status --json` | Setup & Repair | `getKokoroStatus()` | must | service/status test; setup panel state |
| Kokoro setup stream | `kokoro setup --jsonl` | Setup & Repair | `runKokoroSetupStream()` | must | streaming event schema test; UI renders logs/errors |
| Queue counts | `status --json` | Home, Queue & History | `getStatus()`, `getQueueSummary()` | must | status test; Home renders counts |
| History | `history --json --limit N [--before CURSOR]` | Queue & History | `getHistory({ limit, cursor, filter })` | must | cursor pagination test; UI load-more state; public CLI flag remains `--before` |
| Failed job detail | status attention + history rows | Queue & History, Diagnostics | `getHistory()`, `getDiagnosticsSnapshot()` | must | failed detail component test |
| Clear pending/processing | `queue clear` | Queue & History guarded action | `clearActiveQueue()` | must | confirmation + service test |
| Clear failed | `queue clear --failed` | Queue & History guarded action | `clearFailedJobs()` | must | confirmation + service test |
| Doctor report | `doctor --json` | Diagnostics | `getDoctorReport()` | must | JSON compatibility test; diagnostics render |
| Diagnostic snapshot | macOS copy snapshot | Diagnostics | `getDiagnosticsSnapshot()` | must | redaction/preview test; copy action test |
| Summarizer mode | `summarizer mode heuristic/default` | Voice Bench, Settings | `getConfig()`, `updateConfig()` | must | config test; privacy label matrix test |
| Summarizer model/thinking | config + macOS controls | Voice Bench | `getConfig()`, `updateConfig()` | must | config update tests |
| Hook states | `status --json` install map | Hooks | `getInstallStates()` | must | per-agent state tests |
| Hook install/uninstall | `install --agents`, `uninstall --agents` | Hooks guarded actions | `installHook(agent)`, `uninstallHook(agent)` | must | no-clobber/conflict tests; UI state tests |
| Linux playback backend | currently macOS `afplay` only | Diagnostics, Voice Bench | `detectPlaybackBackend()`, `playWav()` | must | detection order + missing-tool tests |
| Desktop Capsule | new Linux-only surface | Settings + capsule window | `getCapsuleSettings()`, `setCapsuleEnabled()`, `getLatestEvent()`, `speakLatest()` | must, optional by setting | setting persistence + capsule visibility tests; Speak Latest eligibility/error tests |

## CLI Compatibility Contract

The shared app-service refactor must preserve these public command contracts unless an implementation plan explicitly updates tests and explains why compatibility is still safe for macOS:

| Command | Compatibility rule |
|---|---|
| `status --json` | Remains parseable JSON; preserves documented fields used by tests and macOS models, including daemon, queue, attention, install map, and build id semantics. |
| `history --json --limit N [--before CURSOR]` | Remains read-only, cursor-paginated, stable when newer rows arrive, and rejects invalid `--before` cursors/limits as tests expect. App-service may name the parameter `cursor`, but the public CLI flag remains `--before`. |
| `doctor --json` | Remains JSON-only for designed output; does not create config/queue files when checking missing home/config. |
| `kokoro status --json` | Remains read-only and reports managed resource availability. |
| `kokoro setup --jsonl` | Emits parseable JSON lines; exits nonzero on setup failure; preserves event ordering semantics. |
| `test <text>` | Runs manual summarize/speak path; on Linux uses playback backend abstraction instead of hardcoded `afplay`. |
| `queue clear` | Clears pending/processing active jobs and reports count. |
| `queue clear --failed` | Clears failed jobs only and reports count. |
| `summarizer mode heuristic/default` | Keeps existing behavior and validation. |
| `install --agents` / `uninstall --agents` | Preserve per-agent safe mutation, no-clobber, idempotency, and unsupported/unknown state behavior. |
| `pause` / `resume` | Continue to reject until implemented; Linux UI must not expose controls. |
| `config get` | Remains parseable and compatible with macOS config loading. |
| `config set <path> <value>` | Preserves safe dotted-path validation and side-effect behavior. |
| `models list` | Preserves available summarizer model list shape consumed by macOS setup/model controls. |
| `summarizer prompt` | Preserves assembled prompt rendering and validation behavior for prompt preview tooling. |
| daemon `start` / `stop` command paths | Preserve macOS bridge behavior for starting/stopping the daemon and reporting failures. |
| `daemon --foreground` and daemon foreground variants | Preserve daemon lifecycle, lock, status publishing, queue processing, and foreground test-mode behavior. |
| `enable <agent>` / `disable <agent>` | Preserve safe known-agent validation, config mutation semantics, and daemon wake side effects. |
| `enqueue --format ...` | Preserve stdin handling, format validation, event/raw text preservation, deduplication, no-network/local-store behavior, and daemon wake side effects. |
| `voice-codex` / `voice-opencode` bin aliases | Preserve alias behavior and shared Bun lookup helper semantics. |
| hook-generated enqueue command shapes | Preserve installer-generated command/argument formats for Pi, Claude, Codex, and OpenCode hooks. |

Stdout/stderr rule: JSON commands must write machine-readable JSON/JSONL to stdout and diagnostics/errors to stderr in the current style. UI-facing app-service calls should return typed errors instead of parsing human text when possible.

Exit-code rule: existing tested command success/failure behavior is preserved. Implementation planning must inventory exact exit-code tests before changing CLI internals.

Authoritative compatibility rule: all existing public CLI/bin tests remain part of the compatibility contract unless the implementation plan explicitly names a test, explains why behavior can safely change, and preserves macOS/hook compatibility. This includes tests for `enable`/`disable`, `enqueue`, daemon foreground/lifecycle, bin shims, hook-generated enqueue behavior, and daemon wake side effects.

## Product Shape

### Primary surface: Operator Console

The Linux Electron app opens as a conventional, resizable desktop window. This window is the feature-parity anchor and owns all serious workflows:

- setup and repair;
- diagnostics;
- hook installation/uninstallation;
- history and failed jobs;
- settings and privacy state;
- voice/summarizer controls.

The app is keyboard-first but never keyboard-only. Every command must have visible UI equivalents, deterministic focus order, visible focus states, and safe confirmation for destructive actions.

### Secondary surface: Desktop Capsule

The Desktop Capsule is a small optional floating/status sidecar. It ships in v1 but is controlled by a persisted user setting.

Allowed capsule responsibilities:

- show health/latest event at a glance;
- open the full Operator Console;
- speak the latest eligible stored summary;
- open/view queue.

Forbidden capsule responsibilities:

- destructive queue clearing;
- hook install/uninstall;
- setup repair;
- privacy/provider configuration;
- snooze/stay-quiet/pause-like behavior;
- any flow that requires logs, copyable text, consent, or recovery steps.

The full window remains the accessibility and feature-parity anchor. The capsule must have an off switch and must not be required for normal use.

### Personality surface: Voice Bench

Voice Bench is a dedicated tab for playful, tactile voice and soundcheck interactions:

- voice test;
- Kokoro voice selection;
- summarizer mode/thinking/model controls;
- approximate waveform or audio meter;
- privacy labels for local heuristic mode vs provider-backed summarizers.

Waveforms are decorative or approximate feedback, not authoritative audio analysis. Reduced-motion mode must make waveform visuals static or remove motion.

## UI Map and Flow Requirements

### 1. Home / Signal Feed

- Latest agent event.
- Daemon and Kokoro health.
- Queue summary.
- Quick actions: Speak Latest, Voice Test, Open Diagnostics.
- Attention cards for failed jobs, setup issues, hook conflicts, stale daemon, missing playback tool, privacy/provider state changes.
- First-run priority order: missing playback tool → Kokoro not ready → daemon stopped/stale → hooks not installed → privacy/summarizer review.
- Degraded states must show one primary CTA and one diagnostic/detail link.

### 2. Voice Bench

- Voice test.
- Kokoro voice selection.
- Summarizer mode, thinking, and model controls.
- Approximate waveform / audio meter.
- Persistent privacy labels: local heuristic vs external provider-backed summarizer.
- Save/apply/error states for config changes.

### 3. Queue & History

- Pending, processing, done, skipped, and failed jobs.
- Failed job detail with raw error text and summary/source when available.
- Separate guarded actions for clearing active pending/processing jobs and clearing failed jobs.
- Confirmation copy must state exactly what will be removed and that it cannot be undone.
- Processing-job clear semantics must match current `queue clear`: active queue clearing includes pending and processing rows.
- History pagination uses opaque cursors, stable ordering, default page size, loading/empty/error states, terminal page behavior, and invalid-cursor error display.

### 4. Setup & Repair

- Consent screen before downloads or managed dependency changes.
- Consent copy mentions managed `uv`, Python dependencies, model files, network/disk use, and Agent Voice Home path.
- JSONL progress stream with event schema: phase, current step, log lines, warning/error, done/cancelled.
- Log handling includes truncation limits, copy diagnostics, and user-visible latest step.
- Cancellation must respect setup lock behavior and surface whether cleanup is complete or retry is safe.
- Retry must reuse repair-oriented setup semantics and preserve diagnostics from the failed attempt.
- Focus behavior: after error/cancel/done, focus returns to the relevant CTA/status heading and screen readers receive a concise live-region update.

### 5. Hooks

- Pi, Claude, Codex, and OpenCode hook states.
- Installed, not installed, unknown, and unsupported states.
- Target paths and conflict/diagnostic messages.
- Install/uninstall actions with clear feedback.
- Per-agent safety requirements: no clobbering user-owned files, preserve unrelated config, show malformed/permission errors, idempotent uninstall where supported, and copyable conflict diagnostics.
- Hook mutation actions require confirmation that names the target agent and target path.

### 6. Diagnostics

- Doctor report.
- Preview full diagnostic snapshot before copying.
- Paths, build info, runtime info, configuration summary, failed/skipped job text, hook targets, Linux audio backend detection.
- Sensitivity/redaction table:
  - show paths and hook target paths by default but label them local filesystem data;
  - truncate long logs/job text;
  - never include environment variables unless explicitly added by a future approved spec;
  - include provider/model names but not provider credentials;
  - mark failed job text as potentially sensitive before copy.
- Copy action must confirm success and preserve keyboard focus.

### 7. Settings

- Enable/disable Desktop Capsule.
- Agent Voice Home path display.
- Privacy/summarizer defaults.
- Appearance/accessibility toggles if needed.
- Capsule setting persists and immediately creates/destroys or shows/hides the capsule.

## Speak Latest Semantics

`Speak Latest` is a replay action, not a summarization action.

Source of truth:

- Select the newest eligible terminal history item with a non-empty stored summary.
- Eligible status is `done` with stored summary text. Failed, skipped, pending, and processing jobs are not eligible.
- The action does not call external summarizer providers and does not re-summarize raw job text.
- Playback uses the same TTS/playback backend as Voice Test.

Empty/error behavior:

- If no eligible stored summary exists, return a typed `no_latest_summary` error and show a non-destructive empty state.
- If Linux playback backend is missing, return the same missing-backend diagnostic used by Voice Test.
- If TTS/playback fails, show the failure in Home/capsule and link to Diagnostics.

Privacy labeling:

- If the stored summary was originally produced by a provider-backed summarizer, the UI may label the source, but replay itself must not trigger a provider/network call.
- Capsule may run `Speak Latest` only after the user enables the capsule and only for eligible stored summaries.

Test requirements:

- newest done summary is selected;
- failed/skipped/pending/processing rows are ignored;
- no eligible summary returns typed empty error;
- action does not invoke summarizer providers;
- missing playback backend returns typed playback diagnostic;
- capsule and Home render success/error states.

## Privacy State Matrix

| State | Label | Meaning | Quick-action restrictions |
|---|---|---|---|
| Local heuristic | `Local heuristic summaries` | Summaries use local heuristic mode and do not call external summarizer CLIs. | Capsule Speak Latest allowed. |
| Provider-backed configured | `Provider-backed summaries: <provider/model>` | Summaries may call configured `codex`, `pi`, or `opencode` provider/CLI with configured model/thinking. | Capsule must show provider-backed label or open console before first speak if state changed. |
| Kokoro setup downloading | `Downloads required for local voice setup` | Setup may download managed `uv`, Python dependencies, and model files. | Capsule cannot start setup. |
| Diagnostics copy | `Snapshot may include local paths and job text` | Copying diagnostics may include sensitive local context. | Capsule cannot copy diagnostics. |
| Hook mutation | `Will modify <agent> hook config` | Install/uninstall mutates user config files. | Capsule cannot mutate hooks. |

## Implementation Foundation

### Directory layout

Proposed implementation layout for planning:

```text
src/app-service/                 # shared typed service/domain layer
src/platform/playback.ts         # macOS/Linux playback backend abstraction
linux/electron/                  # Electron sibling app
  package.json or uses root scripts
  electron/main.ts
  electron/preload.ts
  renderer/src/App.svelte
  renderer/src/routes/*
  renderer/src/lib/*
```

Alternative layouts can be proposed during planning only if they preserve these boundaries:

- shared service in `src/`, not hidden inside Electron;
- Electron main owns filesystem/process access;
- renderer remains UI-only;
- macOS Swift files untouched.

### App-service contract

Initial app-service modules:

| Module | Responsibility |
|---|---|
| `status-service` | status snapshot, daemon health, attention, install map |
| `daemon-service` | start/stop daemon, stale daemon handling if shared safely |
| `history-service` | cursor history, failed job detail, clear active/failed |
| `kokoro-service` | setup status, JSONL setup stream, cancel/retry, setup diagnostics |
| `config-service` | config read/update, summarizer controls, capsule setting |
| `hook-service` | hook states, install/uninstall, conflict diagnostics |
| `diagnostics-service` | doctor report and diagnostic snapshot/redaction |
| `playback-service` | playback backend detection and WAV playback |

Initial domain error shape:

```ts
type AppServiceError = {
  code: string;
  message: string;
  details?: unknown;
  recoverable: boolean;
};
```

Service methods return typed results or throw/return `AppServiceError` consistently. Implementation planning must choose the exact error transport before coding.

### Dev runtime and scripts

Linux v1 is dev-build only. Proposed root scripts for planning:

- `dev:linux` — launch Electron dev app.
- `test:app-service` — focused app-service tests, or covered by `bun test` if separate script is unnecessary.
- `test:electron` — preload/main contract tests if supported by chosen framework.
- `test:renderer` — Svelte component tests if supported by chosen framework.

Runtime expectation for dev v1:

- Use repository Bun during development.
- Electron app imports/builds the shared TypeScript service through Vite/build tooling.
- Later production packaging may bundle CLI resources and a managed/pinned runtime similarly to the current macOS bundle pattern, but AppImage/`.deb` work is deferred.
- Implementation planning must avoid choices that make later resource/runtime bundling impossible.

## Electron Main / Preload IPC Contract

The exact TypeScript types are implementation-plan work, but the spec requires this shape:

| Preload method/event | Side effect | Main-process guard | Renderer behavior | Negative test |
|---|---|---|---|---|
| `status.get()` | read-only | none beyond service validation | render health/attention | renderer cannot call arbitrary status command |
| `daemon.start()` | starts daemon | no duplicate healthy daemon; typed error on failure | guarded action/result toast | invalid args rejected |
| `daemon.stop()` | stops daemon | confirmation required in renderer; main validates explicit method only | guarded action/result toast | no generic process kill API exposed |
| `voice.test(text?)` | plays test audio | text length/default validation; playback backend detection | result/error in Voice Bench | no shell string execution |
| `voice.speakLatest()` | replays latest eligible stored summary | no external summarizer call; playback backend detection; empty/error handling | Home/capsule Speak Latest result/error | cannot speak arbitrary renderer-provided shell/text command |
| `kokoro.status()` | read-only | none beyond service validation | render setup state | no config mutation |
| `kokoro.setup.start()` event stream | downloads/mutates managed setup | consent token/session id; setup lock; no concurrent run | progress UI with logs/cancel/retry | start without consent rejected |
| `kokoro.setup.cancel()` | cancels setup if possible | active setup id required | cancellation state | wrong id rejected |
| `history.list(params)` | read-only | limit/cursor/filter validation | pagination UI | invalid cursor typed error |
| `queue.clearActive()` | destructive DB mutation | explicit method; renderer confirmation; no broad SQL | guarded result | cannot clear failed via active method |
| `queue.clearFailed()` | destructive DB mutation | explicit method; renderer confirmation | guarded result | cannot clear active via failed method |
| `diagnostics.snapshot()` | read sensitive local data | redaction/truncation policy | preview then copy | no direct filesystem read API |
| `hooks.install(agent)` | mutates user hook config | agent enum validation; no-clobber service | guarded result | unknown agent rejected |
| `hooks.uninstall(agent)` | mutates user hook config | agent enum validation | guarded result | unknown agent rejected |
| `config.get()` | read-only | none beyond service validation | settings/Voice Bench state | no arbitrary config path read |
| `config.update(patch)` | config mutation | schema validation; safe keys only | save/apply/result | unsafe dotted path rejected |
| `capsule.setEnabled(boolean)` | setting + window lifecycle | boolean only | creates/hides capsule | arbitrary window control unavailable |
| `capsule.openConsole()` | window focus/show | only console window | focus main app | no arbitrary URL/window open |
| `events.subscribe()` | read-only subscription | event allowlist | update state | cannot subscribe to raw process output except approved setup stream |

Security baseline:

- `contextIsolation: true`.
- `nodeIntegration: false`.
- No `remote` module.
- No generic `exec`, `spawn`, `openPath`, SQL, filesystem, or arbitrary CLI IPC.
- All process spawning uses argument arrays, never shell strings.
- Renderer confirmations are UX safeguards; main-process validation remains authoritative.

## Linux Playback Contract

Playback backend detection:

1. Search for `paplay` on `PATH`.
2. Search for `aplay` on `PATH`.
3. Return a typed missing-backend diagnostic if neither exists.

Execution requirements:

- Use no-shell process execution with explicit args.
- Write temporary WAV under Agent Voice run/audio directory or current safe temp path used by TTS.
- Delete temp WAV on success, failure, and timeout.
- Enforce timeout matching or deriving from `tts.timeoutSeconds`.
- Capture stderr/stdout with bounded length for diagnostics.
- If selected backend exists but fails, surface that backend failure; do not silently claim success.
- Fallback from `paplay` to `aplay` after execution failure is allowed only if tests document the behavior.
- Diagnostics panel shows selected backend, backend path if known, and last error.

Test requirements:

- detects `paplay` before `aplay`;
- detects `aplay` when `paplay` missing;
- returns missing-tool diagnostic;
- invokes backend with arg array and no shell;
- deletes temp file on success/failure/timeout;
- caps stderr/stdout diagnostic length.

## Accessibility Acceptance Checks

Must-have checks for implementation planning:

- Keyboard-only can complete: first-run recovery, Voice Test, Kokoro setup retry/cancel, hook install/uninstall, clear active/failed, copy diagnostics, enable/disable capsule.
- Focus order follows Operator Rail → page heading → primary content → actions.
- Route changes and setup progress expose useful headings/live-region updates without excessive log spam.
- Confirmation dialogs trap focus, restore focus after close, and are dismissible with Escape.
- Capsule can be focused/operated by keyboard when enabled, and can be disabled from Settings without using the capsule itself.
- Reduced motion disables capsule animation and waveform motion.
- Critical status has text labels; color/waveform/shape is never the only signal.
- UI works at 200% zoom without horizontal clipping for core flows.
- High contrast / forced-colors mode keeps visible focus and readable text.

## Testing Strategy

### Shared app-service tests

- Status parsing and state derivation.
- Config read/update with safe-key validation.
- History and failed-job loading.
- Hook install state mapping and mutation result handling.
- Diagnostic snapshot composition, preview/redaction/truncation.
- Linux audio backend detection and missing-tool messaging.
- Error shape consistency.

### CLI compatibility tests

- Existing CLI JSON output stays stable.
- macOS-facing commands still work.
- Pause/resume remain unsupported and are intentionally hidden in Linux UI.
- CLI JSON/JSONL stdout remains parseable for `status`, `history`, `doctor`, `kokoro status`, and `kokoro setup`.

### Electron main/preload tests

- Renderer only sees the allowlisted API.
- No generic shell command bridge.
- Dangerous actions require explicit methods.
- Invalid preload arguments are rejected.
- Setup stream requires consent token/session id.
- Capsule setting persists and gates capsule creation.

### Svelte component tests

- Navigation renders core sections.
- Home shows health, latest event, queue summary, and degraded-state attention cards.
- Setup progress renders logs, errors, retry, cancel, and live-region labels.
- Hook states render target paths and unknown/unsupported states.
- Queue/history renders pagination, empty/loading/error states, failed detail, and guarded clear actions.
- Voice Bench renders privacy state matrix and hides pause/resume controls.
- Capsule setting toggles persisted preference and capsule visibility.

### Manual dev validation

- `bun test`
- `bun run typecheck`
- `bun run dev:linux`
- Electron dev app launches.
- Voice test on Linux attempts detected system playback tool or shows missing-tool diagnostic.
- Capsule can be enabled and disabled.
- Existing macOS Swift source files remain untouched.

## Acceptance Criteria

- Linux Electron dev app exists as a sibling app using Svelte + Vite + TypeScript.
- The full Operator Console exposes the functional surface in the Feature Parity Matrix except pause/resume is hidden.
- Desktop Capsule ships in v1 as an optional enable/disable setting and only offers safe quick actions.
- Linux voice test uses a detected system playback backend or shows a helpful missing-tool diagnostic.
- Shared app-service layer exists with tested module boundaries and domain errors.
- Electron preload API is narrow, typed, and sandbox-safe.
- Existing CLI behavior remains compatible for macOS Swift.
- No Swift/macOS app files are changed.
- UI direction follows Operator Rail + Signal Feed + Voice Bench rather than a generic settings app.
- First-run/degraded states guide users through playback, Kokoro, daemon, hooks, and privacy review in priority order.
- Diagnostic copy/export includes preview, sensitivity labels, truncation/redaction policy, and confirmation.

## Graphify and Challenge Evidence

Graphify status: queried. Existing graph confirmed the current app structure is SwiftUI macOS UI plus TypeScript CLI/daemon engine.

Dynamax idea challenge summary:

- Raw candidate findings: 30.
- Preserved material findings after adversarial verification: 12.
- Final adjudicated findings: 13.

Key idea-challenge outcomes incorporated into this design:

- `blocker`: Linux playback cannot depend on macOS-only `afplay`.
- `fix-now`: full window is the parity anchor; capsule is secondary.
- `needs-user-decision`: pause/resume hidden for Linux v1.
- `fix-now`: Kokoro setup/repair needs full logs, consent, retry/cancel, and diagnostics.
- `fix-now`: diagnostics, history, hooks, accessibility, IPC security, privacy labels, and Linux floating-window portability are first-class requirements.
- `defer`: shared app semantics extraction details belong in implementation planning.
- `reject`: broad claims that the Signal Deck metaphor is inherently guaranteed to fail were unsupported.

Dynamax written-spec challenge summary:

- Raw candidate findings: 56.
- Preserved material findings: 13.
- Blockers found: feature/CLI parity contract missing; foundational implementation contracts left open.
- This revision adds the parity matrix, CLI compatibility contract, milestone scope, implementation foundation, IPC contract, setup/playback/diagnostics/accessibility/privacy/first-run contracts, and removes ambiguous pause-like vocabulary from Linux v1.

## Remaining Planning Questions

These are implementation-planning details, not design blockers:

- Exact TypeScript type definitions for service results and preload transport.
- Exact Svelte/Electron test framework choices.
- Exact Desktop Capsule window implementation for Linux window managers.
- Whether later production packaging bundles Bun directly, ships a managed runtime, or continues pinned runtime discovery.
