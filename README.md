<p align="center">
  <img
    src="assets/app-icon/agent-voice-local-voice-orb.png"
    alt="Agent Voice icon"
    width="180"
  >
</p>

# agent-voice

> macOS menu-bar app that speaks a one-line summary when a coding agent
> finishes.

Agent Voice is app-first. The SwiftUI menu-bar app is the main supported app;
the Bun/TypeScript CLI is the local engine used for setup, hooks, and debugging.
A Linux Electron sibling app is now available as a dev-build Operator Console.

## App-first quick start

```bash
bun install
./bin/agent-voice kokoro setup
./bin/agent-voice doctor --json
./bin/agent-voice test 'hello'
just run
```

`just run` opens the native app for your platform: the Swift menu-bar app on
macOS and the Electron Operator Console on Linux. Use explicit app targets when
you want to override that default, such as `just run-electron` on macOS.

The Kokoro setup command is repair-oriented and safe to rerun. It creates or
reuses the managed local TTS environment, downloads required Python dependencies
and Kokoro model files, then updates `tts.python` and `tts.kokoroScript` only
after the smoke test passes. If `uv` is not on `PATH`, setup installs a private
pinned/checksummed `uv` under Agent Voice Home and exposes that managed
toolchain during dependency install, model preload, and smoke testing.

If you launch the app before Kokoro is ready, Agent Voice opens the Dashboard
and prompts with the Kokoro Installer. Click **Start Installing** only after
reviewing that it may download managed `uv`, Python dependencies, and model
files; the installer provides live details, cancel/retry controls, and copyable
diagnostics.

Then use the waveform menu-bar icon:

1. Open **Setup**.
2. Run **Voice Test**.
3. Start the daemon.
4. Install a **Pi**, **Claude**, **Codex**, or **OpenCode** hook if you want
   automatic summaries.
5. Open **Dashboard** for queue, history, diagnostics, voice, summarizer, and
   repair controls.

## Linux Electron dev app

Linux v1 ships as a dev-build sibling app, not a packaged production app. It
uses the same Bun/TypeScript app-service layer and local queue/daemon/Kokoro
engine as the CLI and macOS app, with a Svelte + Vite + TypeScript renderer and
a narrow typed preload IPC surface.

```bash
bun install
just dev-electron
```

The Operator Console includes:

- **Home / Signal Feed** for daemon, Kokoro, playback, queue, and first-run
  actions.
- **Voice Bench** for sound checks, voice selection, and summarizer privacy
  labels.
- **Queue & History** for pending, processing, done, skipped, and failed jobs,
  plus guarded queue cleanup.
- **Setup & Repair** for consent-gated Kokoro setup with session-scoped progress
  events and best-effort cancel.
- **Hooks**, **Diagnostics**, and **Settings** panels for agent hook state,
  privacy-safe snapshots, summarizer settings, and Desktop Capsule opt-in.

The renderer has no Node access. Electron exposes only allowlisted app actions;
there is no generic `ipcRenderer`, shell, filesystem, SQL, spawn, or exec escape
hatch. The optional Desktop Capsule uses a separate capsule-only preload with
safe actions only: **Open Console**, **Speak Latest**, and **View Queue**.

Linux playback probes `paplay` first and falls back to `aplay`. Install one of
those tools before expecting sound from the Linux app. Pause/resume controls are
intentionally hidden in Linux v1.

## Requirements

- macOS 13+ for the SwiftUI menu-bar app.
- Linux with `paplay` or `aplay` for the Electron dev app.
- [Bun](https://bun.sh/) on your `PATH`.
- [just](https://github.com/casey/just) for the platform-aware workflow commands.
- Swift/Xcode command-line tools to build the macOS app.
- Network access and local disk space during Kokoro setup for managed `uv`,
  Python packages, and Kokoro model files.
- Optional summarizer CLIs: `codex`, `pi`, or `opencode`. Missing CLIs fall
  back to heuristic summaries.

## Kokoro setup and manual overrides

From the CLI, run:

```bash
./bin/agent-voice kokoro setup
./bin/agent-voice doctor --json
./bin/agent-voice test 'hello'
```

Automatic setup is the recommended, self-healing path:

- Uses a setup lock so only one Kokoro install runs per Agent Voice Home. Empty
  or dead-PID stale locks are removed automatically; active concurrent installs
  are rejected.
- Uses your system `uv` when available; otherwise downloads a pinned `uv`
  release archive over HTTPS, verifies its SHA-256 checksum, and installs it as
  `AGENT_VOICE_HOME/kokoro/bin/uv`.
- Copies the bundled Kokoro JSONL service script, creates the managed `.venv`
  only when missing, and reruns dependency installation on each setup attempt so
  repair/retry is idempotent.
- Preloads Kokoro model assets with `HF_HOME` pointed at
  `AGENT_VOICE_HOME/kokoro/models/huggingface`.
- During model preload and smoke testing, prepends the managed `.venv/bin` and
  `kokoro/bin` directories to `PATH` and sets `VIRTUAL_ENV`, so setup works even
  when no system `uv` is available.
- Suppresses known Kokoro/PyTorch/Hugging Face warning noise during preload and
  smoke testing while preserving real command failures in diagnostics.
- Saves `tts.python` and `tts.kokoroScript` only after the service passes a real
  smoke test.

Managed Kokoro files live under `AGENT_VOICE_HOME/kokoro` (by default,
`~/.agent-voice/kokoro`). This directory contains the managed Python
environment, Agent Voice's Kokoro service script, a private managed `uv` binary
when no system `uv` is available, cached model files, install state, and the
transient setup lock. Python packages and Kokoro model files are downloaded from
the network and can use significant disk space depending on cached model assets.

If you already have a compatible Kokoro JSONL service, keep using the manual
override path:

```bash
./bin/agent-voice config set \
  tts.kokoroScript /absolute/path/to/kokoro_tts_service.py
./bin/agent-voice config set tts.python python3
```

A compatible script prints `{"status":"ready"}`, accepts requests like
`{"text":"hello","voice":"af_heart"}`, and returns
`{"audio":"<base64-wav>"}`.

## What the app controls

The app shells out to `agent-voice` and preserves the local daemon plus SQLite
queue architecture. From the app you can:

- Start/stop the daemon.
- Pause/resume speech.
- Run a voice test.
- Open Setup or the consent-gated Kokoro Installer when local TTS needs repair.
- View queue counts, latest spoken summary, history, failed jobs, and
  diagnostics.
- Clear pending/processing jobs or failed terminal jobs.
- Change Kokoro voice, summarizer mode, summarizer thinking, and summarizer
  model.
- Install/uninstall Pi, Claude, Codex, and OpenCode hooks.
- Copy a diagnostic snapshot.

The app bundle includes the CLI under `Contents/Resources/agent-voice/`, but
Bun must still be installed because the bundled shim runs `bun src/index.ts`.

## Agent hooks

Use **Setup → Agents** in the app, or run:

```bash
./bin/agent-voice install --agents pi
./bin/agent-voice install --agents claude
./bin/agent-voice uninstall --agents pi
./bin/agent-voice uninstall --agents claude
```

Codex, OpenCode, LaunchAgent, and wrapper installers are not implemented yet.

## CLI fallback

Use the CLI when scripting or debugging without the app:

```bash
./bin/agent-voice daemon --foreground
printf 'Claude finished the auth refactor and updated tests.' \
  | ./bin/agent-voice enqueue --format text --agent claude --cwd "$PWD"

./bin/agent-voice status --json
./bin/agent-voice history --json --limit 50
./bin/agent-voice doctor --json
./bin/agent-voice pause
./bin/agent-voice resume
./bin/agent-voice queue clear
./bin/agent-voice queue clear --failed
./bin/agent-voice summarizer mode heuristic
./bin/agent-voice summarizer mode default
```

## Storage and privacy

State lives in `~/.agent-voice` by default:

```text
config.json       # user settings
queue.db          # SQLite queue and history
kokoro/           # managed .venv, script, bin/uv, models, setup lock
run/daemon.pid    # daemon lock
run/audio/        # temporary WAV files
```

Set `AGENT_VOICE_HOME` to move the whole state directory. Automatic Kokoro setup
keeps the managed virtual environment, service script, managed `uv` binary,
install state, and Hugging Face model cache under `AGENT_VOICE_HOME/kokoro`.
Package managers may still use normal user-level caches unless configured
separately.

Queue data, config, generated WAV files, and Kokoro playback stay local. Default
summarization may call configured `codex`, `pi`, or `opencode` providers; use
`./bin/agent-voice summarizer mode heuristic` for local/no-network summaries.
Summarizer privacy and no-network mode are separate from Kokoro setup: the
explicit Kokoro setup step may still use the network to download TTS
dependencies and model files.

Useful overrides:

```bash
AGENT_VOICE_HOME=/tmp/agent-voice-dev ./bin/agent-voice status
AGENT_VOICE_EXECUTABLE=/path/to/agent-voice \
  "dist/Agent Voice.app/Contents/MacOS/AgentVoiceApp"
```

## Known limitations

- The app is not signed or notarized.
- Bun, Python packages, and Kokoro model files are not bundled.
- Automatic Kokoro setup can install a private managed `uv` binary from a
  pinned, checksummed release archive under Agent Voice Home and may need
  network access. Unsupported platforms should install `uv` manually or use a
  manual script override.
- Pi, Claude, Codex, and OpenCode hook installers are available. Codex installs
  agent-voice-owned `Stop` + `PermissionRequest` entries under the top-level
  `hooks` object in `~/.codex/hooks.json` and relies on Codex's default-on
  `features.hooks`; `doctor` warns if a user has set `features.hooks = false`.
  OpenCode installs a plugin at
  `~/.config/opencode/plugin/agent-voice.ts`; turn completions are reliable while
  tool-approval announcements are best-effort across OpenCode versions.

## Development

Use `just` for platform-aware native app commands:

```bash
just dev      # macOS: Swift app; Linux: Electron app
just build    # macOS: Swift app; Linux: Electron app
just run      # macOS: Swift app; Linux: Electron app
just verify   # common checks + native app checks
just ship     # verify + build native app
```

Use explicit app targets when you do not want platform defaults:

```bash
just dev-electron
just build-electron
just run-electron
just verify-electron
just ship-electron

just dev-swift
just build-swift
just run-swift
just test-swift
just verify-swift
just ship-swift
```

The underlying commands remain available for debugging:

```bash
bun test
bun run typecheck
bun run test:renderer
bun run check:renderer
bun run build:linux-renderer
bun run build:linux-main
bun run dev:linux
swift test --package-path macos/AgentVoiceApp
swift build --package-path macos/AgentVoiceApp
bun run build:macos
bun run clean:cache
# Removes macos/AgentVoiceApp/.build if SwiftPM cache is stale.
```

`bash scripts/build-macos-app.sh --clean-cache` also removes the SwiftPM cache
before building. The build script retries once automatically when Swift reports
stale module-cache paths such as `missing required module 'SwiftShims'`.

## Troubleshooting

- **macOS build reports stale Swift module cache or `SwiftShims`:** run
  `bun run clean:cache` or build with
  `bash scripts/build-macos-app.sh --clean-cache`.
- **No sound:** run **Voice Test** or `./bin/agent-voice test 'hello'`; verify
  macOS audio output, `afplay`, and `./bin/agent-voice doctor --json`.
- **Managed `uv` install fails:** check network access, proxy settings,
  checksum/download errors, and available disk space under
  `AGENT_VOICE_HOME/kokoro`, then rerun `./bin/agent-voice kokoro setup`.
- **Dependency install fails:** check network access, package index/proxy
  settings, and available disk space, then rerun
  `./bin/agent-voice kokoro setup`; the setup command is repair-oriented and
  reuses the managed `.venv` when possible.
- **Setup says it is already running:** another installer is active for the same
  Agent Voice Home. If no installer is active, rerun setup; stale empty/dead-PID
  locks are cleaned automatically.
- **Model download or verification fails:** check network access and disk space
  under `AGENT_VOICE_HOME/kokoro`; if verification fails, remove the incomplete
  managed model cache and retry setup instead of trusting the file.
- **Smoke test never emits ready:** run `./bin/agent-voice doctor --json`,
  review setup logs, and confirm the configured `tts.python` can launch
  `tts.kokoroScript`.
- **Use an existing Kokoro script manually:** set `tts.kokoroScript` and
  `tts.python` with the manual override commands above, then run
  `./bin/agent-voice doctor --json` and `./bin/agent-voice test 'hello'`.
- **Kokoro times out:** confirm the script prints `{"status":"ready"}` and
  increase `tts.timeoutSeconds` if needed.
- **Queue is stuck:** open Dashboard diagnostics or run
  `./bin/agent-voice status --json`.
- **Failed jobs:** open Attention/Dashboard, review the cause, then clear
  failures.
