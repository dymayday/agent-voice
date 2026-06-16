# Fix Pi Lens Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce or intentionally resolve the findings in `.pi-lens/reviews/booboo-2026-06-15T17-00-21.md` without changing CLI behavior.

**Architecture:** Treat the review as a triage list, not an order to blindly refactor everything. First remove low-risk noise and dead exports, then split large command/control flows into focused helpers while preserving current public behavior with tests. Defer cosmetic duplicate blocks that are intentional launcher/script boilerplate unless the duplicated code can be extracted without hurting clarity.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, `bun test`, `tsc --noEmit`, pi-lens diagnostics/review.

---

## Source finding inventory

The original `.pi-lens/reviews/booboo-2026-06-15T17-00-21.md` artifact may be untracked/ephemeral, so this plan embeds the finding inventory required for auditability.

### LSP diagnostics observed separately

- `src/db.ts:38-42`: deprecated `db.exec(...)` signature hints.
- `src/store.ts:228`, `src/store.ts:261`: deprecated `db.exec(...)` signature hints.
- `tests/history-json.test.ts:73`: `await` has no effect.
- `tests/tts.test.ts:138`, `tests/tts.test.ts:155`: `await` has no effect.

### Pi-lens review summary

- Overall: 49 issues; 46 fixable; 3 need refactor.
- Complexity metrics:
  - Low maintainability: `src/cli.ts` MI 15.0, cognitive 243, cyclomatic 14, nesting 8; `src/daemon.ts` MI 19.6, cognitive 78.
  - Very high cognitive complexity: `src/cli.ts` cognitive 243; `src/tts.ts` cognitive 108.
  - Additional maintainability/cognitive warnings: `src/config.ts`, `src/doctor.ts`, `src/queue.ts`, `src/store.ts`, `src/summarizers.ts`, `src/tts.ts`.
- Fact rules:
  - `high-complexity`: `runCli` in `src/cli.ts:127`, plus findings in `src/doctor.ts:19` and `src/events.ts:63`.
  - `pass-through-wrappers`: `src/config.ts:124`, `src/config.ts:176`, `src/summarizers.ts:176`.
  - `high-fan-out`: `runCli` calls 39 distinct functions.
  - `unsafe-boundary`: `runDaemonLoop` in `src/daemon.ts:235` is async, calls `db.close`, complexity 13, no try/catch.
  - `async-noise`: `readStdin` in `src/index.ts:3` has no await and appears to add async noise.
- Dead exports from Knip:
  - `clearIntentionalStop`, `hasIntentionalStop`, `DetachedDaemonRequest` in `src/daemon.ts`.
  - `markSkipped`, `rowToStoredJob`, `JobRow` in `src/store.ts`.
  - `runSummarizerSubprocess` in `src/summarizers.ts`.
  - `AgentVoiceDb` in `src/db.ts`.
  - `AgentVoiceEventName` in `src/events.ts`.
  - `PlaybackRunResult` in `src/tts.ts`.
  - `DoctorCheck` in `src/doctor.ts`.
  - `AppHistoryJob` in `src/history.ts`.
- Duplicate code blocks:
  - `bin/agent-voice` vs `bin/voice-codex` launcher boilerplate.
  - Several repeated blocks in `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`.
  - `scripts/build-macos-app.sh` vs `scripts/generate-macos-icon.sh` shell boilerplate.
- Type coverage:
  - 99.4% typed, with any-typed identifier hot spots in `src/store.ts`, `src/adapters/claude.ts`, `src/config.ts`, `src/events.ts`, `src/index.ts`, `src/daemon.ts`, `src/doctor.ts`, `src/queue.ts`, `src/db.ts`, `src/history.ts`.
- Production readiness:
  - Score 82/100, grade B.
  - Missing test framework configuration, LICENSE/CHANGELOG, package description/author, build script, and package entry point.

## Findings covered

- LSP hints: deprecated `db.exec(...)` calls and no-op `await`s in tests.
- Fact rules: high complexity/fan-out, trivial pass-through wrappers, daemon async boundary risk, async-noise in `src/index.ts`.
- Dead exports from Knip.
- Complexity metrics for `src/cli.ts`, `src/daemon.ts`, `src/tts.ts`, `src/summarizers.ts`, `src/store.ts`, `src/config.ts`, `src/queue.ts`, `src/doctor.ts`, `src/events.ts`.
- Duplicate blocks from jscpd.
- Production-readiness metadata/docs gaps.
- Type coverage `any` hot spots.

## Non-goals / pushback candidates

- Do not add a test framework config unless Bun actually needs one; the repository already has `bun test` and 26 test files.
- Do not eliminate every tiny duplicate shell-script header if extraction makes scripts harder to run standalone.
- Do not chase maintainability-score perfection in one patch; prioritize blocking/high-signal items first.

---

### Task 1: Baseline and lock current behavior

**Files:**
- Read: embedded source finding inventory above
- Optionally read if present: `.pi-lens/reviews/booboo-2026-06-15T17-00-21.md`
- Read/modify only if missing coverage: `tests/*.test.ts`

- [ ] **Step 1: Run baseline commands**

```bash
bun run typecheck
bun run test
```

Expected: both pass before refactoring.

- [ ] **Step 2: Capture fresh diagnostics**

Run these pi tool checks from the agent session:

```ts
lsp_diagnostics({ filePath: ".", severity: "all", concurrency: 8 })
lens_diagnostics({ mode: "full", refreshRunners: "cheap", maxProjectFiles: 200, severity: "all" })
```

Expected current LSP hints: `src/db.ts`, `src/store.ts`, `tests/history-json.test.ts`, `tests/tts.test.ts`. Expected pi-lens categories should match or be compared against the embedded source finding inventory.

- [ ] **Step 3: Identify CLI behavior tests that must stay green**

Run targeted CLI tests if present, otherwise run all tests before and after each CLI task.

```bash
bun test tests/*cli* tests/*history* tests/*daemon*
```

Expected: either matching tests pass or Bun reports no matching files; if no targeted tests exist, use `bun run test`.

---

### Task 2: Fix low-risk TypeScript/LSP hints

**Files:**
- Modify: `src/db.ts`
- Modify: `src/store.ts`
- Modify: `tests/history-json.test.ts`
- Modify: `tests/tts.test.ts`

- [ ] **Step 1: Replace deprecated `db.exec(...)` usages**

For PRAGMA statements and schema SQL, use `db.run(...)` where supported by Bun sqlite, or isolate a local helper if Bun's type surface requires it:

```ts
function runSql(db: Database, sql: string): void {
  db.run(sql);
}
```

Then replace:

```ts
db.exec("PRAGMA journal_mode = WAL");
```

with:

```ts
runSql(db, "PRAGMA journal_mode = WAL");
```

Apply same pattern to:
- `src/db.ts:38-42`
- `src/store.ts:228`
- `src/store.ts:261`

- [ ] **Step 2: Remove no-op awaits in tests**

Change assertions such as:

```ts
await expect(Bun.file(paths.db).exists()).resolves.toBe(false);
```

only if the expression is synchronous. Keep `await` if the returned type is a Promise. For actual synchronous expressions in `tests/history-json.test.ts` and `tests/tts.test.ts`, remove `await`.

- [ ] **Step 3: Verify**

```bash
bun run typecheck
bun test tests/history-json.test.ts tests/tts.test.ts
```

Expected: no TypeScript hints for the edited lines; targeted tests pass.

---

### Task 3: Remove or privatize dead exports safely

**Files:**
- Modify: `src/daemon.ts`
- Modify: `src/store.ts`
- Modify: `src/summarizers.ts`
- Modify: `src/db.ts`
- Modify: `src/events.ts`
- Modify: `src/tts.ts`
- Modify: `src/doctor.ts`
- Modify: `src/history.ts`
- Modify: tests if imports rely on exported internals

- [ ] **Step 1: Verify each Knip finding against tests and source imports**

For each name, check whether it is imported outside its defining file:

```bash
rg "\b(clearIntentionalStop|hasIntentionalStop|DetachedDaemonRequest|markSkipped|rowToStoredJob|JobRow|runSummarizerSubprocess|AgentVoiceDb|AgentVoiceEventName|PlaybackRunResult|DoctorCheck|AppHistoryJob)\b" src tests macos scripts bin
```

Expected: only the defining export or tests that can be updated.

- [ ] **Step 2: Remove unused exported types/functions from public surface**

Preferred actions:
- Convert `export function` / `export interface` / `export type` to local declarations if used internally.
- Delete unused re-export block in `src/store.ts` if no external imports need it.
- Keep exports only when tests or intended CLI API genuinely need them.

- [ ] **Step 3: Verify**

```bash
bun run typecheck
bun run test
```

Expected: no broken imports; behavior unchanged.

---

### Task 4: Fix daemon async boundary and complexity hot spot

**Files:**
- Modify: `src/daemon.ts`
- Test: existing daemon tests under `tests/`

- [ ] **Step 1: Add/confirm test for DB close on processing error**

Write or locate a test where `processNextJob`/processor dependency throws inside `runDaemonLoop`, then assert the loop rejects and the DB can be reopened afterward.

- [ ] **Step 2: Make boundary explicit without a no-op rethrow**

`runDaemonLoop` already has `finally { db.close(); }`, so do **not** add `catch (error) { throw error; }`. Choose one technically meaningful option after inspecting the rule and tests:

1. Add a contextual catch that records or wraps the failure while preserving the original cause, for example:

```ts
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`daemon loop failed after ${summary.iterations} iterations: ${message}`, { cause: error });
} finally {
  db.close();
}
```

2. If wrapping would break tests or user-facing error messages, keep the current `finally` and add a supported pi-lens suppression/comment only if supported.
3. If no suppression is available and behavior should not change, document this as a false-positive residual: resource cleanup is already guaranteed by `finally`.

- [ ] **Step 3: Extract loop iteration helper**

Create a local helper such as:

```ts
async function processDaemonIteration(/* explicit options */): Promise<ProcessNextJobResult> {
  // one processNextJob call + maintenance decision
}
```

Keep `runDaemonLoop` responsible for lifecycle/open/close only.

- [ ] **Step 4: Verify**

```bash
bun test tests/*daemon*
bun run typecheck
```

Expected: daemon tests pass; complexity for `runDaemonLoop` lower or finding documented as false-positive.

---

### Task 5: Split `runCli` into command handlers

**Files:**
- Modify: `src/cli.ts`
- Optionally create: `src/cli-handlers.ts` or `src/commands/*.ts` if file size becomes unwieldy
- Test: CLI-related tests under `tests/`

- [ ] **Step 1: Add a command context type**

Introduce:

```ts
interface CliContext {
  args: string[];
  io: CliIo;
  paths: ReturnType<typeof resolvePaths>;
}

type CommandHandler = (context: CliContext) => Promise<CliResult> | CliResult;
```

- [ ] **Step 2: Confirm or add behavior tests before each handler extraction**

Before extracting each command group, confirm there is a test for the command's success and main error path. If coverage is missing, add a focused test first that asserts exact `exitCode`, `stdout`, and `stderr` for the current behavior. Minimum coverage required before extraction:
- help/unknown command
- `config get|set` success and invalid usage
- `enable|disable` unknown agent
- `pause|resume`
- `summarizer mode` valid and invalid mode
- `doctor --json` and missing `--json`
- `history --json` limit validation
- `enqueue` for text/event-json/claude-stop-hook validation paths
- daemon `start|stop|status|daemon --foreground` where dependency injection allows it

- [ ] **Step 3: Extract pure handlers one group at a time**

Move each current `if (command === ...)` block into a function, preserving exact output strings and exit codes:
- `handleConfigCommand`
- `handleAgentToggleCommand`
- `handlePauseResumeCommand`
- `handleSummarizerCommand`
- `handleDoctorCommand`
- `handleHistoryCommand`
- `handleEnqueueCommand`
- `handleTestCommand`
- `handleDaemonCommand`
- `handleInstallUninstallCommand`
- `handleStatusCommand`

- [ ] **Step 4: Replace top-level branching with dispatch map**

Use a map for simple commands and keep aliases explicit:

```ts
const handler = COMMAND_HANDLERS[command];
if (!handler) return result(2, "", `Unknown command: ${command}\n`);
return handler({ args, io, paths });
```

- [ ] **Step 5: Verify after every 1-2 handlers**

```bash
bun run typecheck
bun run test
```

Expected: all tests pass after each extraction; `runCli` complexity/fan-out substantially drops.

---

### Task 6: Remove trivial wrapper findings

**Files:**
- Modify: `src/config.ts`
- Modify: `src/summarizers.ts`

- [ ] **Step 1: Inspect each `hasOwn` wrapper**

For each reported line, confirm if it only delegates to `Object.prototype.hasOwnProperty.call` or similar.

- [ ] **Step 2: Replace with direct built-in or shared helper**

Preferred modern form:

```ts
Object.hasOwn(object, key)
```

If target/runtime compatibility is a concern, keep one shared helper and remove duplicate local wrappers.

- [ ] **Step 3: Verify**

```bash
bun run typecheck
bun test tests/*config* tests/*summarizer*
```

Expected: tests pass and pass-through-wrapper findings disappear.

---

### Task 7: Reduce `tts.ts` and summarizer complexity without behavior changes

**Files:**
- Modify: `src/tts.ts`
- Modify: `src/summarizers.ts`
- Test: `tests/tts.test.ts`, summarizer tests under `tests/`

- [ ] **Step 1: Characterize current behavior with targeted tests**

```bash
bun test tests/tts.test.ts tests/*summarizer*
```

Expected: pass before refactor.

- [ ] **Step 2: Extract validation/parsing helpers**

In `src/tts.ts`, split large methods into focused helpers such as request creation, response validation, temp-file creation, playback command execution, and cleanup.

In `src/summarizers.ts`, split mode selection, subprocess request creation, timeout handling, and heuristic fallback into local helpers.

- [ ] **Step 3: Keep public API stable**

Do not rename exported functions used by tests/CLI unless Task 3 already proved they are unused.

- [ ] **Step 4: Verify**

```bash
bun run typecheck
bun test tests/tts.test.ts tests/*summarizer*
```

Expected: targeted tests pass; cognitive complexity drops for edited functions.

---

### Task 8: Improve type coverage hot spots

**Files:**
- Modify: `src/store.ts`
- Modify: `src/adapters/claude.ts`
- Modify: `src/config.ts`
- Modify: `src/events.ts`
- Modify: `src/index.ts`
- Modify: `src/daemon.ts`
- Modify: `src/doctor.ts`
- Modify: `src/queue.ts`
- Modify: `src/db.ts`
- Modify: `src/history.ts`

- [ ] **Step 1: Find explicit/implicit `any` sources**

Use TypeScript diagnostics and source inspection. Focus on `JSON.parse`, database row casts, env records, and catch variables.

- [ ] **Step 2: Add narrow unknown-first parsing types**

Prefer:

```ts
const parsed: unknown = JSON.parse(input);
```

Then validate with existing validators before narrowing.

- [ ] **Step 3: Tighten SQLite row types**

Keep `JobRow`/row interfaces local unless exported intentionally. Cast database results to specific row shapes at the DB boundary only.

- [ ] **Step 4: Verify**

```bash
bun run typecheck
bun run test
```

Expected: type coverage improves or stays at 99.4%+ with fewer any-typed identifiers.

---

### Task 9: Address duplicate code pragmatically

**Files:**
- Review: `bin/agent-voice`
- Review: `bin/voice-codex`
- Review: `bin/voice-opencode`
- Review: `scripts/build-macos-app.sh`
- Review: `scripts/generate-macos-icon.sh`
- Modify if worthwhile: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`

- [ ] **Step 1: Classify duplicates as intentional or extractable**

Document each duplicate block:
- launcher shebang/import boilerplate: likely intentional
- Swift test setup/assertion blocks: likely extractable into helper methods
- shell strict-mode header: likely intentional

- [ ] **Step 2: Extract Swift test helpers if safe**

Create helper functions in the Swift test file for repeated setup/assertion sequences.

- [ ] **Step 3: Leave script/launcher duplicates if extraction hurts standalone usability**

If left as-is, document as accepted duplicate boilerplate.

- [ ] **Step 4: Verify**

```bash
bun run test
```

If macOS Swift tests have a known command, run that too; otherwise document not run.

---

### Task 10: Production-readiness metadata/docs

**Files:**
- Modify: `package.json`
- Create: `LICENSE` or `LICENSE.md` only if the project owner confirms license
- Create: `CHANGELOG.md`

- [ ] **Step 1: Add safe package metadata**

Add `description` and `main`/entry metadata only if accurate. Do not invent an `author` or license without owner approval.

Suggested safe package changes:

```json
{
  "description": "Local hook that summarizes coding-agent turns and speaks them through a queue-backed daemon."
}
```

- [ ] **Step 2: Add build script only if there is a real build artifact**

For TypeScript no-emit projects, avoid fake build scripts. If package consumers need validation, add:

```json
"build": "bun run typecheck"
```

only after confirming this is acceptable.

- [ ] **Step 3: Add changelog skeleton**

Create `CHANGELOG.md` with `Unreleased` and `0.1.0` sections.

- [ ] **Step 4: Ask owner about license/author**

Do not choose a license or author silently.

- [ ] **Step 5: Verify**

```bash
bun run typecheck
bun run test
```

Expected: package JSON remains valid; tests pass.

---

### Task 11: Final review and acceptance

**Files:**
- Review all changed files
- Read/write: `.pi-lens/reviews/` only if generating a new review artifact

- [ ] **Step 1: Run full verification**

```bash
bun run typecheck
bun run test
```

Expected: both pass.

- [ ] **Step 2: Run fresh diagnostics**

Use these pi tool checks from the agent session:

```ts
lsp_diagnostics({ filePath: ".", severity: "all", concurrency: 8 })
lens_diagnostics({ mode: "all", severity: "all" })
lens_diagnostics({ mode: "full", refreshRunners: "cheap", maxProjectFiles: 200, severity: "all" })
```

Expected: no TypeScript errors; LSP hints from Task 2 gone; edited-file lens diagnostics have no blocking errors.

- [ ] **Step 3: Re-run or regenerate code review artifact**

Use the project/user's pi-lens review command if available in the session. If no shell command is available, the required executable fallback is:

```ts
lens_diagnostics({ mode: "full", refreshRunners: "cheap", maxProjectFiles: 200, severity: "all" })
```

Compare the output against the embedded source finding inventory.

Expected:
- Dead export count reduced to 0 or documented exceptions.
- `runCli` high-complexity/fan-out reduced.
- No daemon unsafe-boundary finding, or documented false-positive with rationale.
- Production readiness score improved where owner-approved metadata/docs were added.

- [ ] **Step 4: Summarize residual risks**

List any intentionally accepted findings, especially duplicate boilerplate, license/author gaps, or rule false-positives.
