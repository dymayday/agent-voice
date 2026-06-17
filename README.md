<p align="center">
  <img src="assets/app-icon/agent-voice-local-voice-orb.png" alt="Agent Voice icon" width="180">
</p>

# agent-voice

> macOS menu-bar app that speaks a one-line summary when a coding agent finishes.

Agent Voice is app-first. The SwiftUI menu-bar app is the main way to run it; the Bun/TypeScript CLI is the local engine used for setup, hooks, and debugging.

## App-first quick start

```bash
bun install
./bin/agent-voice kokoro setup
./bin/agent-voice doctor --json
./bin/agent-voice test 'hello'
bash scripts/build-macos-app.sh
open "dist/Agent Voice.app"
```

The Kokoro setup command creates the managed local TTS environment, downloads required Python dependencies and Kokoro model files, then updates `tts.python` and `tts.kokoroScript` after the smoke test passes.

Then use the waveform menu-bar icon:

1. Open **Setup**.
2. Run **Voice Test**.
3. Start the daemon.
4. Install a **Pi** or **Claude** hook if you want automatic summaries.
5. Open **Dashboard** for queue, history, diagnostics, voice, summarizer, and repair controls.

## Requirements

- macOS 13+.
- [Bun](https://bun.sh/) on your `PATH`.
- [`uv`](https://docs.astral.sh/uv/) on your `PATH` for automatic Kokoro setup. Agent Voice does not install `uv` for you.
- Swift/Xcode command-line tools to build the app.
- Network access and local disk space during Kokoro setup for Python packages and Kokoro model files.
- Optional summarizer CLIs: `codex`, `pi`, or `opencode`. Missing CLIs fall back to heuristic summaries.

## Kokoro setup and manual overrides

Automatic setup is the recommended path:

```bash
./bin/agent-voice kokoro setup
./bin/agent-voice doctor --json
./bin/agent-voice test 'hello'
```

Managed Kokoro files live under `AGENT_VOICE_HOME/kokoro` (by default, `~/.agent-voice/kokoro`). This directory contains the managed Python environment, Agent Voice's Kokoro service script, cached model files, and install state. Setup may download Python packages and Kokoro model files from the network and can use significant disk space depending on cached model assets.

If you already have a compatible Kokoro JSONL service, keep using the manual override path:

```bash
./bin/agent-voice config set tts.kokoroScript /absolute/path/to/kokoro_tts_service.py
./bin/agent-voice config set tts.python python3
```

A compatible script prints `{"status":"ready"}`, accepts requests like `{"text":"hello","voice":"af_heart"}`, and returns `{"audio":"<base64-wav>"}`.

## What the app controls

The app shells out to `agent-voice` and preserves the local daemon plus SQLite queue architecture. From the app you can:

- Start/stop the daemon.
- Pause/resume speech.
- Run a voice test.
- View queue counts, latest spoken summary, history, failed jobs, and diagnostics.
- Clear pending/processing jobs or failed terminal jobs.
- Change Kokoro voice, summarizer mode, summarizer thinking, and summarizer model.
- Install/uninstall Pi and Claude hooks.
- Copy a diagnostic snapshot.

The app bundle includes the CLI under `Contents/Resources/agent-voice/`, but Bun must still be installed because the bundled shim runs `bun src/index.ts`.

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
printf 'Claude finished editing the authentication module and updated the tests.' \
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
kokoro/           # managed Kokoro .venv, service script, model cache, install state
run/daemon.pid    # daemon lock
run/audio/        # temporary WAV files
```

Set `AGENT_VOICE_HOME` to move the whole state directory. Automatic Kokoro setup writes managed files only under `AGENT_VOICE_HOME/kokoro`.

Queue data, config, generated WAV files, and Kokoro playback stay local. Default summarization may call configured `codex`, `pi`, or `opencode` providers; use `./bin/agent-voice summarizer mode heuristic` for local/no-network summaries. Summarizer privacy and no-network mode are separate from Kokoro setup: the explicit Kokoro setup step may still use the network to download TTS dependencies and model files.

Useful overrides:

```bash
AGENT_VOICE_HOME=/tmp/agent-voice-dev ./bin/agent-voice status
AGENT_VOICE_EXECUTABLE=/path/to/agent-voice \
  "dist/Agent Voice.app/Contents/MacOS/AgentVoiceApp"
```

## Known limitations

- The app is not signed or notarized.
- Bun, `uv`, Python packages, and Kokoro model files are not bundled.
- Automatic Kokoro setup needs an explicit setup run and may need network access; manual script overrides remain available.
- Only Pi and Claude hook installers are available today.

## Development

```bash
bun test
bun run typecheck
swift test --package-path macos/AgentVoiceApp
swift build --package-path macos/AgentVoiceApp
bash scripts/build-macos-app.sh
```

## Troubleshooting

- **No sound:** run **Voice Test** or `./bin/agent-voice test 'hello'`; verify macOS audio output, `afplay`, and `./bin/agent-voice doctor --json`.
- **`uv` is missing:** install `uv`, make sure it is on `PATH`, then rerun `./bin/agent-voice kokoro setup`. Agent Voice does not install `uv` automatically.
- **Dependency install fails:** check network access, package index/proxy settings, and available disk space, then rerun `./bin/agent-voice kokoro setup`; the setup command is repair-oriented.
- **Model download or verification fails:** check network access and disk space under `AGENT_VOICE_HOME/kokoro`; if verification fails, remove the incomplete managed model cache and retry setup instead of trusting the file.
- **Smoke test never emits ready:** run `./bin/agent-voice doctor --json`, review setup logs, and confirm the configured `tts.python` can launch the configured `tts.kokoroScript`.
- **Use an existing Kokoro script manually:** set `tts.kokoroScript` and `tts.python` with the manual override commands above, then run `./bin/agent-voice doctor --json` and `./bin/agent-voice test 'hello'`.
- **Kokoro times out:** confirm the script prints `{"status":"ready"}` and increase `tts.timeoutSeconds` if needed.
- **Queue is stuck:** open Dashboard diagnostics or run `./bin/agent-voice status --json`.
- **Failed jobs:** open Attention/Dashboard, review the cause, then clear failures.
