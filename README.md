# agent-voice

> Local Bun/TypeScript CLI and daemon that queues completed coding-agent turns, summarizes each turn into one short sentence, and speaks it through a local Kokoro TTS script.

`agent-voice` is currently best used as a local, running daemon/server-style tool. It avoids global agent config mutation by default: you start the daemon, enqueue events from hooks or manual commands, and inspect the local SQLite queue when something goes wrong.

## What works today

- Queue a completed agent turn with `agent-voice enqueue`.
- Run a foreground or detached local daemon with `agent-voice daemon --foreground` or `agent-voice start`.
- Summarize with CLI fallbacks in this order: `codex`, `pi`, optional `opencode`, then heuristic text cleanup.
- Speak via a local Kokoro Python script, then play the generated WAV through macOS `afplay`.
- Inspect status and queue counts with `agent-voice status`.

The help text lists future `install` and `uninstall` entries, and the package includes placeholder `voice-codex` and `voice-opencode` shims. This repo does not yet implement installer or wrapper behavior, so prefer the manual daemon/server flow below for now.

## Requirements

- macOS, because playback uses `afplay`.
- [Bun](https://bun.sh/) available on your `PATH`.
- Python 3 and a local Kokoro TTS service script that:
  - prints JSON lines on stdout,
  - emits `{"status":"ready"}` when ready,
  - accepts one JSON line per request like `{"text":"...","voice":"af_heart"}` on stdin,
  - returns `{"audio":"<base64-wav>"}`.
- Optional summarizer CLIs: `codex`, `pi`, or `opencode`. If they are missing or time out, `agent-voice` falls back to a simple heuristic summary.

## Quick start: local daemon flow

From the repo root:

```bash
bun install
bun test
```

Point the config at your Kokoro script:

```bash
./bin/agent-voice config get
./bin/agent-voice config set tts.kokoroScript /absolute/path/to/kokoro_tts_service.py
./bin/agent-voice config set tts.python python3
./bin/agent-voice config set tts.voice af_heart
```

Start the daemon in one terminal:

```bash
./bin/agent-voice daemon --foreground
```

Enqueue a test turn from another terminal:

```bash
printf 'Claude finished editing the authentication module and updated the tests.' \
  | ./bin/agent-voice enqueue --format text --agent claude --cwd "$PWD"
```

You should hear one spoken sentence. Check queue state with:

```bash
./bin/agent-voice status
```

## Manual server-style operation

### Foreground daemon

Use this while developing because logs and failures stay visible in your terminal:

```bash
./bin/agent-voice daemon --foreground
```

For one-shot processing during debugging:

```bash
./bin/agent-voice daemon --foreground --once
```

### Detached daemon

Use this when you want the local daemon to keep running in the background:

```bash
./bin/agent-voice start
./bin/agent-voice status
./bin/agent-voice stop
```

`start` records the daemon PID under the runtime directory. If status shows a stale PID, `start` clears it before launching a new daemon.

### Direct TTS smoke test

This bypasses the queue and immediately summarizes and speaks one message:

```bash
./bin/agent-voice test 'Claude finished editing the auth module.'
```

## Enqueue formats

### Plain text

```bash
printf 'Pi updated the README.' \
  | ./bin/agent-voice enqueue --format text --agent pi --cwd "$PWD"
```

Valid agents are `claude`, `codex`, `pi`, and `opencode`.

### Canonical event JSON

```bash
cat fixtures/event.sample.json \
  | ./bin/agent-voice enqueue --format event-json
```

The event must use `version: 1`, `event: "turn_end"`, a valid `agent`, non-empty `text`, `id`, and `createdAt`.

### Claude Stop hook payload

```bash
cat fixtures/claude-stop-hook.sample.json \
  | ./bin/agent-voice enqueue --format claude-stop-hook --agent claude
```

The Claude adapter looks for response text in fields such as `assistant_response`, `final_response`, or `response_text`. If none is present, it queues the generic sentence `Claude finished responding.` and marks the event metadata as generic.

## Configuration

The default home is:

```text
~/.agent-voice
```

Override it for testing or separate profiles:

```bash
AGENT_VOICE_HOME=/tmp/agent-voice-dev ./bin/agent-voice status
```

Important files under `AGENT_VOICE_HOME`:

```text
config.json             # user-editable settings
queue.db                # SQLite queue (jobs table: pending/processing/done/failed/skipped)
run/daemon.pid          # daemon lock
run/intentional-stop    # stop marker
run/audio/              # temporary WAV files during playback
```

Useful config commands:

```bash
./bin/agent-voice config get
./bin/agent-voice config set summarizer.timeoutSeconds 8
./bin/agent-voice config set summarizer.maxInputChars 12000
./bin/agent-voice config set tts.timeoutSeconds 30
./bin/agent-voice enable claude
./bin/agent-voice disable opencode
```

## Privacy and data flow

`agent-voice` is designed to keep the queue, config, generated audio files, and Kokoro TTS local to your machine. Completed agent text is stored as rows in the SQLite queue at `AGENT_VOICE_HOME/queue.db`, summarized, spoken, and then marked `done`, `failed`, or `skipped`.

Be aware of the summarizer step: by default, `agent-voice` tries `codex exec`, then `pi --fast`, then optional `opencode run` before falling back to heuristic local cleanup. Those CLI tools may contact their configured model providers. If you want strictly local/no-network summarization, set the priority in `config.json` to only `heuristic`.

The daemon sets `AGENT_VOICE_DISABLE=1` for summarizer subprocesses to reduce recursive voice events. Temporary WAV files are written under `run/audio/`, played with `afplay`, and removed best-effort after playback.

## Troubleshooting

- **No sound:** run `./bin/agent-voice test 'hello'`; verify macOS audio output, `afplay`, and `tts.kokoroScript`.
- **Kokoro times out:** increase `tts.timeoutSeconds`, confirm the script prints `{"status":"ready"}`, and run it manually with Python.
- **Queue is not moving:** run `./bin/agent-voice status`; if `pending` grows, start `./bin/agent-voice daemon --foreground` and watch errors.
- **Jobs go to `failed`:** inspect the failed rows in `~/.agent-voice/queue.db` (e.g. `SELECT id, last_error FROM jobs WHERE status='failed'`); `last_error` usually contains the failing summarizer, TTS, or playback message.
- **Daemon already running:** run `./bin/agent-voice status`; stop it with `./bin/agent-voice stop` or remove a truly stale `run/daemon.pid` after confirming the PID is dead.
- **Summarizer CLI missing:** this is non-fatal. The daemon falls back through the priority list and eventually uses the heuristic summarizer.
- **Privacy-sensitive project:** use a separate `AGENT_VOICE_HOME`, lower `summarizer.maxInputChars`, add `ignoreCwdPatterns` in `config.json`, or switch summarization to `heuristic` only.

## Development

```bash
bun test
bun run typecheck
```

Repo layout:

```text
bin/agent-voice          # cwd-independent Bun shim
src/cli.ts               # command parser and command handlers
src/daemon.ts            # foreground/detached daemon lifecycle
src/db.ts                # SQLite connection, PRAGMAs, and schema
src/store.ts             # SQLite queue API (enqueue, claim, recover, retention, history)
src/queue.ts             # skip, retry, and due/backoff logic
src/processor.ts         # summarize + speak job processor
src/summarizers.ts       # Codex/Pi/OpenCode/heuristic summarizers
src/tts.ts               # Kokoro JSONL client and afplay playback
src/adapters/claude.ts   # Claude Stop hook text extraction
fixtures/                # sample event and hook payloads
tests/                   # Bun unit and integration tests
```
