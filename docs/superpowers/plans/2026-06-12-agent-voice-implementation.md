# Agent Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a global `agent-voice` CLI/daemon that asynchronously captures completed coding-agent turns, summarizes them into one sentence, and speaks them through local Kokoro TTS without disrupting Claude Code, Codex, Pi, or OpenCode.

**Architecture:** Greenfield Bun/TypeScript CLI with focused modules: config/path handling, canonical event validation, atomic spool queue, daemon/job processing, summarizer fallback, Kokoro/afplay playback, installer/adapters, and wrappers. Adapters only enqueue raw local event text to spool files; the daemon owns all slow LLM/TTS/audio work.

**Tech Stack:** Bun test runner, TypeScript, Node built-ins (`fs`, `path`, `os`, `child_process`), macOS `launchctl`/LaunchAgent, local Kokoro JSON-lines Python service, `afplay`.

**Approved Spec:** `docs/superpowers/specs/2026-06-12-agent-voice-design.md`

**Workspace note:** User explicitly requested working on `master` in this repo rather than a worktree. Do not modify or commit unrelated existing untracked files: `docs/superpowers/plans/2026-06-11-fast-mode-extension.md`, `docs/superpowers/plans/2026-06-11-sticky-fast-mode.md`, or `tests/fast-mode-extension.test.mjs`.

---

## File structure

Create these files unless a later task discovers a stronger reason to split further:

```text
package.json                         # Bun scripts, bin entries, dev deps
README.md                            # Usage, install, and data-flow notes
src/index.ts                         # CLI executable entrypoint
src/cli.ts                           # Argument parsing and command dispatch
src/executable.ts                    # Cwd-independent executable path resolution for shims/install
src/config.ts                        # Defaults, load/save, dot-path config set/get
src/paths.ts                         # AGENT_VOICE_HOME resolution and directory paths
src/events.ts                        # Canonical event types, validation, ID generation
src/spool.ts                         # Atomic enqueue, job moves, stale recovery, retention
src/queue.ts                         # Job state/retry/skipped semantics
src/daemon.ts                        # Daemon lifecycle, loop, status, signals
src/processor.ts                     # Per-job orchestration: policy → summarize → TTS → state
src/summarizers.ts                   # Codex/Pi/OpenCode/heuristic fallback, safe subprocesses
src/tts.ts                           # Kokoro JSON-lines subprocess and afplay playback
src/install.ts                       # Global install/uninstall, backups, LaunchAgent
src/adapters/claude.ts               # Claude Stop hook extraction
src/adapters/pi-extension.ts         # Generated Pi extension source
src/wrappers.ts                      # Codex/OpenCode wrapper behavior shared helpers
src/testing/fakes.ts                 # Test helpers for fake subprocess/fs cases if useful
bin/agent-voice                      # Cwd-independent executable shim
bin/voice-codex                      # Wrapper shim
bin/voice-opencode                   # Wrapper shim
tests/config.test.ts
tests/events.test.ts
tests/spool.test.ts
tests/enqueue-cli.test.ts
tests/queue.test.ts
tests/summarizers.test.ts
tests/tts.test.ts
tests/daemon.test.ts
tests/daemon-cli.test.ts
tests/install.test.ts
tests/adapters.test.ts
tests/wrappers.test.ts
tests/integration-daemon.test.ts
fixtures/claude-stop-hook.sample.json
fixtures/event.sample.json
fixtures/kokoro-ready-audio.jsonl
```

Design boundaries:

- `cli.ts` must remain orchestration-only; business logic belongs in modules.
- `spool.ts` owns durable file operations only; retry policy belongs in `queue.ts`.
- `processor.ts` is the only module that combines config, queue, summarizers, and TTS.
- `summarizers.ts`, `tts.ts`, and `install.ts` must accept injectable subprocess runners for tests.
- Tests must use temporary `AGENT_VOICE_HOME` directories and must not write to real `~/.agent-voice`, `~/.claude`, `~/.pi`, or LaunchAgents.
- Executable shims and LaunchAgent `ProgramArguments` must be cwd-independent. They must resolve the repository/install root from the shim file location or an injected install path, never from `$PWD`.
- All `git add` commands in this plan must use `git add -- <exact files>` and must not stage broad directories such as `src`, `tests`, `fixtures`, or `bin` because this repo already contains unrelated untracked files.

Required CLI behavior coverage:

| Command | Planned task | Required test coverage |
|---|---:|---|
| `agent-voice --help` | 1 | Lists every v1 command and `daemon --foreground` |
| `agent-voice config get/set` | 2 | Reads defaults, writes dotted values, rejects unknown paths safely |
| `agent-voice enable/disable <agent>` | 2 | Toggles `agents.<name>.enabled`; rejects unknown agents |
| `agent-voice enqueue --format ...` | 5 | Required format, format-specific `--agent` rules, fail-open enqueue |
| `agent-voice daemon --foreground` | 9 | Starts loop in injectable one-shot mode; handles signals |
| `agent-voice start/stop/status` | 9/10 | Uses daemon lock/status and LaunchAgent helpers without touching real launchd in tests |
| `agent-voice test "text"` | 9 | Runs a manual summarize/speak smoke path with fake deps; does not require agent adapter payloads |
| `agent-voice install/uninstall` | 10/11 | Idempotent, reversible, owned-file-only, backup manifest, LaunchAgent plist |
| `voice-codex` / `voice-opencode` | 11 | Preserve exit code, recursion guard, capture non-interactive output |

TDD rules for workers:

- Do not combine a new module and its downstream integration in one step. Add focused failing tests first, implement the smallest module behavior, then wire CLI or daemon usage in a later step.
- Every task must leave the repo in a testable state and commit only files from that task.
- Any implementation uncertainty around agent-native hook payloads must be isolated behind adapter tests/fixtures and must not block the reliable wrapper path.
- Each task must use the pattern: failing test → run exact focused command and see expected failure → minimal implementation → run focused command and see pass → commit.
- If a task touches more than one behavior family, split the work inside the task into separate test-first steps. Do not write broad implementation code before the corresponding focused test exists.

Plan-blocker coverage matrix:

| Review blocker | Where this plan now covers it |
|---|---|
| Required CLI commands ambiguous | Coverage table above; Tasks 1, 2, 5, 9, 10, 11, 12 require command-specific tests |
| Install safety and uninstall restore ambiguous | Task 10 requires backup manifest, ownership markers, restore behavior, merge-skip behavior, and LaunchAgent command tests |
| LaunchAgent semantics ambiguous | Task 10 requires exact plist keys, bootstrap/bootout selection, and intentional-stop marker tests |
| Recursion guards under-specified | Tasks 7 and 11 require `AGENT_VOICE_DISABLE=1` in summarizer children and wrapper/adapter skip tests |
| Queue disabled/retry semantics under-tested | Tasks 6, 9, and 12 require `skipped`, `nextAttemptAt`, restart, and max-attempt tests |

Feature-workflow handoff before implementation:

- Implementation must proceed with `superpowers:test-driven-development` for each task.
- Use `superpowers:subagent-driven-development` if tasks are delegated, or `superpowers:executing-plans` if executed inline.
- Keep implementation single-writer on `master` because the user explicitly declined a worktree.
- After implementation, run `/feature-workflow` Phase 5 review: correctness/regression, install safety, and test coverage/maintainability.
- Do not claim implementation completion until the quality gate at the end of this plan passes freshly.

---

### Task 1: Scaffold Bun/TypeScript CLI and test harness

**Files:**
- Create: `package.json`
- Create: `src/index.ts`
- Create: `src/cli.ts`
- Create: `src/executable.ts`
- Create: `tests/cli.test.ts`
- Create: `bin/agent-voice`

- [ ] **Step 1: Write the failing CLI help test**

Create `tests/cli.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";

describe("agent-voice CLI", () => {
  test("prints help with core commands", async () => {
    const result = await runCli(["--help"], { stdout: "", stderr: "" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("agent-voice install");
    expect(result.stdout).toContain("agent-voice uninstall");
    expect(result.stdout).toContain("agent-voice start");
    expect(result.stdout).toContain("agent-voice stop");
    expect(result.stdout).toContain("agent-voice status");
    expect(result.stdout).toContain("agent-voice enqueue --format");
    expect(result.stdout).toContain("agent-voice test");
    expect(result.stdout).toContain("agent-voice enable");
    expect(result.stdout).toContain("agent-voice disable");
    expect(result.stdout).toContain("agent-voice config get");
    expect(result.stdout).toContain("agent-voice daemon --foreground");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/cli.test.ts`

Expected: FAIL with module-not-found for `../src/cli`.

- [ ] **Step 3: Add minimal package and CLI implementation**

Create `package.json`:

```json
{
  "name": "claude-sum-up-hook",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "bin": {
    "agent-voice": "./bin/agent-voice",
    "voice-codex": "./bin/voice-codex",
    "voice-opencode": "./bin/voice-opencode"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "latest"
  }
}
```

Create `src/cli.ts` with a minimal `runCli(args, io)` returning `{ exitCode, stdout, stderr }` and a help string containing all core commands from the coverage table. For commands not implemented yet, return exit code `2` with a clear `not implemented yet` message rather than silently succeeding.

Create `src/index.ts` that calls `runCli(process.argv.slice(2), process)` and exits with the returned code.

Create `src/executable.ts` with helpers that resolve executable/install paths without depending on the caller's current working directory.

Create `bin/agent-voice` as a cwd-independent shim that resolves the repo/install root from the shim path:

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(dirname -- "$SCRIPT_DIR")"
exec bun "$ROOT_DIR/src/index.ts" "$@"
```

Never use `$PWD` in shims or LaunchAgent `ProgramArguments`.

- [ ] **Step 4: Run the focused test**

Run: `bun test tests/cli.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit scaffold**

```bash
git add -- package.json src/index.ts src/cli.ts src/executable.ts tests/cli.test.ts bin/agent-voice
git commit -m "feat: scaffold agent voice cli"
```

---

### Task 2: Config, paths, and safe home isolation

**Files:**
- Create: `src/paths.ts`
- Create: `src/config.ts`
- Create: `tests/config.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing config tests**

Create tests proving config/path behavior and CLI config commands:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { defaultConfig, loadConfig, setConfigValue } from "../src/config";
import { runCli } from "../src/cli";
import { resolvePaths } from "../src/paths";

test("resolves AGENT_VOICE_HOME before falling back to ~/.agent-voice", () => {
  const home = mkdtempSync(join(tmpdir(), "agent-voice-test-"));
  try {
    const paths = resolvePaths({ AGENT_VOICE_HOME: home });
    expect(paths.home).toBe(home);
    expect(paths.config).toBe(join(home, "config.json"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("default config includes fast summarizer priority and absolute Kokoro path field", () => {
  expect(defaultConfig.summarizer.priority).toEqual(["codex-fast", "pi-fast", "opencode", "heuristic"]);
  expect(defaultConfig.summarizer.codexModel).toBe("gpt-5.3-codex");
  expect(defaultConfig.tts.kokoroScript).toContain("kokoro_tts_service.py");
});

test("setConfigValue updates dotted paths", () => {
  const updated = setConfigValue(defaultConfig, "summarizer.timeoutSeconds", "8");
  expect(updated.summarizer.timeoutSeconds).toBe(8);
});

test("enable and disable toggle known agents only", async () => {
  const home = mkdtempSync(join(tmpdir(), "agent-voice-test-"));
  try {
    expect((await runCli(["disable", "codex"], { env: { AGENT_VOICE_HOME: home } })).exitCode).toBe(0);
    expect(loadConfig(resolvePaths({ AGENT_VOICE_HOME: home })).agents.codex.enabled).toBe(false);
    expect((await runCli(["enable", "codex"], { env: { AGENT_VOICE_HOME: home } })).exitCode).toBe(0);
    expect(loadConfig(resolvePaths({ AGENT_VOICE_HOME: home })).agents.codex.enabled).toBe(true);
    expect((await runCli(["disable", "unknown"], { env: { AGENT_VOICE_HOME: home } })).exitCode).toBe(2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test tests/config.test.ts`

Expected: FAIL because `src/config.ts` and `src/paths.ts` do not exist.

- [ ] **Step 3: Implement paths and config**

Implement:

- `resolvePaths(env = process.env)`
- `defaultConfig`
- `loadConfig(paths)`
- `saveConfig(paths, config)`
- `setConfigValue(config, dottedPath, value)` with simple string/number/boolean parsing
- Directory constants for `spool/incoming`, `processing`, `done`, `failed`, `skipped`, `logs`, `run`, `backups`

Use the absolute Kokoro default `/Users/meidhy/junk/repo/kokoro-tts/Python/kokoro_tts_service.py` only as default config value; install will validate existence later.

- [ ] **Step 4: Wire `agent-voice config get/set` and `enable/disable`**

Add CLI dispatch for:

```bash
agent-voice config get
agent-voice config set summarizer.timeoutSeconds 8
agent-voice disable codex
agent-voice enable codex
```

Validation rules:

- `enable/disable` accepts only `claude`, `codex`, `pi`, or `opencode`.
- `config set` rejects unknown dotted paths rather than creating arbitrary nested keys.
- All config writes create `~/.agent-voice` under the configured `AGENT_VOICE_HOME` in tests, never under the real home.

- [ ] **Step 5: Run tests**

Run: `bun test tests/config.test.ts tests/cli.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit config foundation**

```bash
git add -- src/paths.ts src/config.ts src/cli.ts tests/config.test.ts
git commit -m "feat: add agent voice config foundation"
```

---

### Task 3: Canonical events

**Files:**
- Create: `src/events.ts`
- Create: `tests/events.test.ts`

- [ ] **Step 1: Write failing event tests**

Test cases:

- valid event passes with required fields
- unsupported version rejects
- missing text rejects unless adapter extraction path permits generic completion before validation
- metadata accepts safe nested objects and rejects prototype-pollution keys

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/events.test.ts`

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement event validation**

Implement:

- `type AgentName = "claude" | "codex" | "pi" | "opencode"`
- `type AgentVoiceEvent`
- `validateEvent(input): { ok: true; event } | { ok: false; reason }`
- `createEvent({ agent, text, cwd, sessionId, metadata })`

Use `crypto.randomUUID()` for IDs.

- [ ] **Step 4: Run tests**

Run: `bun test tests/events.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit event foundation**

```bash
git add -- src/events.ts tests/events.test.ts
git commit -m "feat: add agent voice event validation"
```

---

### Task 4: Atomic spool enqueue and state moves

**Files:**
- Create: `src/spool.ts`
- Create: `tests/spool.test.ts`
- Modify: `src/config.ts` if needed

- [ ] **Step 1: Write failing spool tests**

Test with temp `AGENT_VOICE_HOME`:

- `ensureHome(paths)` creates all spool directories including `skipped`
- `enqueueEvent(paths, event)` writes one file under `incoming`
- filename starts with sortable timestamp and includes agent/event ID
- temp file is not left behind on success
- `moveJob(paths, file, "processing")` moves atomically
- retention cleanup deletes old `done`/`failed`/`skipped` records only

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/spool.test.ts`

Expected: FAIL because `src/spool.ts` does not exist.

- [ ] **Step 3: Implement spool module**

Implement:

- `ensureHome(paths)`
- `enqueueEvent(paths, event)`
- `listJobs(paths, state)`
- `moveJob(paths, jobPath, targetState)`
- `writeJob(paths, state, eventOrJob)`
- `cleanupRetention(paths, retentionDays)`

Atomic write algorithm:

1. write JSON to `incoming/.tmp-<id>.json`
2. best-effort fsync file
3. rename to final filename in `incoming`

- [ ] **Step 4: Run tests**

Run: `bun test tests/spool.test.ts tests/events.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit spool module**

```bash
git add -- src/spool.ts tests/spool.test.ts src/config.ts
git commit -m "feat: add atomic voice event spool"
```

---

### Task 5: `agent-voice enqueue` CLI formats

**Files:**
- Modify: `src/cli.ts`
- Create: `src/adapters/claude.ts`
- Create: `fixtures/claude-stop-hook.sample.json`
- Create: `fixtures/event.sample.json`
- Create: `tests/enqueue-cli.test.ts`

- [ ] **Step 1: Write failing enqueue tests**

Tests must prove:

- `--format` is required
- `--format text` requires `--agent`
- `--format event-json` ignores matching `--agent` and rejects mismatched `--agent`
- `--format claude-stop-hook` requires `--agent claude`
- failed extraction for Claude creates generic completion only because Claude support tier allows it
- enqueue never starts daemon or summarizer
- command exits `0` on best-effort enqueue failure

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/enqueue-cli.test.ts`

Expected: FAIL because enqueue dispatch is not implemented.

- [ ] **Step 3: Implement Claude adapter extraction**

Implement `extractClaudeStopHook(payload)` defensively:

- try known text-ish fields if present
- if no final text, return `{ text: "Claude finished responding.", generic: true }`
- never throw on unknown payload shape

- [ ] **Step 4: Implement enqueue CLI**

`runCli` should read stdin from the test-injected IO object. For real process IO, `src/index.ts` should collect stdin when command is `enqueue`.

- [ ] **Step 5: Run tests**

Run: `bun test tests/enqueue-cli.test.ts tests/spool.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit enqueue CLI**

```bash
git add -- src/cli.ts src/index.ts src/adapters/claude.ts fixtures/claude-stop-hook.sample.json fixtures/event.sample.json tests/enqueue-cli.test.ts
git commit -m "feat: add async enqueue cli"
```

---

### Task 6: Queue retry, skipped, dedupe, and stale recovery

**Files:**
- Create: `src/queue.ts`
- Create: `tests/queue.test.ts`
- Modify: `src/spool.ts` if needed

- [ ] **Step 1: Write failing queue tests**

Test:

- oldest due incoming job selected first
- future `nextAttemptAt` is skipped until due
- attempts increment when moving to processing
- retry backoff: `nextAttemptAt = now + retryBackoffSeconds * attempts`, capped by `processingTimeoutSeconds`
- max attempts moves to `failed`
- disabled system/agent/ignored cwd moves to `skipped`
- stale processing jobs move back to incoming on startup
- duplicate event ID is not processed twice

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/queue.test.ts`

Expected: FAIL because `src/queue.ts` does not exist.

- [ ] **Step 3: Implement queue policy**

Implement pure functions where possible:

- `shouldSkipJob(event, config)`
- `markAttempt(job, now)`
- `scheduleRetry(job, config, now)`
- `isDue(job, now)`
- `recoverStaleProcessing(paths, config, now)`
- `dedupeSeenEvent(paths, eventId)`

- [ ] **Step 4: Run tests**

Run: `bun test tests/queue.test.ts tests/spool.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit queue policy**

```bash
git add -- src/queue.ts src/spool.ts tests/queue.test.ts
git commit -m "feat: add voice queue retry policy"
```

---

### Task 7: Safe summarizer fallback chain

**Files:**
- Create: `src/summarizers.ts`
- Create: `tests/summarizers.test.ts`

- [ ] **Step 1: Write failing summarizer tests**

Use an injected fake subprocess runner. Test:

- Codex command uses arg array including `exec`, `-m`, `gpt-5.3-codex`, `-c`, `service_tier='"fast"`, `--skip-git-repo-check`, `--ephemeral`, `-`
- Pi command uses `--fast`, `-p`, configured model, `--no-tools`, `--no-session`, `-`
- `AGENT_VOICE_DISABLE=1` is present in child env
- agent text is passed via stdin, not interpolated into args
- missing executable skips to next summarizer
- all external failures fall back to heuristic
- heuristic returns a single short sentence under `maxSummaryChars`

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/summarizers.test.ts`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement summarizers**

Implement:

- `summarize(event, config, runner)`
- `buildPrompt(event)`
- `heuristicSummary(text, maxChars)`
- safe runner contract `{ cmd, args, cwd, env, stdin, timeoutMs }`

Do not use shell interpolation.

- [ ] **Step 4: Run tests**

Run: `bun test tests/summarizers.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit summarizer chain**

```bash
git add -- src/summarizers.ts tests/summarizers.test.ts
git commit -m "feat: add voice summary fallback chain"
```

---

### Task 8: Kokoro TTS bridge and afplay playback

**Files:**
- Create: `src/tts.ts`
- Create: `fixtures/kokoro-ready-audio.jsonl`
- Create: `tests/tts.test.ts`

- [ ] **Step 1: Write failing TTS tests**

Mock the Kokoro subprocess and `afplay`. Test:

- sends `{"text":"...","voice":"af_heart"}` as one JSON line
- tolerates `{"status":"ready"}` and progress lines before audio
- decodes base64 WAV to temp file under `run/audio`
- calls `afplay` with arg array
- restarts Kokoro once after invalid JSON/error
- deletes temp file best-effort

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/tts.test.ts`

Expected: FAIL because `src/tts.ts` does not exist.

- [ ] **Step 3: Implement TTS bridge**

Implement:

- `KokoroClient` class with `ensureReady()`, `speak(text, voice)` and `dispose()`
- `playWav(buffer, paths, runner)`
- retry-once behavior for Kokoro job failure

- [ ] **Step 4: Run tests**

Run: `bun test tests/tts.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit TTS bridge**

```bash
git add -- src/tts.ts fixtures/kokoro-ready-audio.jsonl tests/tts.test.ts
git commit -m "feat: add kokoro voice playback"
```

---

### Task 9: Job processor, daemon lifecycle, and runtime CLI commands

**Files:**
- Create: `src/processor.ts`
- Create: `src/daemon.ts`
- Create: `tests/daemon.test.ts`
- Create: `tests/daemon-cli.test.ts`
- Create: `tests/integration-daemon.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing processor tests**

Create `tests/daemon.test.ts` with fake summarizer/TTS and temp `AGENT_VOICE_HOME`. Test:

- one incoming job moves to `done` after summarize+speak
- disabled system moves due jobs to `skipped` with reason `disabled_system`
- disabled agent moves due jobs to `skipped` with reason `disabled_agent`
- ignored cwd moves due jobs to `skipped` with reason `ignored_cwd`
- summarizer external failures plus heuristic success moves to `done`
- TTS failure schedules retry with `nextAttemptAt`
- TTS failure after `maxAttempts` moves to `failed`
- SIGTERM/current-job shutdown path requeues current `processing` job without losing it

- [ ] **Step 2: Run processor tests to verify failure**

Run: `bun test tests/daemon.test.ts`

Expected: FAIL because `src/processor.ts` and `src/daemon.ts` do not exist.

- [ ] **Step 3: Write failing daemon CLI tests**

Create `tests/daemon-cli.test.ts`. Test with fake daemon/launch helpers:

- `agent-voice daemon --foreground --once` processes one due job in test mode
- `agent-voice status` reports daemon PID/lock state and queue counts
- `agent-voice start` refuses to create a second daemon when a healthy lock exists
- `agent-voice stop` writes the intentional-stop marker before invoking stop helpers
- `agent-voice test "text"` runs a manual summarize/speak path with fake deps and does not require adapter payloads

- [ ] **Step 4: Run daemon CLI tests to verify failure**

Run: `bun test tests/daemon-cli.test.ts`

Expected: FAIL because daemon CLI dispatch is not implemented.

- [ ] **Step 5: Implement processor**

Implement `processNextJob(paths, config, deps, now)` that:

1. recovers stale processing before loop start
2. picks oldest due incoming job
3. checks disabled/ignored policy
4. increments attempts and moves to processing
5. summarizes
6. speaks
7. writes done/failed/skipped with error metadata

- [ ] **Step 6: Implement daemon lifecycle and runtime CLI dispatch**

Implement:

- PID/lock file
- polling loop with small interval
- signal handlers
- `status` data
- `daemon --foreground` CLI command
- `daemon --foreground --once` test-only loop mode
- `start`, `stop`, `status`, and `test` CLI dispatch using injectable helpers

- [ ] **Step 7: Run tests**

Run: `bun test tests/daemon.test.ts tests/daemon-cli.test.ts tests/integration-daemon.test.ts tests/queue.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit daemon**

```bash
git add -- src/processor.ts src/daemon.ts src/cli.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/integration-daemon.test.ts
git commit -m "feat: add voice daemon processor"
```

---

### Task 10: Installer, LaunchAgent, backups, and uninstall

**Files:**
- Create: `src/install.ts`
- Create: `tests/install.test.ts`
- Modify: `src/cli.ts`
- Modify: `README.md`

- [ ] **Step 1: Write failing install tests**

Tests must not load real launchd. Use fake filesystem home and fake command runner. Test:

- LaunchAgent plist contains label, absolute ProgramArguments, WorkingDirectory, logs, `AGENT_VOICE_HOME`, `RunAtLoad`, and crash-only `KeepAlive`
- LaunchAgent plist does **not** include `AGENT_VOICE_DISABLE`
- install validates `--kokoro-script` or autodetected absolute Kokoro path before writing LaunchAgent
- install backs up existing config with manifest including path/timestamp/sha256
- install is idempotent and does not duplicate marked entries
- uninstall removes only owned files/entries
- `uninstall --restore-backups` restores the latest matching backup only when manifest ownership/path/hash checks are safe
- uninstall refuses to restore a backup over a file that changed unexpectedly unless forced by a future non-v1 flag
- `launchctl bootstrap gui/$UID` command selected on install
- `launchctl bootout gui/$UID` command selected on uninstall
- start/stop intentional-stop marker behavior
- ambiguous config merge skips native adapter instead of overwriting
- install/uninstall never mutates real `~/.claude`, `~/.pi`, `~/.codex`, `~/.config/opencode`, or `~/Library/LaunchAgents` during tests

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/install.test.ts`

Expected: FAIL because `src/install.ts` does not exist.

- [ ] **Step 3: Implement installer helpers**

Implement:

- `renderLaunchAgentPlist(config, executablePath, paths)`
- `backupFile(path, backupsDir)` plus backup manifest writing
- `restoreLatestBackup(manifest, targetPath)` with safe ownership/hash checks
- `installLaunchAgent(...)`
- `uninstallLaunchAgent(...)`
- `installAdapters(...)` as initially file-generation only, no risky config mutation without marker support
- `install` / `uninstall` / `uninstall --restore-backups` CLI dispatch

- [ ] **Step 4: Document install/data-flow basics**

Create/update `README.md` with:

- what the tool does
- data-flow warning: external summarizers may receive captured text
- fully local heuristic mode
- install/uninstall commands
- test command

- [ ] **Step 5: Run tests**

Run: `bun test tests/install.test.ts tests/config.test.ts tests/daemon-cli.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit installer**

```bash
git add -- src/install.ts src/cli.ts README.md tests/install.test.ts
git commit -m "feat: add global voice installer"
```

---

### Task 11: Pi extension generator and Claude/Codex/OpenCode wrappers

**Files:**
- Create: `src/adapters/pi-extension.ts`
- Create: `src/wrappers.ts`
- Create: `bin/voice-codex`
- Create: `bin/voice-opencode`
- Create: `tests/adapters.test.ts`
- Create: `tests/wrappers.test.ts`
- Modify: `src/install.ts`

- [ ] **Step 1: Write failing adapter/wrapper tests**

Test:

- generated Pi extension includes `AGENT_VOICE_DISABLE` guard
- generated Pi extension writes event using `agent-voice enqueue --format event-json`
- wrapper preserves wrapped process exit code
- wrapper skips enqueue when `AGENT_VOICE_DISABLE=1`
- `voice-codex exec ...` captures final stdout and enqueues after process exit
- `voice-opencode run ...` captures final stdout and enqueues after process exit
- interactive unsupported path enqueues generic completion only when configured

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/adapters.test.ts tests/wrappers.test.ts`

Expected: FAIL because modules/wrappers do not exist.

- [ ] **Step 3: Implement Pi extension generator**

Generate a TypeScript extension string/file for `~/.pi/agent/extensions/agent-voice.ts` that:

- subscribes to final assistant message / `agent_end` pattern discovered during implementation
- keeps last assistant text per turn if needed
- spawns `agent-voice enqueue --format event-json` detached
- does not await speech
- exits/skips if `AGENT_VOICE_DISABLE` is set

If exact Pi event payload is unclear, implement the safest documented event path and mark any unsupported path in install output.

- [ ] **Step 4: Implement wrapper helpers and shims**

Implement shared wrapper logic in `src/wrappers.ts` and thin `bin/voice-codex`, `bin/voice-opencode` scripts.

- [ ] **Step 5: Wire installer to create adapter files**

Install:

- Claude hook wrapper/command with marker/backup behavior
- Pi extension file
- wrapper scripts or symlinks for Codex/OpenCode

- [ ] **Step 6: Run tests**

Run: `bun test tests/adapters.test.ts tests/wrappers.test.ts tests/install.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit adapters/wrappers**

```bash
git add -- src/adapters/pi-extension.ts src/wrappers.ts src/install.ts bin/voice-codex bin/voice-opencode tests/adapters.test.ts tests/wrappers.test.ts
git commit -m "feat: add agent voice adapters"
```

---

### Task 12: End-to-end validation, typecheck, and docs polish

**Files:**
- Modify: `README.md`
- Modify: any source/test files needed for final fixes

- [ ] **Step 1: Add final smoke tests if gaps remain**

Add tests for any uncovered acceptance criteria from the spec, especially:

- daemon stopped → events remain in incoming
- restart requeues stale processing
- install/uninstall idempotency and `--restore-backups`
- `agent-voice start`, `stop`, `status`, and `test` command coverage
- wrappers skip enqueue when `AGENT_VOICE_DISABLE=1`
- LaunchAgent plist does not set `AGENT_VOICE_DISABLE`

- [ ] **Step 2: Run full test suite**

Run: `bun test`

Expected: all tests pass.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`

Expected: TypeScript exits 0.

- [ ] **Step 4: Run CLI smoke checks without touching global config**

Use temp home:

```bash
TMP_HOME=$(mktemp -d)
AGENT_VOICE_HOME="$TMP_HOME" bun src/index.ts --help
AGENT_VOICE_HOME="$TMP_HOME" bun src/index.ts config get
printf 'Claude updated the docs.' | AGENT_VOICE_HOME="$TMP_HOME" bun src/index.ts enqueue --format text --agent claude
find "$TMP_HOME/spool/incoming" -type f | wc -l
rm -rf "$TMP_HOME"
```

Expected: help/config succeed and one incoming event file is created.

- [ ] **Step 5: Update README final usage**

Ensure README includes:

- install/uninstall
- start/stop/status
- enqueue examples with required `--format`
- data-flow warning
- local heuristic mode
- wrappers
- Kokoro path configuration

- [ ] **Step 6: Commit validation/docs**

```bash
git add -- README.md package.json src/cli.ts src/config.ts src/daemon.ts src/events.ts src/executable.ts src/index.ts src/install.ts src/paths.ts src/processor.ts src/queue.ts src/spool.ts src/summarizers.ts src/tts.ts src/wrappers.ts src/adapters/claude.ts src/adapters/pi-extension.ts tests/cli.test.ts tests/config.test.ts tests/events.test.ts tests/spool.test.ts tests/enqueue-cli.test.ts tests/queue.test.ts tests/summarizers.test.ts tests/tts.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/install.test.ts tests/adapters.test.ts tests/wrappers.test.ts tests/integration-daemon.test.ts fixtures/claude-stop-hook.sample.json fixtures/event.sample.json fixtures/kokoro-ready-audio.jsonl bin/agent-voice bin/voice-codex bin/voice-opencode
git commit -m "docs: document agent voice usage"
```

---

## Quality gate before implementation is considered complete

Run these fresh commands and capture output:

```bash
bun test
bun run typecheck
TMP_HOME=$(mktemp -d)
AGENT_VOICE_HOME="$TMP_HOME" bun src/index.ts --help
AGENT_VOICE_HOME="$TMP_HOME" bun src/index.ts config get
printf 'Claude updated the docs.' | AGENT_VOICE_HOME="$TMP_HOME" bun src/index.ts enqueue --format text --agent claude
test "$(find "$TMP_HOME/spool/incoming" -type f | wc -l | tr -d ' ')" = "1"
rm -rf "$TMP_HOME"
```

Expected:

- `bun test`: pass
- `bun run typecheck`: exit 0
- CLI smoke: help/config succeed and one event is enqueued in temp home

## Review plan after implementation

Use `/feature-workflow` Phase 5 style review:

- correctness/regression review
- data-flow/install safety review
- test coverage/maintainability review

Fix only blockers and in-scope issues, then rerun the quality gate.
