# Kokoro Bootstrap Setup Design

## Goal

Make Agent Voice shareable without requiring users to hand-wire a separate Kokoro checkout. The first implementation should use an explicit setup-time bootstrap: the repo ships the Kokoro JSONL service script, and `agent-voice kokoro setup` installs runtime dependencies and model assets under `AGENT_VOICE_HOME`.

This is option 1 from the packaging decision. It improves standalone source/app sharing while avoiding a heavy fully bundled Python/Kokoro app bundle for now.

## User-approved decisions

- Setup starts from an explicit **Install Kokoro** button, not automatically.
- The temporary setup window uses **friendly steps plus expandable logs**.
- Automatic setup uses `uv` first and fails clearly if `uv` is missing.
- The Kokoro service script is committed to this repository instead of generated at runtime or cloned from another repo.
- The setup command is idempotent and repair-oriented.

## Non-goals

- Do not fully vendor Python, Kokoro dependencies, or model files in the macOS app bundle yet.
- Do not curl-pipe install `uv` or any dependency manager.
- Do not add automatic background setup on first launch.
- Do not change summarizer defaults as part of this feature.
- Do not implement a full uninstall command in v1 unless it falls out cheaply from the setup state model.

## Architecture

Add a small Kokoro bootstrap subsystem with one repo-owned Python service script and one TypeScript setup module.

```text
resources/kokoro/kokoro_tts_service.py   # committed service script
src/kokoro-setup.ts                       # setup/status logic
```

The setup command installs into the Agent Voice home directory:

```text
AGENT_VOICE_HOME/kokoro/
  .venv/
  kokoro_tts_service.py
  models/
  install-state.json
```

The app and CLI share the same command. The macOS app does not duplicate install logic; it runs the CLI with JSONL progress and renders the progress window.

## CLI contract

### Commands

```bash
agent-voice kokoro setup [--jsonl]
agent-voice kokoro status --json
```

`agent-voice kokoro setup` must:

1. Resolve `AGENT_VOICE_HOME/kokoro`.
2. Verify `uv` exists on `PATH`.
3. Create the install directory.
4. Copy `resources/kokoro/kokoro_tts_service.py` into the install directory.
5. Create or repair `.venv` using `uv venv`.
6. Install pinned Python dependencies with `uv pip install ...`.
7. Download/cache required Kokoro model assets under `models/`.
8. Verify model checksums when fixed URLs are used.
9. Update only these config fields:
   - `tts.python`
   - `tts.kokoroScript`
10. Start the service and wait for `{"status":"ready"}`.
11. Exit 0 only when config points to a usable local Kokoro setup.

`agent-voice kokoro status --json` should report whether the managed install exists and which checks pass. It should not create or mutate files.

### Progress events

With `--jsonl`, stdout emits one JSON object per line. The app treats stdout as the structured event stream. Human-readable subprocess logs are wrapped in `log` events.

```json
{"type":"step","id":"prepare","status":"running","title":"Preparing install directory"}
{"type":"log","stream":"stdout","message":"Created ~/.agent-voice/kokoro"}
{"type":"step","id":"venv","status":"done","title":"Created Python environment"}
{"type":"step","id":"model","status":"failed","title":"Downloaded model","error":"checksum mismatch"}
{"type":"complete","ok":false}
```

Step ids:

```text
prepare
uv-check
script
venv
deps
model
config
smoke-test
```

Statuses:

```text
pending
running
done
failed
skipped
```

### Idempotency and repair

Repeated setup runs must be safe:

- existing good install: verify and leave it alone,
- missing script: recopy,
- missing venv or dependencies: recreate/repair,
- missing model: redownload,
- stale config: update config,
- checksum mismatch: fail and do not silently trust the file.

Config mutation must be narrow. A failed setup should not rewrite `tts.python` or `tts.kokoroScript` unless the managed install has reached the smoke-test-ready state.

## macOS setup UX

The Setup Assistant Kokoro step shows:

- current Kokoro script path,
- current voice,
- **Install Kokoro** primary button,
- **Choose existing script…** secondary/manual path if implemented in this pass,
- disclosure that setup uses network and local disk space.

Clicking **Install Kokoro** opens a temporary window:

```swift
Window("Installing Kokoro", id: AgentVoiceWindowID.kokoroSetup)
```

### Progress window states

Model the progress window with explicit states:

```swift
KokoroSetupState.idle
KokoroSetupState.running(currentStep, completedSteps, logs)
KokoroSetupState.succeeded(summary)
KokoroSetupState.failed(error, logs)
KokoroSetupState.cancelled(logs)
```

### Progress window content

The temporary window includes:

- title: “Installing Kokoro”,
- current friendly step,
- progress indicator,
- checklist of setup steps,
- expandable **Details** log,
- **Cancel** while running,
- **Retry** after failure,
- **Copy Diagnostics** after failure,
- **Done** after success.

On success, the app refreshes config, doctor, and status. On failure, the window stays open with actionable guidance such as installing `uv`, retrying, or choosing an existing script.

Cancel should terminate the child process when possible. Partial installs are acceptable because the CLI setup command repairs them on the next run.

### Accessibility

- Step text is readable by VoiceOver.
- Failure information is text, not color-only.
- Logs are selectable/copyable.
- Buttons have stable labels.
- The window does not auto-dismiss on failure.

## Security and privacy

- Setup requires explicit user action.
- Never install `uv` automatically or run remote shell installers.
- Pin Python package versions.
- Verify model checksums for fixed URLs.
- Do not log environment variables, tokens, or full inherited process environments.
- Write managed files only under `AGENT_VOICE_HOME/kokoro`.
- Do not follow untrusted symlinks inside the managed install directory when overwriting managed files.
- Use narrow config updates for `tts.python` and `tts.kokoroScript` only.
- Keep diagnostic logs local and copyable by the user.

## Documentation changes

Update README quick start from manual Kokoro wiring to:

```bash
./bin/agent-voice kokoro setup
./bin/agent-voice doctor --json
./bin/agent-voice test 'hello'
```

Keep manual override docs:

```bash
./bin/agent-voice config set tts.kokoroScript /absolute/path/to/kokoro_tts_service.py
./bin/agent-voice config set tts.python python3
```

Document:

- `uv` is required for automatic setup,
- setup downloads dependencies/model files,
- all managed files live under `AGENT_VOICE_HOME/kokoro`,
- local-only/no-network summarizer mode is separate from Kokoro setup,
- troubleshooting for missing `uv`, download failure, checksum failure, smoke-test failure, and manual script override.

## Tests

### Bun/TypeScript tests

- CLI help includes `kokoro setup` and `kokoro status`.
- `kokoro setup --jsonl` emits ordered progress events.
- Missing `uv` fails clearly before mutating config.
- Setup copies the committed service script.
- Setup updates only `tts.python` and `tts.kokoroScript`.
- Repeated setup is idempotent.
- Checksum mismatch fails and leaves config unchanged.
- `kokoro status --json` is read-only.
- `doctor` recognizes the installed managed script.
- Smoke-test failure is reported as a setup failure.

### Swift/macOS tests

- `AgentVoiceCLI` can run streaming Kokoro setup.
- `AppModel.installKokoro()` transitions running to succeeded from JSONL events.
- Failure events expose retry and copy-diagnostics state.
- Cancel terminates the process and marks setup cancelled.
- Setup Assistant shows **Install Kokoro**.
- Temporary setup window is registered.
- Progress window shows friendly steps and expandable details.
- Accessibility labels/values exist for progress and error states.

## Acceptance criteria

- A fresh user with Bun, Python-capable macOS, and `uv` can run `agent-voice kokoro setup` without manually cloning a Kokoro repo.
- After successful setup, `agent-voice doctor --json` reports the Kokoro script check as passing.
- The macOS app can launch setup from the Kokoro step and show live progress.
- Setup failures are actionable and do not silently corrupt existing config.
- The design remains compatible with a future fully bundled app: the app can later point the same config fields at bundled resources instead of `AGENT_VOICE_HOME/kokoro`.
