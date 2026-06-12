# Agent Voice: Global One-Line TTS Summaries for Coding Agents

Date: 2026-06-12
Status: Design approved by user; awaiting spec review

## Goal

Build a global local system that listens for completed turns from Claude Code, Codex CLI, Pi, and OpenCode, summarizes each completed assistant response into one short TTS-friendly sentence, and speaks it through local Kokoro TTS.

The system must not disrupt agent workflows. Agent integrations must enqueue events asynchronously and fail open.

## Scope

### In scope for v1

- Global installation, not project-local only.
- Support for these agents:
  - Claude Code
  - Codex CLI
  - Pi
  - OpenCode
- Default policy: speak every completed agent turn.
- Configurable policy to disable agents or later reduce noise.
- Background daemon that keeps Kokoro warm.
- Async spool-based event queue so agent hooks/adapters never wait on the daemon, summarizer, TTS, or audio playback.
- One-line summarization fallback order:
  1. Codex fast mode using `gpt-5.3-codex`
  2. Pi fast mode using a Codex/OpenAI model
  3. OpenCode
  4. Local heuristic fallback
- TTS via the existing Kokoro Python service under `../kokoro-tts/Python/kokoro_tts_service.py` plus `afplay` for playback.

### Out of scope for v1

- Live streaming narration while an agent is still responding.
- Extending the existing Kokoro macOS app UI.
- Cloud-hosted storage or telemetry.
- Perfect native integration for every agent if the agent does not expose final response text; wrapper fallback is acceptable.
- Complex summarization policies such as semantic importance scoring.

## Recommended architecture

Use native post-turn integrations where possible, backed by a single warm local daemon.

```text
Claude / Codex / Pi / OpenCode turn ends
        ↓
small native adapter / hook / plugin
        ↓
atomic local spool file write
        ↓
agent-voice daemon
        ↓
one-line summarizer
codex fast → pi fast → opencode → heuristic
        ↓
warm Kokoro Python subprocess
        ↓
temporary WAV → afplay
```

## Components

### `agent-voice` CLI

The CLI is the user-facing control surface and adapter entrypoint.

Commands:

```bash
agent-voice install
agent-voice uninstall
agent-voice start
agent-voice stop
agent-voice status
agent-voice enqueue --agent claude
agent-voice test "Claude finished editing the auth module."
agent-voice enable claude
agent-voice disable codex
agent-voice config
```

Responsibilities:

- Create config, spool, and log directories.
- Start/stop/status the daemon.
- Install/uninstall global adapters.
- Provide a stable `enqueue` command for hooks and wrappers.
- Provide manual test/speak flows for validation.

### Daemon

The daemon owns all slow or failure-prone work.

Responsibilities:

- Keep the Kokoro Python subprocess warm.
- Watch or poll `~/.agent-voice/spool/incoming`.
- Move events through `incoming → processing → done` or `failed`.
- Deduplicate events by ID.
- Summarize final assistant output to one short sentence.
- Generate audio with Kokoro.
- Play audio with `afplay`.
- Serialize playback so summaries do not overlap.
- Log failures without affecting agents.

### Async spool queue

Adapters must not talk to the daemon over a blocking path. They enqueue by writing a local file only.

Directory layout:

```text
~/.agent-voice/
  config.json
  logs/
    agent-voice.log
  spool/
    incoming/
    processing/
    done/
    failed/
```

Enqueue algorithm:

1. Build an event JSON object.
2. Write it to a unique temp file in the same filesystem.
3. `fsync` best-effort where practical.
4. Atomic rename into `spool/incoming/*.json`.
5. Exit `0` even if enqueue fails after best-effort logging.

This guarantees agents wait only for a local file write and atomic rename, never for LLM or TTS work.

### Summarizer

Input: final assistant text plus metadata.

Output: one short sentence suitable for speech.

Default priority:

1. Codex direct:
   ```bash
   codex exec -m gpt-5.3-codex -c service_tier='"fast"' --skip-git-repo-check --ephemeral -
   ```
2. Pi fast mode:
   ```bash
   pi --fast -p --model openai/gpt-5.3-codex --no-tools --no-session -
   ```
3. OpenCode:
   ```bash
   opencode run --model <configured-model> --prompt <prompt>
   ```
4. Local heuristic fallback:
   - Strip markdown/control noise.
   - Prefer first concise sentence that names the result.
   - Truncate to configured max spoken length.

Summarizer prompt shape:

```text
Summarize this coding-agent response as exactly one short, natural, TTS-friendly sentence.
Do not include markdown, bullets, quotes, emojis, file paths unless essential, or more than one sentence.

Agent: <agent>
Response:
<text>
```

Timeouts:

- Each external summarizer gets a short configurable timeout.
- On timeout or non-zero exit, try the next summarizer.
- If all summarizers fail, use the heuristic fallback.

### TTS player

Use the existing Kokoro Python service directly:

```text
../kokoro-tts/Python/kokoro_tts_service.py
```

Protocol:

```json
{"text":"Hello world","voice":"af_heart"}
```

Expected response:

```json
{"audio":"<base64 wav>","duration":1.5}
```

Playback flow:

1. Send summary text to warm Kokoro subprocess.
2. Decode returned base64 WAV.
3. Write a temporary `.wav` file.
4. Play with `afplay`.
5. Delete the temp file.

## Event format

Adapters enqueue a JSON object like:

```json
{
  "id": "uuid-or-stable-hash",
  "version": 1,
  "agent": "claude",
  "event": "turn_end",
  "text": "Final assistant response text...",
  "cwd": "/path/to/project",
  "sessionId": "optional-session-id",
  "createdAt": "2026-06-12T00:00:00Z",
  "metadata": {
    "source": "claude-stop-hook"
  }
}
```

Required fields:

- `id`
- `version`
- `agent`
- `event`
- `text`
- `createdAt`

Optional fields:

- `cwd`
- `sessionId`
- `metadata`

## Agent adapters

### Claude Code

Install a global `Stop` hook.

Responsibilities:

- Read Claude hook JSON from stdin.
- Extract final assistant text if present, or locate it from known transcript/session fields if needed.
- Write an event to the spool using `agent-voice enqueue --agent claude` or a tiny direct spool writer.
- Exit `0` always.

Risk:

- Hook payload details may vary by Claude Code version. The adapter should preserve unknown payloads in debug logs only when configured and should tolerate missing text.

### Pi

Install a global Pi extension at:

```text
~/.pi/agent/extensions/agent-voice.ts
```

Responsibilities:

- Subscribe to a final-message event such as `message_end` and/or `agent_end`.
- Capture the last assistant text for the completed turn.
- Write a spool event without awaiting summarization or speech.
- Expose a lightweight status/enable command if useful.

Risk:

- Need to validate exact event payload shape against installed Pi types/examples during implementation.

### Codex CLI

Preferred native integration:

- Use Codex global `notify` / turn-ended command if it can expose sufficient final output or session metadata.

Fallback:

- Provide a wrapper command such as `voice-codex` that runs Codex and captures final output where practical.

Risk:

- Codex notification may provide metadata rather than final response text. If so, native integration may only support a generic completion message until a session-output lookup or wrapper path is implemented.

### OpenCode

Preferred native integration:

- Use an OpenCode plugin/hook if it exposes completed assistant messages.

Fallback:

- Provide a wrapper command such as `voice-opencode`.

Risk:

- OpenCode plugin/hook API needs verification during implementation. Wrapper fallback may be the reliable v1 path if native final-text access is not available.

## Configuration

Default config path:

```text
~/.agent-voice/config.json
```

Initial config shape:

```json
{
  "enabled": true,
  "agents": {
    "claude": { "enabled": true },
    "codex": { "enabled": true },
    "pi": { "enabled": true },
    "opencode": { "enabled": true }
  },
  "speakPolicy": "every_turn",
  "summarizer": {
    "priority": ["codex-fast", "pi-fast", "opencode", "heuristic"],
    "codexModel": "gpt-5.3-codex",
    "timeoutSeconds": 12,
    "maxInputChars": 12000,
    "maxSummaryChars": 180
  },
  "tts": {
    "kokoroScript": "../kokoro-tts/Python/kokoro_tts_service.py",
    "python": "python3",
    "voice": "af_heart",
    "timeoutSeconds": 30
  },
  "spool": {
    "retentionDays": 7
  },
  "privacy": {
    "storeRawText": true,
    "logRawText": false
  }
}
```

## Installation

`agent-voice install` should:

1. Create `~/.agent-voice` directories and default config.
2. Install a macOS LaunchAgent to keep the daemon running.
3. Install global adapters for enabled agents:
   - Claude Code global hook.
   - Pi global extension.
   - Codex notification hook if viable; wrapper fallback otherwise.
   - OpenCode plugin/hook if viable; wrapper fallback otherwise.
4. Run a basic `agent-voice status` health check.
5. Print exactly what was installed and how to uninstall.

## Failure handling

Adapters:

- Do only local enqueue work.
- Never wait for daemon, LLM, Kokoro, or audio.
- Always exit `0`.
- Best-effort logging only.

Daemon:

- Process events serially for v1.
- Deduplicate by event `id`.
- Timeout slow summarizers and TTS calls.
- Fall back to heuristic summary.
- Move failed jobs to `spool/failed` with error metadata.
- Continue processing later jobs after failure.

## Privacy and safety

- Everything is local except the selected summarizer CLI, which may send text to its configured model provider.
- Raw captured text is stored in the local spool by default for reliability and debugging.
- Provide `storeRawText: false` as a later hardening mode or v1 stretch goal if simple.
- Logs must not include raw agent output unless `logRawText` is explicitly enabled.
- Truncate captured text to `maxInputChars` before summarization.

## Testing strategy

Unit tests:

- Config loading and defaults.
- Atomic spool writes.
- Event validation.
- Summarizer fallback order.
- TTS text cleanup.
- Deduplication by event ID.

Integration tests:

- Enqueue sample events for each agent.
- Run daemon against a mock Kokoro process.
- Run summarizer with mocked command failures to verify fallback.
- Optional local real Kokoro smoke test using `../kokoro-tts/Python/kokoro_tts_service.py`.

Manual tests:

```bash
agent-voice test "Claude finished editing the auth module."
agent-voice enqueue --agent claude < sample-claude-stop-payload.json
agent-voice status
```

## Open implementation questions

These should be resolved during implementation discovery, not by changing the core architecture:

1. Exact Claude Code `Stop` hook payload shape for final assistant text.
2. Exact Pi extension event payload to use for final assistant text.
3. Whether Codex global notification exposes final response text or only event metadata.
4. Whether OpenCode exposes a stable plugin/hook event for completed assistant messages.
5. Best absolute default path for the Kokoro service, since `../kokoro-tts` is relative to this repo but global install should store an absolute path.

## Acceptance criteria

- A global install can be configured for Claude Code, Codex, Pi, and OpenCode.
- Agent adapters enqueue asynchronously through local spool files and exit quickly.
- If the daemon is stopped, events remain queued and are spoken after restart.
- The daemon summarizes with Codex fast mode first, then Pi fast mode, then OpenCode, then heuristic fallback.
- Kokoro stays warm in the daemon and speech does not require the Kokoro macOS app to be open.
- Failures in summarization, TTS, or playback never disrupt the source agent.
