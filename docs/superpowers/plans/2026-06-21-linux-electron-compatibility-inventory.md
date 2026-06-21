# Linux Electron Compatibility Inventory

## Authoritative existing tests

- `tests/status-json.test.ts` — status JSON shape, install map, build id, attention.
- `tests/history-json.test.ts` — `history --json --limit N [--before CURSOR]`, cursor stability, invalid inputs.
- `tests/doctor.test.ts` — `doctor --json`, no unintended file creation.
- `tests/kokoro-setup-cli.test.ts` — `kokoro status --json`, `kokoro setup --jsonl` parseable stream and exit codes.
- `tests/daemon-cli.test.ts` and `tests/integration-daemon.test.ts` — start/stop/foreground/lock lifecycle.
- `tests/enqueue-cli.test.ts` and `tests/codex-hook-cli.test.ts` — stdin format validation, aliases, daemon wake side effects.
- `tests/config.test.ts` — `config get/set`, `enable`, `disable`, validation and daemon wake.
- `tests/bin-shim.test.ts` — `agent-voice`, `voice-codex`, `voice-opencode`, Bun lookup.
- `tests/install-*.test.ts` and `tests/install-detect.test.ts` — hook mutation safety and install map.
- `tests/pause-resume.test.ts` — pause/resume rejected until implemented.
- `tests/cli.test.ts` — queue clear/failed clear, models list, summarizer prompt, help command surfaces.
- `tests/summarizer-mode.test.ts` — summarizer mode behavior and invalid mode rejection.

## Compatibility rule

Every refactor task must run its focused tests plus any affected authoritative tests. Full `bun test` remains the final compatibility gate.

## Exit-code/stdout-stderr surfaces to preserve

Documented CLI compatibility surfaces from the approved spec before modifying CLI internals:

| Command | Stdout surface | Stderr surface | Exit-code style to preserve |
|---|---|---|---|
| `status --json` | Machine-readable JSON preserving daemon, queue, attention, install map, and build id semantics. | Diagnostics/errors only; no human diagnostics mixed into JSON stdout. | Success exits zero; tested failure behavior remains unchanged. |
| `history --json --limit N [--before CURSOR]` | Machine-readable JSON for read-only cursor-paginated history; public cursor flag remains `--before`. | Invalid input diagnostics/errors only. | Valid requests exit zero; invalid cursors/limits exit nonzero as existing tests expect. |
| `doctor --json` | JSON-only designed report output. | Diagnostics/errors only. | Success exits zero; failure behavior remains compatible and must not create config/queue files when checking missing home/config. |
| `kokoro status --json` | Machine-readable JSON status for managed resource availability. | Diagnostics/errors only. | Success exits zero; tested failure behavior remains unchanged. |
| `kokoro setup --jsonl` | Parseable JSON Lines setup event stream with preserved event ordering semantics. | Diagnostics/errors only; no non-JSON setup events on stdout. | Success exits zero; setup failure exits nonzero. |
| `test <text>` | Existing manual summarize/speak command output style; no JSON contract added by refactor. | Human diagnostics/playback/setup errors in current style. | Success exits zero; playback/TTS/setup failures preserve existing nonzero failure style. |
| `queue clear` | Existing human/report output including cleared active pending/processing count. | Diagnostics/errors only. | Success exits zero; failure behavior remains unchanged. |
| `queue clear --failed` | Existing human/report output including cleared failed-job count. | Diagnostics/errors only. | Success exits zero; failure behavior remains unchanged. |
| `summarizer mode heuristic/default` | Existing mode update/report output. | Validation diagnostics/errors only. | Valid modes exit zero; invalid modes/usage exit nonzero as tested. |
| `install --agents` / `uninstall --agents` | Existing per-agent mutation/status output. | Conflict, unsupported, unknown, permission, and validation diagnostics/errors only. | Preserve no-clobber, idempotency, unsupported/unknown, and failure exit behavior. |
| `pause` / `resume` | Existing rejection output, if any, stays compatible. | Unsupported-command diagnostics in current style. | Continue to reject with existing nonzero behavior until implemented. |
| `config get` | Parseable config output compatible with macOS config loading. | Diagnostics/errors only. | Success exits zero; failure behavior remains unchanged. |
| `config set <path> <value>` | Existing config update/report output. | Safe dotted-path validation and mutation diagnostics/errors only. | Valid updates exit zero; invalid paths/values exit nonzero as tested. |
| `models list` | Existing available summarizer model list shape consumed by macOS setup/model controls. | Diagnostics/errors only. | Success exits zero; failure behavior remains unchanged. |
| `summarizer prompt` | Existing assembled prompt rendering/preview output. | Validation diagnostics/errors only. | Success exits zero; invalid prompt options exit nonzero as tested. |
| daemon `start` / `stop` command paths | Existing start/stop report output used by macOS bridge behavior. | Start/stop failure diagnostics/errors only. | Preserve success/failure exit behavior for macOS bridge compatibility. |
| `daemon --foreground` and daemon foreground variants | Existing foreground lifecycle/status/processing output style. | Lock, lifecycle, and queue-processing diagnostics/errors only. | Preserve lock, status publishing, queue processing, foreground test-mode, and failure exit behavior. |
| `enable <agent>` / `disable <agent>` | Existing agent enable/disable report output. | Known-agent validation and config mutation diagnostics/errors only. | Valid known agents exit zero; invalid agents exit nonzero; daemon wake side effects preserved. |
| `enqueue --format ...` | Existing enqueue report output while preserving event/raw text data locally. | Stdin, format validation, deduplication, and local-store diagnostics/errors only. | Valid stdin/formats exit zero; invalid input exits nonzero; daemon wake side effects preserved. |
| `voice-codex` / `voice-opencode` bin aliases | Alias stdout behavior remains identical to shared CLI path. | Alias/Bun lookup diagnostics/errors only. | Preserve alias success/failure and shared Bun lookup helper semantics. |
| hook-generated enqueue command shapes | Generated hook commands keep their command/argument stdout/stderr behavior through the normal enqueue path. | Hook enqueue diagnostics/errors only. | Preserve installer-generated command/argument formats and enqueue exit behavior for Pi, Claude, Codex, and OpenCode hooks. |

JSON commands must write machine-readable JSON/JSONL to stdout and diagnostics/errors to stderr in the current style. UI-facing app-service calls should return typed errors instead of parsing human text when possible. Existing tested command success/failure behavior is preserved, and exact exit-code tests must be inventoried before changing CLI internals.
