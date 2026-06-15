# Agent Voice: Global One-Line TTS Summaries for Coding Agents

Date: 2026-06-12
Status: Ready for user review after 3 spec review iterations and final blocker patch

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
- TTS via the existing Kokoro Python service. The global config stores an absolute script path, autodetected from `/Users/meidhy/junk/repo/kokoro-tts/Python/kokoro_tts_service.py` on this machine when present, plus `afplay` for playback.

### Out of scope for v1

- Live streaming narration while an agent is still responding.
- Extending the existing Kokoro macOS app UI.
- Cloud-hosted storage or telemetry.
- Perfect native integration for every agent if the agent does not expose final response text; wrapper fallback is acceptable.
- Complex summarization policies such as semantic importance scoring.

## Product and safety decisions

These decisions are fixed for v1 so implementation does not need to guess.

- Global install must be **idempotent, reversible, and fail-safe**.
- `agent-voice install` must not silently overwrite existing agent configuration. It must create timestamped backups before editing any global config file.
- If an agent's native hook/plugin schema cannot be verified, install must not force a fragile native integration. It should install the reliable wrapper fallback and print the native integration as disabled/experimental.
- The default speech policy is `every_turn`, but users can disable the entire system, individual agents, or path patterns from config.
- Captured text is local raw agent output by design and may be stored in spool files, job records, and logs.
- Captured text may be sent to the configured external summarizer CLI. This is intentional for this personal local tool and must be explicit in config/docs.
- A fully local mode is supported by setting summarizer priority to `["heuristic"]`; in that mode no captured text is sent to an external model provider.
- No data-sanitization or retention-pruning layer is included in v1. The system preserves raw local text except for configured size truncation.
- Adapters always fail open. If any adapter cannot enqueue within its small local budget, it drops the voice event and exits successfully.
- Internal summarizer subprocesses must not recursively trigger voice events. The daemon sets `AGENT_VOICE_DISABLE=1`, and every adapter/wrapper must skip enqueue when that environment variable is present.

## Native-support tiers

Each agent has an explicit v1 support tier.

| Agent | v1 support decision |
| --- | --- |
| Claude Code | Native global Stop hook is primary. If final text is missing from the hook payload, enqueue a generic completion sentence and log metadata only. |
| Pi | Native global extension is primary. Use the final message event if available; otherwise keep the last assistant text seen during the turn and enqueue it on `agent_end`. |
| Codex CLI | Reliable wrapper support is required for v1. Native `notify`/turn-ended integration is optional and only enabled if final text or a reliable session lookup is verified. |
| OpenCode | Reliable wrapper support is required for v1. Native plugin/hook integration is optional and only enabled if completed assistant text is verified. |

Wrappers are not a separate product direction; they are the supported fallback for agents whose native global notification cannot provide final response text.

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
agent-voice install [--agents claude,pi,codex,opencode] [--kokoro-script /abs/path]
agent-voice uninstall [--restore-backups]
agent-voice start
agent-voice stop
agent-voice status
agent-voice enqueue --format text --agent claude --cwd "$PWD" < final-response.txt
agent-voice enqueue --format event-json < canonical-event.json
agent-voice enqueue --format claude-stop-hook --agent claude < claude-hook-payload.json
agent-voice test "Claude finished editing the auth module."
agent-voice enable claude
agent-voice disable codex
agent-voice config get
agent-voice config set summarizer.timeoutSeconds 8
```

Responsibilities:

- Create config, spool, and log directories.
- Start/stop/status the daemon.
- Install/uninstall global adapters.
- Provide a stable `enqueue` command for hooks and wrappers.
- Provide manual test/speak flows for validation.

`enqueue` is the stable adapter protocol:

- `--format` is required; there is no implicit default.
- `--format text`: stdin is raw final assistant text; `--agent` is required.
- `--format event-json`: stdin is already the canonical event format; `--agent` is ignored unless it matches the event JSON agent.
- `--format claude-stop-hook`: stdin is a Claude Stop hook payload and the CLI extracts final text when available; `--agent claude` is required.
- Future agent-specific formats may be added only if they can be tested with sample payload fixtures.
- If format-specific extraction cannot find final text, `enqueue` creates a generic completion sentence only when that adapter's support tier explicitly allows it; otherwise it writes no event and exits `0`.
- `enqueue` performs only validation, size truncation, and the atomic spool write. It must not start the daemon, call a summarizer, call Kokoro, or play audio.

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

Daemon lifecycle and protocol:

- The daemon is started as `agent-voice daemon --foreground` by the LaunchAgent.
- v1 does **not** expose an HTTP server or Unix socket. The spool directory is the only adapter-to-daemon protocol.
- `agent-voice start` loads the LaunchAgent or starts the foreground daemon only when no healthy daemon lock exists.
- `agent-voice stop` asks launchd to unload/stop the daemon, then sends a graceful signal if needed.
- On `SIGTERM`/`SIGINT`, the daemon finishes or safely requeues the current job, terminates Kokoro if owned by this daemon, removes its PID/lock file, and exits.
- `agent-voice status` reports daemon PID, LaunchAgent status, queue counts by state, Kokoro readiness, last processed event, and last error.

Recovery behavior:

- On startup, move stale files from `processing` back to `incoming` if their lock metadata is older than the configured processing timeout.
- Treat malformed event files as failed jobs and move them to `failed` with a sidecar error file that does not include raw text.
- Use a daemon PID/lock file so `start` is idempotent and does not create multiple active speakers.
- If Kokoro exits or emits invalid JSON, restart the Kokoro subprocess once for the current job, then fail the job if it still fails.
- If `afplay` fails, mark only that job failed and continue.
- Apply retention cleanup to `done`, `failed`, and `skipped` during daemon startup and periodically while running.

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
    skipped/
  backups/
  run/
    agent-voice.pid
```

Spool filenames use sortable timestamps plus event IDs, for example:

```text
2026-06-12T00-00-00.000Z_claude_550e8400-e29b-41d4-a716-446655440000.json
```

Enqueue algorithm:

1. Build an event JSON object.
2. Apply configured max-size limits.
3. Write it to a unique temp file in the same filesystem.
4. `fsync` best-effort where practical.
5. Atomic rename into `spool/incoming/*.json`.
6. Exit `0` even if enqueue fails after best-effort logging.

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

Safe execution requirements:

- Invoke summarizers with argument arrays, not shell-interpolated command strings.
- Pass the summarization prompt through stdin or an equivalent safe API; never interpolate agent text into a shell command.
- Set `AGENT_VOICE_DISABLE=1` for all summarizer subprocesses so wrappers/adapters do not enqueue recursive voice events.
- Use an isolated non-project working directory such as `~/.agent-voice/run/summarizer` unless a summarizer requires otherwise.
- Disable tools/session persistence where supported: Codex uses `--ephemeral`; Pi uses `--no-tools --no-session`.
- Enforce timeout by killing the whole subprocess group.
- Limit subprocess stdout/stderr capture to configured byte caps before logging.
- If a configured summarizer executable is missing, skip it and try the next priority entry.

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

Use the existing Kokoro Python service directly through the absolute path stored in config.

Protocol:

```json
{"text":"Hello world","voice":"af_heart"}
```

Expected response:

```json
{"audio":"<base64 wav>","duration":1.5}
```

Playback flow:

1. Send summary text to warm Kokoro subprocess as one JSON line.
2. Read JSON lines until an `audio` response or `error` response is received; tolerate non-audio status/progress lines.
3. Decode returned base64 WAV.
4. Write a temporary `.wav` file under `~/.agent-voice/run/audio`.
5. Play with `afplay` using argument arrays.
6. Delete the temp file best-effort.

TTS failure handling:

- If Kokoro is not ready, wait up to `tts.timeoutSeconds` for readiness.
- If Kokoro fails a job, restart once and retry that job once.
- If audio playback fails after a valid WAV is produced, do not retry summarization; mark playback failed for that job.

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

Required v1 support:

- Provide `voice-codex`, a wrapper for non-interactive Codex runs where final stdout can be captured reliably.
- Install a Codex native notification only if implementation discovery verifies a stable way to obtain either final response text or a session ID that can be mapped to final response text.

Wrapper behavior:

```bash
voice-codex [codex args...]
voice-codex exec [codex exec args...]
```

- Pass all arguments through to `codex`.
- Preserve the wrapped command's stdout, stderr, stdin, TTY behavior, and exit code as much as practical.
- For `codex exec` and other non-interactive output modes, capture the final output and enqueue it after process exit.
- For fully interactive TUI sessions where final output cannot be captured reliably, enqueue a generic completion event unless native session lookup is verified.

Risk accepted for v1:

- Codex may not expose final assistant text through global notification. The v1 acceptance bar is therefore reliable wrapper capture for non-interactive runs plus non-disruptive generic completion for unsupported native interactive cases.

### OpenCode

Required v1 support:

- Provide `voice-opencode`, a wrapper for non-interactive OpenCode runs where final stdout can be captured reliably.
- Install an OpenCode native plugin/hook only if implementation discovery verifies a stable completed-assistant-message event.

Wrapper behavior:

```bash
voice-opencode [opencode args...]
voice-opencode run [opencode run args...]
```

- Pass all arguments through to `opencode`.
- Preserve stdout, stderr, stdin, TTY behavior, and exit code as much as practical.
- For `opencode run`, capture final output and enqueue it after process exit.
- For fully interactive TUI sessions where final output cannot be captured reliably, enqueue a generic completion event unless native plugin support is verified.

Risk accepted for v1:

- OpenCode plugin/hook API may not expose final assistant text. The v1 acceptance bar is reliable wrapper capture for non-interactive runs plus non-disruptive generic completion for unsupported native interactive cases.

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
    "claude": { "enabled": true, "mode": "native" },
    "codex": { "enabled": true, "mode": "wrapper-required-native-optional" },
    "pi": { "enabled": true, "mode": "native" },
    "opencode": { "enabled": true, "mode": "wrapper-required-native-optional" }
  },
  "speakPolicy": "every_turn",
  "ignoreCwdPatterns": [],
  "summarizer": {
    "priority": ["codex-fast", "pi-fast", "opencode", "heuristic"],
    "codexModel": "gpt-5.3-codex",
    "piModel": "openai/gpt-5.3-codex",
    "opencodeModel": null,
    "timeoutSeconds": 12,
    "maxInputChars": 12000,
    "maxSummaryChars": 180
  },
  "tts": {
    "kokoroScript": "/Users/meidhy/junk/repo/kokoro-tts/Python/kokoro_tts_service.py",
    "python": "python3",
    "voice": "af_heart",
    "timeoutSeconds": 30
  },
  "spool": {
    "processingTimeoutSeconds": 120,
    "retentionDays": 7,
    "maxEventBytes": 262144,
    "maxAttempts": 3,
    "retryBackoffSeconds": 30
  }
}
```

The Kokoro script path must be stored as an absolute path. `agent-voice install` may autodetect `/Users/meidhy/junk/repo/kokoro-tts/Python/kokoro_tts_service.py` on this machine, but it must prompt or fail with a clear message if the path does not exist and `--kokoro-script` was not provided.

## Installation

`agent-voice install` should:

1. Create `~/.agent-voice` directories and default config.
2. Resolve and validate the absolute Kokoro script path.
3. Install a macOS LaunchAgent at `~/Library/LaunchAgents/com.agent-voice.daemon.plist` to keep the daemon running.
4. Install global adapters for enabled agents:
   - Claude Code global Stop hook.
   - Pi global extension.
   - Codex wrapper commands, plus native notification only if verified.
   - OpenCode wrapper commands, plus native plugin/hook only if verified.
5. Create timestamped backups under `~/.agent-voice/backups/` before modifying any existing global config file.
6. Run a basic `agent-voice status` health check.
7. Print exactly what was installed, skipped, backed up, and how to uninstall.

LaunchAgent requirements:

- Label: `com.agent-voice.daemon`.
- Path: `~/Library/LaunchAgents/com.agent-voice.daemon.plist`.
- `ProgramArguments`: absolute path to the installed `agent-voice` executable plus `daemon --foreground`.
- `RunAtLoad`: `true`.
- `KeepAlive`: crash-only restart behavior; do not respawn rapidly on clean user stop.
- `WorkingDirectory`: `~/.agent-voice`.
- `StandardOutPath`: `~/.agent-voice/logs/launchd.out.log`.
- `StandardErrorPath`: `~/.agent-voice/logs/launchd.err.log`.
- Environment includes `AGENT_VOICE_HOME=~/.agent-voice`; it must not set `AGENT_VOICE_DISABLE` because that variable is only for child summarizer/wrapper recursion prevention.
- Install loads the LaunchAgent with `launchctl bootstrap gui/$UID <plist>` when available; uninstall unloads it with `launchctl bootout gui/$UID <plist>` and falls back to older `launchctl load/unload` only if needed.
- `agent-voice stop` records an intentional-stop marker before unloading/stopping so KeepAlive does not immediately restart it.
- `agent-voice start` removes the intentional-stop marker before loading/starting.

Uninstall requirements:

- `agent-voice uninstall` removes the LaunchAgent, daemon process, installed adapter files, and wrapper symlinks/scripts created by this tool.
- It must not delete `~/.agent-voice/spool`, logs, or backups unless an explicit cleanup flag is provided.
- With `--restore-backups`, it restores config files from the latest matching backup where safe.
- It must print anything it could not remove automatically.

Installation must be idempotent: rerunning `install` updates files owned by this tool, keeps backups, and does not duplicate hooks or LaunchAgents.

Ownership and backup rules:

- Files created by this tool must include a clear `agent-voice` marker comment/header where the target format allows it.
- For JSON/TOML config edits, installer backups must include the original file path, timestamp, and sha256 hash in a backup manifest.
- Installer must not remove or rewrite unrelated existing hooks/plugins/extensions.
- When adding to an existing hook list, append a clearly marked command rather than replacing the list.
- If a config merge is ambiguous, skip that native adapter and report the wrapper/manual install path instead of guessing.
- Uninstall removes only files or config entries with matching ownership markers/manifests.

## Queue and retry behavior

The daemon treats each spool file as a durable job.

Job states:

```text
incoming → processing → done
                 ├──→ failed
                 ├──→ skipped
                 └──→ incoming (retryable failure while attempts remain and nextAttemptAt has arrived)
```

Rules:

- Each job records `attempts`, `lastAttemptAt`, `nextAttemptAt`, and the last error summary in metadata.
- `attempts` increments when a job moves from `incoming` to `processing`, not when the file is initially enqueued.
- Retryable failures: total TTS/playback failure after the per-job Kokoro restart attempt, temporary `afplay` failure, and unexpected daemon-owned subprocess failures after heuristic fallback cannot complete the job.
- External summarizer failures are not independently retried as jobs if the heuristic fallback succeeds; the job is successful and must move to `done`.
- Retry timing is deterministic for v1: `nextAttemptAt = now + retryBackoffSeconds * attempts`, capped by `processingTimeoutSeconds`.
- A job with future `nextAttemptAt` remains in `incoming` but is skipped by the daemon until the timestamp arrives.
- If `attempts >= maxAttempts`, retryable failure becomes terminal and the job moves to `failed` with error metadata.
- Non-retryable failures: malformed event JSON, text missing after adapter extraction when generic completion is not allowed, event exceeding `maxEventBytes`, and unsupported event version.
- Disabled or ignored jobs are not failures. If the global system is disabled, the agent is disabled, or `cwd` matches `ignoreCwdPatterns`, the daemon moves the job to `skipped` with reason `disabled_system`, `disabled_agent`, or `ignored_cwd`.
- Re-enabling an agent affects future jobs only. Skipped jobs are not automatically replayed; a later explicit `agent-voice requeue --from skipped --reason disabled_agent` may be added outside v1.
- Queued jobs remain durable across daemon restarts.
- Processing order is oldest-first by spool filename among jobs whose `nextAttemptAt` is absent or due.

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
- Recover stale `processing` jobs on restart.
- Avoid duplicate daemon instances with a lock/PID file.
- If the user disables the system or a specific agent while jobs are queued, move matching due jobs to `skipped` with a reason instead of retrying or failing them.

## Data and safety

- This is a personal local tool; no data-sanitization or retention-pruning layer is included in v1.
- Everything is local except the selected summarizer CLI, which may send captured text to its configured model provider.
- Incoming, processing, done, and failed spool files may store raw captured text because the daemon needs that text to summarize and speak.
- Logs and error metadata may contain raw local text; keep log and subprocess capture sizes bounded.
- Truncate captured text to `maxInputChars` before summarization.

## Testing strategy

Unit tests:

- Config loading and defaults.
- Atomic spool writes.
- Event validation and unsupported-version rejection.
- Summarizer fallback order.
- Safe subprocess invocation without shell interpolation.
- `AGENT_VOICE_DISABLE=1` recursion guard in wrappers/adapters.
- TTS text cleanup.
- Deduplication by event ID.
- Retry classification, `nextAttemptAt` backoff timing, and max-attempt behavior.
- Disabled-system, disabled-agent, and ignored-cwd jobs moving to `skipped`.
- LaunchAgent plist content, bootstrap/bootout command selection, and intentional-stop marker behavior.
- Enqueue CLI required-format validation and format-specific `--agent` rules.
- Retention cleanup.

Integration tests:

- Enqueue sample events for each agent.
- Run daemon against a mock Kokoro process.
- Run summarizer with mocked command failures to verify fallback.
- Verify daemon restart requeues stale `processing` jobs.
- Verify install is idempotent and uninstall removes only owned files/entries.
- Verify LaunchAgent plist generation without loading it in tests.
- Verify wrappers preserve exit code and enqueue only when `AGENT_VOICE_DISABLE` is absent.
- Optional local real Kokoro smoke test using the configured absolute Kokoro script path.

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
5. Whether install should autodetect only `/Users/meidhy/junk/repo/kokoro-tts/Python/kokoro_tts_service.py` or also search sibling directories before requiring `--kokoro-script`.

## Acceptance criteria

- A global install can be configured for Claude Code, Codex, Pi, and OpenCode.
- Agent adapters enqueue asynchronously through local spool files and exit quickly.
- If the daemon is stopped, events remain queued and are spoken after restart.
- The daemon summarizes with Codex fast mode first, then Pi fast mode, then OpenCode, then heuristic fallback.
- Kokoro stays warm in the daemon and speech does not require the Kokoro macOS app to be open.
- Failures in summarization, TTS, or playback never disrupt the source agent.
- Install/uninstall are idempotent and reversible for files/config entries owned by this tool.
- Data handling is internally consistent: raw captured text is preserved locally except for configured size truncation.
- Queue retry and daemon restart behavior are covered by tests.
