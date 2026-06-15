# Agent Voice Mac App Design

Date: 2026-06-15
Status: Draft after SQLite queue correction pass

## Goal

Turn `agent-voice` from a CLI-first local daemon into a native-feeling macOS app while preserving the current architecture: coding agents enqueue completed turns to the local SQLite queue (`queue.db`), the daemon summarizes each turn into one sentence, and Kokoro speaks the result locally.

The Mac app should make the system easier to trust, start, pause, inspect, and repair. It should not replace the CLI/daemon protocol, hide operational truth, or become another chat interface.

## Product direction

Use all three brainstormed surfaces:

1. **Menu bar sentinel** — the primary daily surface.
2. **Dashboard console** — the observability and debugging surface.
3. **Setup assistant** — the first-run and repair surface.

The app is a quiet local utility. Most days the user should only notice the menu bar icon and occasional speech. When something breaks, the dashboard and setup assistant should expose the truth without forcing the user into Terminal.

## Visual identity

Chosen icon: **Local Voice Orb**

- Committed source asset: `assets/app-icon/agent-voice-local-voice-orb.png`
- Required source dimensions: `1024x1024` PNG before `.icns` conversion.
- Brand read: “A local warm voice daemon, quietly alive.”

Keep the icon direction calm, premium, local, and slightly mysterious. The teal orb and warm copper center are the recognizable brand elements. Do not replace it with a robot, microphone, speaker, chat bubble, or target-like concentric-ring motif.

Generated exploration files may remain local brainstorming artifacts, but the app spec depends only on the committed `assets/app-icon/agent-voice-local-voice-orb.png` asset.

## Non-goals

- Do not reimplement summarization, SQLite queueing, or TTS inside the UI process.
- Do not add cloud sync, accounts, telemetry, or hosted storage.
- Do not require the Mac app for headless CLI use.
- Do not make the UI a full chat client.
- Do not silently mutate global agent configs during first launch.
- Do not add privacy/redaction behavior; the local project intentionally preserves raw local event text and queue data.
- Do not claim adapter installation exists until `agent-voice install` and wrapper behavior are implemented and tested.

## Recommended implementation approach

Build a native SwiftUI macOS app that orchestrates the existing CLI/daemon.

### Why native SwiftUI

- Fits a menu bar utility better than Electron or a browser shell.
- Gives first-class access to `MenuBarExtra`, `Settings`, launch-at-login UI, notifications, and macOS materials.
- Keeps the app lightweight enough to feel like infrastructure, not another workspace.
- Can shell out to the existing `agent-voice` executable while the daemon and SQLite queue contract remain unchanged.

### Alternatives considered

- **Electron/Tauri dashboard first:** faster to iterate visually, but too heavy for a menu bar daemon utility and adds packaging/runtime complexity.
- **CLI-only with LaunchAgent:** already viable, but it hides state and makes troubleshooting too terminal-heavy.
- **Full native rewrite of daemon:** unnecessary and risky; the current Bun/TypeScript daemon already has tests and clear module boundaries.

## Architecture

```text
SwiftUI Mac app
  ├─ Menu bar sentinel
  ├─ Setup assistant
  ├─ Dashboard console
  └─ CLI bridge
       ↓
agent-voice CLI
  ├─ config get/set
  ├─ start/stop/status
  ├─ test
  └─ future app-facing JSON/repair commands
       ↓
~/.agent-voice/
  ├─ config.json
  ├─ queue.db
  ├─ run/daemon.pid
  └─ run/intentional-stop
       ↓
agent-voice daemon
  ├─ summarizer fallback chain
  ├─ Kokoro JSONL subprocess
  └─ afplay playback
```

The SwiftUI app should treat the CLI JSON commands as the source of truth. It may cache recent status for UI responsiveness, but it must refresh from `agent-voice status --json`, `agent-voice history --json`, and `config get`.

The app must not own a second daemon implementation. It starts and stops the existing daemon through CLI commands and reads status from the daemon lock and SQLite queue state exposed by CLI status/history commands.

## Implementation scope slices

### Slice 1: Development Mac app

- Native app runs from this repo during development.
- CLI bridge points at repo-local `./bin/agent-voice` or a user-selected executable path.
- Menu bar, setup, and dashboard can be implemented against current CLI plus tested app-facing status/history JSON commands.
- No global adapter installation is performed.

### Slice 2: App-facing CLI improvements

Add tested CLI commands the app can safely parse:

- `agent-voice status --json`
- `agent-voice history --json`
- Guarantee current `agent-voice config get` continues to emit stable JSON for app parsing; do not add a separate JSON flag in this slice.
- `agent-voice doctor --json`
- `agent-voice pause` / `agent-voice resume`
- A safe way to set summarizer priority, because current `config set` intentionally rejects array replacement.

### Slice 3: Packaged app

- Bundle a stable `agent-voice` executable or require the user to choose one explicitly.
- Convert the selected PNG icon to `.icns` / asset catalog.
- Add launch-at-login only after daemon ownership is explicit and tested.
- Adapter installation remains an explicit later phase unless install/uninstall support is implemented first.

## Core surfaces

### 1. Menu bar sentinel

Primary use: daily control and confidence.

Required elements:

- Status icon using the Local Voice Orb identity.
- Health state: `Ready`, `Processing`, `Paused`, `Needs Attention`, `Daemon Stopped`.
- Voice summaries toggle.
- Pause actions supported by the current implementation stage:
  - Slice 1: pause until resumed via `config.enabled=false` / resume via `config.enabled=true`.
  - Later slice: timed pause after explicit CLI/config support exists.
- Last spoken summary with source agent and timestamp when available from done-job queue data.
- Queue count badge when pending/failed jobs are non-zero.
- Quick actions:
  - Open Dashboard
  - Run Voice Test
  - Open Setup / Repair
  - Start Daemon / Stop Daemon

Behavior:

- The menu bar should be useful even when the main window is closed.
- If the daemon is healthy and idle, the popover should be compact.
- If anything needs attention, the popover should show one clear next action.
- No raw captured text should be displayed in the compact popover by default beyond the spoken one-line summary.
- The app should call the state `Processing` unless it has reliable playback-level evidence. Current daemon state only exposes queue processing, not exact `afplay` activity.

### 2. Dashboard console

Primary use: observability, debugging, and confidence.

Required sections:

- Daemon card: PID, running/stopped/stale, start/stop controls.
- Kokoro card: configured script path, script existence, voice, test button, last successful app-run voice test if available.
- Queue cards: pending, processing, done, failed, skipped.
- Recent events list derived from done jobs:
  - timestamp
  - agent
  - summary spoken when `summary` exists
  - spoken timestamp when `finishedAt` exists
  - final state
- Failed jobs list derived from failed jobs:
  - agent
  - attempt count / retry state when present
  - `lastError` when present
  - open/reveal Agent Voice home or queue database
- Agent status grid for Claude, Codex, Pi, OpenCode using config `agents.<name>.enabled` and `agents.<name>.mode`.

Behavior:

- The dashboard must avoid pretending the system is healthier than it is.
- Failed job details may expose local queue database and Agent Voice home paths. That is acceptable for this local tool.
- Provide open/reveal actions for the local Agent Voice home and queue database instead of hiding operational state from advanced users.
- Use read-only inspection first; destructive cleanup actions should be explicit and confirmed.
- Do not claim Kokoro is currently ready unless a fresh voice test or future doctor command verifies it. Current `status` does not report Kokoro readiness.

### 3. Setup assistant

Primary use: first-run onboarding and later repair.

Flow:

1. Welcome: explain “one-line spoken summaries when coding agents finish.”
2. Kokoro: choose Python executable and Kokoro script, then run a voice test.
3. Summarizers: show current fallback chain. Heuristic-only mode requires a CLI/config enhancement before UI can write it safely.
4. Agents: enable Claude, Codex, Pi, OpenCode and show support tier honestly.
5. Daemon: start daemon and explain whether launch-at-login is available in the current build.
6. Finish: enqueue a sample event and confirm speech.

Rules:

- Setup can be reopened later as “Repair Setup.”
- Each step should show pass/fail checks with actionable fixes.
- Do not silently install hooks/wrappers. Show what will be changed before writing global config.
- Slice 1 setup may mutate only project-owned config under `~/.agent-voice/config.json` through tested CLI commands.
- Any mutation outside `~/.agent-voice` requires preview, explicit confirmation, timestamped backup, and uninstall/restore support.
- Adapter installation can remain a later implementation phase; the first Mac app version may support manual mode plus daemon/config management.

## Status model

The app should derive high-level UI state from CLI status, history, and doctor checks.

| UI state | Current evidence | Meaning | Primary action |
| --- | --- | --- | --- |
| Ready | Daemon lock is healthy, no failed jobs, config enabled | System appears able to process queued events | No action |
| Processing | status/history reports at least one `processing` job | A job is being summarized, spoken, or recovered | Show current source agent |
| Paused | `config.enabled=false` or a future pause flag is active | User intentionally disabled speech processing | Resume |
| Needs Attention | failed jobs exist, Kokoro script missing, invalid config, or stale lock | User action is likely required | Open repair step |
| Daemon Stopped | No healthy daemon lock | No background processor is active | Start daemon |

The app may use polling for v1. A future version can add a daemon status JSON command or local IPC, but v1 should not require a server/socket redesign.

## Queue-derived event definitions

The dashboard should derive read-only state from app-facing CLI JSON commands backed by `queue.db`. Definitions must match the current SQLite jobs table exposed through `status --json` and `history --json`.

- **Queue counts:** `pending`, `processing`, `done`, `failed`, and `skipped` counts from `status --json`.
- **Pending event:** a queued job in SQLite status `pending`; compact UI may show count only.
- **Processing event:** a claimed job in SQLite status `processing`; use `agent`, `createdAt`, `cwd`, `attempts`, and `lastAttemptAt` if exposed by a future command.
- **Done event:** a history job in SQLite status `done`; display `summary` and `finishedAt` when present. Hide raw `text` behind explicit reveal/open actions.
- **Failed event:** a history job in SQLite status `failed`; display `lastError`, `attempts`, `agent`, `createdAt`, and the queue database/home location.
- **Skipped event:** a history job in SQLite status `skipped`; display `skipReason` when present.
- **Recent events ordering:** prefer `finishedAt`, then `createdAt`.

The app should tolerate missing optional fields and older history JSON without crashing. Unknown fields should be ignored.

## CLI bridge contract

The app should call the existing CLI rather than import TypeScript internals.

### Commands available today

```bash
agent-voice status
agent-voice config get
agent-voice config set <scalar.path> <value>
agent-voice enable <agent>
agent-voice disable <agent>
agent-voice start
agent-voice stop
agent-voice test "hello"
agent-voice enqueue --format text --agent claude --cwd "$PWD"
```

Current caveats:

- `status` is plain text, not JSON.
- `config get` prints JSON and creates defaults if missing.
- `config set` only updates known scalar leaf values. It rejects arrays and whole sections.
- `install` and `uninstall` appear in help but are not implemented yet.
- `start` currently spawns the daemon directly; it does not yet load a LaunchAgent.

### Commands required before polished app dependency

- `agent-voice status --json`
- `agent-voice history --json`
- `agent-voice doctor --json`
- `agent-voice pause` / `agent-voice resume`
- a narrow command for summarizer priority, such as `agent-voice summarizer mode heuristic|default`.
- `agent-voice install` / `agent-voice uninstall` only if the app will install adapters or LaunchAgents.

These additions should be implemented in the CLI with tests before the SwiftUI app depends on them.

## Daemon ownership rules

- The app does not spawn its own long-running processor outside the CLI path.
- The app starts the existing daemon via `agent-voice start`.
- The app stops the daemon via `agent-voice stop`.
- The app treats `run/daemon.pid` as a lock/status hint, not proof that the PID belongs to the app.
- The app must not send signals directly to arbitrary PIDs. It delegates stop behavior to the CLI.
- If launch-at-login is added later, the spec for who owns the LaunchAgent/App login item must be explicit before implementation.

## Data and privacy wording

The Mac app should use direct wording:

- Captured completed-turn text is local and stored in `~/.agent-voice/queue.db`.
- The configured summarizer CLIs may send text to their model providers.
- The Kokoro TTS path is local.
- Heuristic-only mode avoids external summarizer CLIs once the config can be set safely.
- No privacy/redaction layer exists in this project by design.

Do not add “secure by default” or “private by default” marketing language that implies redaction or network isolation. Say “local files, local daemon, configurable summarizers” instead.

## Packaging and launch behavior

Target packaging path:

- Native `.app` bundle with a bundled or user-selected `agent-voice` executable.
- App icon generated from `assets/app-icon/agent-voice-local-voice-orb.png` into a proper `.icns` asset catalog.
- Optional launch-at-login toggle only after daemon ownership is clarified.
- Existing CLI remains usable from Terminal.

Concrete staged decision:

1. Development version shells out to repo-local `./bin/agent-voice`.
2. Before packaged release, choose one runtime strategy:
   - bundle a compiled standalone CLI executable, or
   - bundle Bun plus TypeScript sources, or
   - require the user to select an external `agent-voice` executable.
3. Prefer a bundled compiled executable for a distributable app, but treat this as an implementation-plan decision because the current project does not yet build one.
4. Installer/LaunchAgent work remains explicit and reversible.

## Testing strategy

### CLI foundation before app

Add tests for any new app-facing CLI commands:

- JSON status output.
- JSON history output.
- Pause/resume behavior.
- Doctor/repair checks.
- Stable exit codes and parseable errors.
- Summarizer priority update command if the UI controls heuristic-only mode.

### SwiftUI app tests

- Unit-test status parsing and state derivation.
- Unit-test history JSON decoding and optional-field tolerance.
- Unit-test CLI bridge command construction with fake process runners.
- Unit-test setup assistant state machine and mutation rules.
- Snapshot or UI-test the three key surfaces if the project adds a Swift test target.

### Manual verification

- Start app with no config: setup assistant appears.
- Configure Kokoro and run voice test.
- Start daemon from menu bar.
- Enqueue sample event and hear speech.
- Stop daemon and verify menu bar shows stopped state.
- Create a fake failed SQLite job and verify dashboard surfaces it through `history --json`.
- Verify no global agent config is changed unless the user explicitly confirms an install action.

## Implementation sequence preview

This is not the implementation plan. It is the likely sequence after spec approval:

1. Add app-facing JSON CLI/status commands.
2. Add pause/resume or equivalent global enabled-state command.
3. Add a narrow summarizer mode command for priority switching.
4. Create SwiftUI app shell and CLI bridge.
5. Add menu bar sentinel.
6. Add setup assistant.
7. Add dashboard console and history models.
8. Add icon asset catalog and development packaging basics.
9. Add launch-at-login / install flow only after UI and CLI bridge are stable.

## Acceptance criteria

The design is accepted when:

- The user agrees the Mac app uses A+B+C: menu bar, dashboard, setup assistant.
- The selected icon is `assets/app-icon/agent-voice-local-voice-orb.png`.
- The app preserves the current SQLite queue/daemon architecture.
- The app distinguishes commands available today from commands required before polished app dependency.
- The app does not silently install or mutate global agent configs.
- The next step can be a concrete implementation plan with tests.
