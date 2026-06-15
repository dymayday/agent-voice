# Agent Voice Mac App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native-feeling macOS app for Agent Voice with a menu bar sentinel, setup assistant, dashboard console, and the selected Local Voice Orb icon while preserving the existing Bun/TypeScript CLI, SQLite queue (`queue.db`), and daemon.

**Architecture:** Add app-facing CLI contracts first (`status --json`, pause/resume, doctor, summarizer mode), then build a SwiftUI macOS app that shells out to the CLI and reads status/history/config through tested CLI boundaries. The Swift app owns UI state and orchestration only; the existing CLI/daemon remains the source of truth for config, status, SQLite queueing, summarization, TTS, and daemon lifecycle.

**Tech Stack:** Bun + TypeScript + Bun test for existing CLI/daemon; Swift 6 / SwiftUI / XCTest / Swift Package Manager for the macOS app; macOS `sips` + `iconutil` for icon packaging; shell scripts for local app bundle assembly.

**Approved Spec:** `docs/superpowers/specs/2026-06-15-agent-voice-mac-app-design.md`

**Selected Icon Asset:** `assets/app-icon/agent-voice-local-voice-orb.png`

---

## Ground rules

- Current `master` uses SQLite queue storage (`src/db.ts`, `src/store.ts`, `src/paths.ts` => `queue.db`). This plan implements against the current SQLite queue and keeps docs wording aligned with that architecture.
- Work directly on `master`; the user previously declined worktrees.
- Do not stage unrelated tracked formatting drift currently visible in these files unless explicitly fixing them as part of a task:
  - `src/daemon.ts`
  - `src/events.ts`
  - `src/queue.ts`
  - `src/summarizers.ts`
  - `src/tts.ts`
  - `tests/daemon-cli.test.ts`
  - `tests/daemon.test.ts`
  - `tests/enqueue-cli.test.ts`
  - `tests/queue.test.ts`
  - `tests/summarizers.test.ts`
  - `tests/tts.test.ts`
- Do not stage unrelated untracked files:
  - `docs/superpowers/plans/2026-06-11-fast-mode-extension.md`
  - `docs/superpowers/plans/2026-06-11-sticky-fast-mode.md`
  - `docs/visual/`
  - `generated-images/`
- Use exact `git add -- <files>` commands. Never `git add .`, never broad `git add src tests docs`.
- After every `git add -- ...` in this plan, run `git diff --cached --name-only` and confirm the staged paths exactly match the files for that task before `git commit`. If any unrelated path appears, run `git restore --staged -- <path>` and inspect before committing.
- Do not implement adapter installation, LaunchAgent installation, or global agent config mutation in this plan. The Mac app may inspect and explain these states, but install/uninstall remains a later phase.
- The SwiftUI app must not reimplement daemon processing. It shells out to `agent-voice` and reads app-facing status/history state from CLI JSON commands.
- Use TDD for every CLI/core behavior. SwiftUI view compilation may be verified by build tests plus unit-tested view models/state machines.

---

## File structure

### TypeScript CLI additions

```text
src/status.ts                    # App-facing status snapshot builder and JSON formatter
src/doctor.ts                    # App-facing repair/diagnostic checks
src/summarizer-mode.ts           # Narrow commands for default vs heuristic-only summarizer mode
src/history.ts                   # App-facing recent queue/history JSON
tests/status-json.test.ts        # status --json and snapshot tests
tests/pause-resume.test.ts       # pause/resume command behavior
tests/doctor.test.ts             # doctor --json checks
tests/summarizer-mode.test.ts    # safe summarizer mode updates
tests/history-json.test.ts       # history --json app report
src/cli.ts                       # Wire new commands/help only; keep orchestration thin
```

### Swift macOS app additions

```text
macos/AgentVoiceApp/Package.swift
macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceStatus.swift
macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceConfig.swift
macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift
macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceState.swift
macos/AgentVoiceApp/Sources/AgentVoiceCore/HistoryModels.swift
macos/AgentVoiceApp/Sources/AgentVoiceCore/SetupAssistantModel.swift
macos/AgentVoiceApp/Sources/AgentVoiceCore/AppSettings.swift
macos/AgentVoiceApp/Sources/AgentVoiceCore/DoctorReport.swift
macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift
macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift
macos/AgentVoiceApp/Sources/AgentVoiceApp/MenuBarSentinelView.swift
macos/AgentVoiceApp/Sources/AgentVoiceApp/DashboardView.swift
macos/AgentVoiceApp/Sources/AgentVoiceApp/SetupAssistantView.swift
macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceStatusTests.swift
macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceCLITests.swift
macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/HistoryModelsTests.swift
macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/SetupAssistantModelTests.swift
macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift
macos/AgentVoiceApp/Resources/AppIcon.icns
macos/AgentVoiceApp/Resources/Info.plist
scripts/generate-macos-icon.sh
scripts/build-macos-app.sh
.gitignore                         # Ignore generated local app bundles under dist/
README.md                         # Add Mac app development/build notes
```

### Boundaries

- `src/status.ts` and `src/doctor.ts` expose stable JSON for non-TypeScript consumers.
- `src/cli.ts` only parses arguments and calls modules.
- `AgentVoiceCore` contains testable Swift logic with no SwiftUI dependency when possible.
- `AgentVoiceApp` contains SwiftUI views and process orchestration.
- Swift history models are read-only and decode the `history --json` CLI contract; the app does not read SQLite directly.
- Packaging scripts are local development helpers, not a full installer.


---

## Task 0: Preflight workspace hygiene

**Files:**
- No planned file changes.

- [ ] **Step 1: Confirm there are no staged files**

Run:

```bash
git diff --cached --name-only
```

Expected: no output. If anything is staged, stop and inspect before continuing.

- [ ] **Step 2: Inspect unrelated working-tree drift**

Run:

```bash
git status --short
git diff -- src/daemon.ts src/events.ts src/queue.ts src/summarizers.ts src/tts.ts tests/daemon-cli.test.ts tests/daemon.test.ts tests/enqueue-cli.test.ts tests/queue.test.ts tests/summarizers.test.ts tests/tts.test.ts | sed -n '1,260p'
```

Expected: if these files show only unrelated formatting drift, restore them before starting implementation:

```bash
git restore -- src/daemon.ts src/events.ts src/queue.ts src/summarizers.ts src/tts.ts tests/daemon-cli.test.ts tests/daemon.test.ts tests/enqueue-cli.test.ts tests/queue.test.ts tests/summarizers.test.ts tests/tts.test.ts
```

If the diff contains non-formatting user work, stop and ask before touching it.

- [ ] **Step 3: Confirm selected icon asset is present**

Run:

```bash
test -f assets/app-icon/agent-voice-local-voice-orb.png
sips -g pixelWidth -g pixelHeight assets/app-icon/agent-voice-local-voice-orb.png
```

Expected: `pixelWidth: 1024` and `pixelHeight: 1024`.

- [ ] **Step 4: No commit**

This task is workspace preparation only. Do not commit.

---

## Task 1: Add app-facing `status --json`

**Files:**
- Create: `src/status.ts`
- Create: `tests/status-json.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing status snapshot tests**

Create `tests/status-json.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";
import { loadConfig, saveConfig } from "../src/config";
import { createEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import { openDb } from "../src/db";
import { enqueue } from "../src/store";

type JsonStatus = {
  version: 1;
  daemon: { state: "running" | "stale" | "stopped"; running: boolean; pid: number | null };
  queues: { pending: number; processing: number; done: number; failed: number; skipped: number };
  config: { enabled: boolean; agents: Record<string, { enabled: boolean; mode: string }> };
  paths: { home: string; config: string; db: string };
  ui: { state: string; attention: string[] };
};

async function withTempHome<T>(fn: (home: string) => Promise<T> | T): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), "agent-voice-status-test-"));
  try {
    return await fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("agent-voice status --json", () => {
  test("returns parseable app status without changing text status", async () => {
    await withTempHome(async (home) => {
      const paths = resolvePaths({ AGENT_VOICE_HOME: home });
      const db = openDb(paths.db);
      enqueue(db, createEvent({ agent: "claude", text: "Done." }));
      db.close();

      const jsonResult = await runCli(["status", "--json"], {
        env: { AGENT_VOICE_HOME: home },
        daemonDeps: { isPidAlive: () => false },
      });
      expect(jsonResult.exitCode).toBe(0);
      const parsed = JSON.parse(jsonResult.stdout) as JsonStatus;

      expect(parsed.version).toBe(1);
      expect(parsed.daemon.state).toBe("stopped");
      expect(parsed.queues.pending).toBe(1);
      expect(parsed.config.enabled).toBe(true);
      expect(parsed.paths.home).toBe(home);
      expect(parsed.ui.state).toBe("daemon_stopped");

      const textResult = await runCli(["status"], {
        env: { AGENT_VOICE_HOME: home },
        daemonDeps: { isPidAlive: () => false },
      });
      expect(textResult.stdout).toContain("stopped");
      expect(() => JSON.parse(textResult.stdout)).toThrow();
    });
  });

  test("reports paused and failed attention from config and queues", async () => {
    await withTempHome(async (home) => {
      const paths = resolvePaths({ AGENT_VOICE_HOME: home });
      const config = loadConfig(paths);
      saveConfig(paths, { ...config, enabled: false });
      const db = openDb(paths.db);
      enqueue(db, createEvent({ agent: "pi", text: "Paused event." }));
      db.close();

      const result = await runCli(["status", "--json"], {
        env: { AGENT_VOICE_HOME: home },
        daemonDeps: { isPidAlive: () => true },
      });

      const parsed = JSON.parse(result.stdout) as JsonStatus;
      expect(parsed.config.enabled).toBe(false);
      expect(parsed.ui.state).toBe("paused");
      expect(parsed.ui.attention).toContain("system_paused");
    });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `bun test tests/status-json.test.ts`

Expected: FAIL because `status --json` is not implemented.

- [ ] **Step 3: Implement `src/status.ts`**

Create `src/status.ts`:

```ts
import type { AgentVoiceConfig } from "./config";
import { loadConfig } from "./config";
import { getDaemonStatus, type DaemonCliDeps } from "./daemon";
import type { AgentVoicePaths } from "./paths";

export interface AppStatusSnapshot {
  version: 1;
  daemon: {
    state: "running" | "stale" | "stopped";
    running: boolean;
    pid: number | null;
  };
  queues: Record<"pending" | "processing" | "done" | "failed" | "skipped", number>;
  config: Pick<AgentVoiceConfig, "enabled" | "agents">;
  paths: { home: string; config: string; db: string };
  ui: { state: "ready" | "processing" | "paused" | "needs_attention" | "daemon_stopped"; attention: string[] };
}

function daemonState(status: ReturnType<typeof getDaemonStatus>): "running" | "stale" | "stopped" {
  if (status.running) return "running";
  return status.pid ? "stale" : "stopped";
}

function deriveUiState(snapshot: Omit<AppStatusSnapshot, "ui">): AppStatusSnapshot["ui"] {
  const attention: string[] = [];
  if (!snapshot.config.enabled) attention.push("system_paused");
  if (snapshot.queues.failed > 0) attention.push("failed_jobs");
  if (snapshot.daemon.state === "stale") attention.push("stale_daemon_lock");

  if (!snapshot.config.enabled) return { state: "paused", attention };
  if (snapshot.daemon.state === "stopped") return { state: "daemon_stopped", attention };
  if (attention.length > 0) return { state: "needs_attention", attention };
  if (snapshot.queues.processing > 0) return { state: "processing", attention };
  return { state: "ready", attention };
}

export function buildAppStatusSnapshot(
  paths: AgentVoicePaths,
  deps: DaemonCliDeps = {},
): AppStatusSnapshot {
  const daemon = getDaemonStatus(paths, deps);
  const config = loadConfig(paths);
  const base = {
    version: 1 as const,
    daemon: { state: daemonState(daemon), running: daemon.running, pid: daemon.pid },
    queues: daemon.queues,
    config: { enabled: config.enabled, agents: config.agents },
    paths: { home: paths.home, config: paths.config, db: paths.db },
  };
  return { ...base, ui: deriveUiState(base) };
}

export function formatAppStatusJson(snapshot: AppStatusSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
```

- [ ] **Step 4: Wire `status --json` in `src/cli.ts`**

In the existing `status` branch, detect `args.includes("--json")` and return `formatAppStatusJson(buildAppStatusSnapshot(paths, io.daemonDeps))`. Preserve existing text output when `--json` is absent.

- [ ] **Step 5: Run focused tests**

Run: `bun test tests/status-json.test.ts tests/daemon-cli.test.ts tests/config.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -- src/status.ts src/cli.ts tests/status-json.test.ts
git diff --cached --name-only
git commit -m "feat: add app status json"
```

---

## Task 2: Add pause/resume commands

**Files:**
- Create: `tests/pause-resume.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing pause/resume tests**

Create `tests/pause-resume.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";
import { loadConfig } from "../src/config";
import { resolvePaths } from "../src/paths";

async function withTempHome<T>(fn: (home: string) => Promise<T> | T): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), "agent-voice-pause-test-"));
  try {
    return await fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("agent-voice pause/resume", () => {
  test("pause disables the system and resume enables it", async () => {
    await withTempHome(async (home) => {
      const env = { AGENT_VOICE_HOME: home };
      const paths = resolvePaths(env);

      const pause = await runCli(["pause"], { env });
      expect(pause.exitCode).toBe(0);
      expect(loadConfig(paths).enabled).toBe(false);

      const statusPaused = JSON.parse((await runCli(["status", "--json"], { env })).stdout);
      expect(statusPaused.ui.state).toBe("paused");

      const resume = await runCli(["resume"], { env });
      expect(resume.exitCode).toBe(0);
      expect(loadConfig(paths).enabled).toBe(true);
    });
  });

  test("timed pause is rejected until implemented", async () => {
    await withTempHome(async (home) => {
      const result = await runCli(["pause", "--for", "1h"], {
        env: { AGENT_VOICE_HOME: home },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Timed pause is not implemented");
    });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `bun test tests/pause-resume.test.ts`

Expected: FAIL because `pause` and `resume` are unknown.

- [ ] **Step 3: Implement minimal pause/resume in `src/cli.ts`**

Add help lines:

```text
  agent-voice pause
  agent-voice resume
```

Add command handling:

```ts
if (command === "pause") {
  if (args.includes("--for") || args.includes("--until")) {
    return result(2, "", "Timed pause is not implemented yet\n");
  }
  const config = loadConfig(paths);
  saveConfig(paths, { ...config, enabled: false });
  return result(0, "paused\n");
}

if (command === "resume") {
  const config = loadConfig(paths);
  saveConfig(paths, { ...config, enabled: true });
  return result(0, "resumed\n");
}
```

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/pause-resume.test.ts tests/status-json.test.ts tests/cli.test.ts`

Note: run `tests/cli.test.ts` as a regression check only. Do not stage it unless the test itself is intentionally modified.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- src/cli.ts tests/pause-resume.test.ts
git diff --cached --name-only
git commit -m "feat: add voice pause resume commands"
```

---

## Task 3: Add safe summarizer mode command

**Files:**
- Create: `src/summarizer-mode.ts`
- Create: `tests/summarizer-mode.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing summarizer mode tests**

Create `tests/summarizer-mode.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";
import { defaultConfig, loadConfig } from "../src/config";
import { resolvePaths } from "../src/paths";

async function withTempHome<T>(fn: (home: string) => Promise<T> | T): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), "agent-voice-summarizer-test-"));
  try {
    return await fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("agent-voice summarizer mode", () => {
  test("sets heuristic-only and restores default priority", async () => {
    await withTempHome(async (home) => {
      const env = { AGENT_VOICE_HOME: home };
      const paths = resolvePaths(env);

      const local = await runCli(["summarizer", "mode", "heuristic"], { env });
      expect(local.exitCode).toBe(0);
      expect(loadConfig(paths).summarizer.priority).toEqual(["heuristic"]);

      const normal = await runCli(["summarizer", "mode", "default"], { env });
      expect(normal.exitCode).toBe(0);
      expect(loadConfig(paths).summarizer.priority).toEqual(defaultConfig.summarizer.priority);
    });
  });

  test("rejects unknown summarizer mode", async () => {
    await withTempHome(async (home) => {
      const result = await runCli(["summarizer", "mode", "fastest"], {
        env: { AGENT_VOICE_HOME: home },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Unknown summarizer mode");
    });
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `bun test tests/summarizer-mode.test.ts`

Expected: FAIL because command is unknown.

- [ ] **Step 3: Implement `src/summarizer-mode.ts`**

Create focused helpers:

```ts
import type { AgentVoiceConfig } from "./config";
import { defaultConfig } from "./config";

export type SummarizerMode = "default" | "heuristic";

export function setSummarizerMode(
  config: AgentVoiceConfig,
  mode: SummarizerMode,
): AgentVoiceConfig {
  return {
    ...config,
    summarizer: {
      ...config.summarizer,
      priority:
        mode === "heuristic" ? ["heuristic"] : defaultConfig.summarizer.priority,
    },
  };
}

export function isSummarizerMode(value: string): value is SummarizerMode {
  return value === "default" || value === "heuristic";
}
```

- [ ] **Step 4: Wire CLI command**

Add help line:

```text
  agent-voice summarizer mode heuristic|default
```

Add `summarizer mode` handling in `src/cli.ts` using `loadConfig`, `setSummarizerMode`, and `saveConfig`.

- [ ] **Step 5: Run focused tests**

Run: `bun test tests/summarizer-mode.test.ts tests/config.test.ts tests/cli.test.ts`

Note: run `tests/cli.test.ts` as a regression check only. Do not stage it unless the test itself is intentionally modified.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -- src/summarizer-mode.ts src/cli.ts tests/summarizer-mode.test.ts
git diff --cached --name-only
git commit -m "feat: add summarizer mode command"
```

---

## Task 4: Add app-facing `doctor --json`

**Files:**
- Create: `src/doctor.ts`
- Create: `tests/doctor.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing doctor tests**

Create `tests/doctor.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";
import { loadConfig, saveConfig } from "../src/config";
import { resolvePaths } from "../src/paths";

async function withTempHome<T>(fn: (home: string) => Promise<T> | T): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), "agent-voice-doctor-test-"));
  try {
    return await fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("agent-voice doctor --json", () => {
  test("reports Kokoro script and daemon checks", async () => {
    await withTempHome(async (home) => {
      const paths = resolvePaths({ AGENT_VOICE_HOME: home });
      const fakeKokoro = join(home, "kokoro.py");
      writeFileSync(fakeKokoro, "print('ready')\n", "utf8");
      const config = loadConfig(paths);
      saveConfig(paths, { ...config, tts: { ...config.tts, kokoroScript: fakeKokoro } });

      const result = await runCli(["doctor", "--json"], {
        env: { AGENT_VOICE_HOME: home },
        daemonDeps: { isPidAlive: () => false },
      });

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as { checks: Array<{ id: string; ok: boolean }> };
      expect(parsed.checks.find((check) => check.id === "config.load")?.ok).toBe(true);
      expect(parsed.checks.find((check) => check.id === "tts.kokoroScript.exists")?.ok).toBe(true);
      expect(parsed.checks.find((check) => check.id === "daemon.running")?.ok).toBe(false);
    });
  });

  test("plain doctor is rejected until text output is designed", async () => {
    await withTempHome(async (home) => {
      const result = await runCli(["doctor"], { env: { AGENT_VOICE_HOME: home } });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("doctor currently requires --json");
    });
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `bun test tests/doctor.test.ts`

Expected: FAIL because `doctor` is unknown.

- [ ] **Step 3: Implement `src/doctor.ts`**

Create:

```ts
import { existsSync } from "node:fs";
import { loadConfig } from "./config";
import { getDaemonStatus, type DaemonCliDeps } from "./daemon";
import type { AgentVoicePaths } from "./paths";

export interface DoctorCheck {
  id: string;
  ok: boolean;
  severity: "info" | "warning" | "error";
  message: string;
  action?: string;
}

export interface DoctorReport {
  version: 1;
  checks: DoctorCheck[];
}

export function buildDoctorReport(
  paths: AgentVoicePaths,
  deps: DaemonCliDeps = {},
): DoctorReport {
  const checks: DoctorCheck[] = [];
  let config;
  try {
    config = loadConfig(paths);
    checks.push({ id: "config.load", ok: true, severity: "info", message: "Config loaded" });
  } catch (error) {
    checks.push({
      id: "config.load",
      ok: false,
      severity: "error",
      message: error instanceof Error ? error.message : String(error),
      action: "Open setup and repair config.json",
    });
  }

  if (config) {
    const exists = existsSync(config.tts.kokoroScript);
    checks.push({
      id: "tts.kokoroScript.exists",
      ok: exists,
      severity: exists ? "info" : "error",
      message: exists ? "Kokoro script exists" : `Kokoro script not found: ${config.tts.kokoroScript}`,
      ...(exists ? {} : { action: "Choose the Kokoro Python service script" }),
    });
  }

  const daemon = getDaemonStatus(paths, deps);
  checks.push({
    id: "daemon.running",
    ok: daemon.running,
    severity: daemon.running ? "info" : "warning",
    message: daemon.running ? `Daemon running pid=${daemon.pid}` : "Daemon is not running",
    ...(daemon.running ? {} : { action: "Start daemon" }),
  });

  checks.push({
    id: "queue.failed.empty",
    ok: daemon.queues.failed === 0,
    severity: daemon.queues.failed === 0 ? "info" : "warning",
    message: `${daemon.queues.failed} failed jobs`,
    ...(daemon.queues.failed === 0 ? {} : { action: "Open dashboard failed jobs" }),
  });

  return { version: 1, checks };
}
```

- [ ] **Step 4: Wire `doctor --json`**

Add help line:

```text
  agent-voice doctor --json
```

In `src/cli.ts`, reject `doctor` without `--json`; with `--json`, return `JSON.stringify(buildDoctorReport(paths, io.daemonDeps), null, 2) + "\n"`.

- [ ] **Step 5: Run focused tests**

Run: `bun test tests/doctor.test.ts tests/cli.test.ts tests/status-json.test.ts`

Note: run `tests/cli.test.ts` as a regression check only. Do not stage it unless the test itself is intentionally modified.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -- src/doctor.ts src/cli.ts tests/doctor.test.ts
git diff --cached --name-only
git commit -m "feat: add voice doctor report"
```

---

## Task 5: Scaffold Swift package and testable core models

**Files:**
- Create: `macos/AgentVoiceApp/Package.swift`
- Create: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceStatus.swift`
- Create: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceConfig.swift`
- Create: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceState.swift`
- Create: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceStatusTests.swift`

- [ ] **Step 1: Write failing Swift model tests**

Create `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceStatusTests.swift`:

```swift
import XCTest
@testable import AgentVoiceCore

final class AgentVoiceStatusTests: XCTestCase {
    func testDecodesStatusSnapshotAndDerivesReadyState() throws {
        let data = Data("""
        {
          "version": 1,
          "daemon": { "state": "running", "running": true, "pid": 123 },
          "queues": { "pending": 0, "processing": 0, "done": 2, "failed": 0, "skipped": 0 },
          "config": {
            "enabled": true,
            "agents": {
              "claude": { "enabled": true, "mode": "native" },
              "codex": { "enabled": true, "mode": "wrapper-required-native-optional" },
              "pi": { "enabled": true, "mode": "native" },
              "opencode": { "enabled": false, "mode": "wrapper-required-native-optional" }
            }
          },
          "paths": { "home": "/tmp/agent-voice", "config": "/tmp/agent-voice/config.json", "db": "/tmp/agent-voice/queue.db" },
          "ui": { "state": "ready", "attention": [] }
        }
        """.utf8)

        let snapshot = try JSONDecoder().decode(AgentVoiceStatusSnapshot.self, from: data)

        XCTAssertEqual(snapshot.version, 1)
        XCTAssertEqual(snapshot.daemon.state, .running)
        XCTAssertEqual(snapshot.ui.state, .ready)
        XCTAssertEqual(snapshot.queues.done, 2)
        XCTAssertEqual(snapshot.config.agents["opencode"]?.enabled, false)
    }

    func testDisplayStateLabels() {
        XCTAssertEqual(AgentVoiceUIState.ready.displayName, "Ready")
        XCTAssertEqual(AgentVoiceUIState.daemonStopped.displayName, "Daemon Stopped")
    }
}
```

- [ ] **Step 2: Run failing Swift test**

Run: `swift test --package-path macos/AgentVoiceApp`

Expected: FAIL because package does not exist.

- [ ] **Step 3: Add `Package.swift`**

Create `macos/AgentVoiceApp/Package.swift`:

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AgentVoiceApp",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "AgentVoiceCore", targets: ["AgentVoiceCore"]),
        .executable(name: "AgentVoiceApp", targets: ["AgentVoiceApp"])
    ],
    targets: [
        .target(name: "AgentVoiceCore"),
        .executableTarget(name: "AgentVoiceApp", dependencies: ["AgentVoiceCore"]),
        .testTarget(name: "AgentVoiceCoreTests", dependencies: ["AgentVoiceCore"])
    ]
)
```

- [ ] **Step 4: Add core models**

Create `AgentVoiceState.swift`, `AgentVoiceStatus.swift`, and `AgentVoiceConfig.swift` with `Codable`, `Equatable`, and display helpers. Keep JSON enum raw values aligned with TypeScript `status --json`:

```swift
public enum AgentVoiceUIState: String, Codable, Equatable, Sendable {
    case ready
    case processing
    case paused
    case needsAttention = "needs_attention"
    case daemonStopped = "daemon_stopped"

    public var displayName: String {
        switch self {
        case .ready: return "Ready"
        case .processing: return "Processing"
        case .paused: return "Paused"
        case .needsAttention: return "Needs Attention"
        case .daemonStopped: return "Daemon Stopped"
        }
    }
}
```

Use structs with `Codable`, `Equatable`, `Sendable`, and explicit public initializers:

```swift
public struct AgentVoiceStatusSnapshot: Codable, Equatable, Sendable {
    public let version: Int
    public let daemon: DaemonStatus
    public let queues: QueueCounts
    public let config: ConfigSummary
    public let paths: PathSummary
    public let ui: UIStatus

    public init(version: Int, daemon: DaemonStatus, queues: QueueCounts, config: ConfigSummary, paths: PathSummary, ui: UIStatus) {
        self.version = version
        self.daemon = daemon
        self.queues = queues
        self.config = config
        self.paths = paths
        self.ui = ui
    }
}

public struct DaemonStatus: Codable, Equatable, Sendable {
    public let state: DaemonRunState
    public let running: Bool
    public let pid: Int?

    public init(state: DaemonRunState, running: Bool, pid: Int?) {
        self.state = state
        self.running = running
        self.pid = pid
    }
}

public enum DaemonRunState: String, Codable, Equatable, Sendable {
    case running, stale, stopped
}

public struct QueueCounts: Codable, Equatable, Sendable {
    public let pending: Int
    public let processing: Int
    public let done: Int
    public let failed: Int
    public let skipped: Int

    public init(pending: Int, processing: Int, done: Int, failed: Int, skipped: Int) {
        self.pending = pending
        self.processing = processing
        self.done = done
        self.failed = failed
        self.skipped = skipped
    }
}

public struct ConfigSummary: Codable, Equatable, Sendable {
    public let enabled: Bool
    public let agents: [String: AgentSummary]

    public init(enabled: Bool, agents: [String: AgentSummary]) {
        self.enabled = enabled
        self.agents = agents
    }
}

public struct AgentSummary: Codable, Equatable, Sendable {
    public let enabled: Bool
    public let mode: String

    public init(enabled: Bool, mode: String) {
        self.enabled = enabled
        self.mode = mode
    }
}

public struct PathSummary: Codable, Equatable, Sendable {
    public let home: String
    public let config: String
    public let db: String

    public init(home: String, config: String, db: String) {
        self.home = home
        self.config = config
        self.db = db
    }
}

public struct UIStatus: Codable, Equatable, Sendable {
    public let state: AgentVoiceUIState
    public let attention: [String]

    public init(state: AgentVoiceUIState, attention: [String]) {
        self.state = state
        self.attention = attention
    }
}
```

All Swift core model structs used by later tests must include public memberwise-style initializers because Swift does not synthesize public memberwise initializers across module boundaries. Add explicit `public init(...)` methods for `AgentVoiceStatusSnapshot`, `DaemonStatus`, `QueueCounts`, `ConfigSummary`, `AgentSummary`, `PathSummary`, and `UIStatus`.

- [ ] **Step 5: Add placeholder app target**

Create `macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift` with a minimal SwiftUI `@main` app that opens a simple window. Menu bar comes later.

```swift
import SwiftUI

@main
struct AgentVoiceApplication: App {
    var body: some Scene {
        WindowGroup("Agent Voice") {
            Text("Agent Voice")
                .padding()
        }
    }
}
```

Do not declare SwiftPM processed resources yet. Task 12 copies `Info.plist` and `AppIcon.icns` into the development `.app` bundle explicitly, so Task 5 must not require an empty `Resources/` directory to exist in Git.

- [ ] **Step 6: Run Swift tests and build**

Run:

```bash
swift test --package-path macos/AgentVoiceApp
swift build --package-path macos/AgentVoiceApp
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add -- macos/AgentVoiceApp/Package.swift macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceStatus.swift macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceConfig.swift macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceState.swift macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceStatusTests.swift
git diff --cached --name-only
git commit -m "feat: scaffold agent voice mac app"
```

---

## Task 6: Add Swift CLI bridge, executable discovery, and doctor models

**Files:**
- Create: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift`
- Create: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppSettings.swift`
- Create: `macos/AgentVoiceApp/Sources/AgentVoiceCore/DoctorReport.swift`
- Create: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceCLITests.swift`

- [ ] **Step 1: Write failing CLI bridge tests with a complete fake runner**

Create `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceCLITests.swift`:

```swift
import XCTest
@testable import AgentVoiceCore

actor RecordingRunner: ProcessRunning {
    private(set) var requests: [ProcessRequest] = []
    var results: [ProcessResult]

    init(stdout: String = "{}", stderr: String = "", exitCode: Int32 = 0) {
        self.results = [ProcessResult(exitCode: exitCode, stdout: stdout, stderr: stderr)]
    }

    init(results: [ProcessResult]) {
        self.results = results
    }

    func run(_ request: ProcessRequest) async throws -> ProcessResult {
        requests.append(request)
        if results.isEmpty {
            return ProcessResult(exitCode: 0, stdout: "{}", stderr: "")
        }
        return results.removeFirst()
    }

    func capturedRequests() -> [ProcessRequest] {
        requests
    }
}

final class AgentVoiceCLITests: XCTestCase {
    let statusJSON = """
    {"version":1,"daemon":{"state":"stopped","running":false,"pid":null},"queues":{"pending":0,"processing":0,"done":0,"failed":0,"skipped":0},"config":{"enabled":true,"agents":{}},"paths":{"home":"/tmp/av","config":"/tmp/av/config.json","db":"/tmp/av/queue.db"},"ui":{"state":"daemon_stopped","attention":[]}}
    """

    func testBuildsStatusJsonCommand() async throws {
        let runner = RecordingRunner(stdout: statusJSON)
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        _ = try await cli.status()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["status", "--json"])
    }

    func testAddsAgentVoiceHomeToEnvironment() async throws {
        let runner = RecordingRunner(stdout: statusJSON)
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            agentVoiceHome: URL(fileURLWithPath: "/tmp/custom-agent-voice"),
            runner: runner
        )

        _ = try await cli.status()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.environment["AGENT_VOICE_HOME"], "/tmp/custom-agent-voice")
    }

    func testPauseAndResumeCommands() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "paused\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: "resumed\n", stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        try await cli.pause()
        try await cli.resume()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [["pause"], ["resume"]])
    }

    func testNonZeroExitThrowsUsefulError() async throws {
        let runner = RecordingRunner(stdout: "", stderr: "boom\n", exitCode: 2)
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        do {
            _ = try await cli.status()
            XCTFail("Expected status to throw")
        } catch let error as AgentVoiceCLIError {
            XCTAssertEqual(error.exitCode, 2)
            XCTAssertTrue(error.stderr.contains("boom"))
        }
    }

    func testSummarizerModeCommand() async throws {
        let runner = RecordingRunner(stdout: "ok\n")
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        try await cli.setSummarizerMode("heuristic")

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["summarizer", "mode", "heuristic"])
    }

    func testDefaultExecutablePrefersEnvironmentOverride() throws {
        let settings = AppSettings.defaultSettings(env: ["AGENT_VOICE_EXECUTABLE": "/tmp/agent-voice"])
        XCTAssertEqual(settings.executableURL.path, "/tmp/agent-voice")
    }

    func testDefaultExecutablePrefersBundledCliWhenPresent() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let cli = root.appendingPathComponent("agent-voice/bin/agent-voice")
        try FileManager.default.createDirectory(at: cli.deletingLastPathComponent(), withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: cli.path, contents: Data())
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: cli.path)

        let settings = AppSettings.defaultSettings(env: [:], bundleResourceURL: root, currentDirectory: URL(fileURLWithPath: "/tmp/not-repo"))

        XCTAssertEqual(settings.executableURL.path, cli.path)
    }
}

```

- [ ] **Step 2: Run failing Swift test**

Run: `swift test --package-path macos/AgentVoiceApp --filter AgentVoiceCLITests`

Expected: FAIL because `AgentVoiceCLI`, `AppSettings`, `DoctorReport`, and `RecordingRunner` dependencies do not exist.

- [ ] **Step 3: Implement `DoctorReport.swift`**

Create `macos/AgentVoiceApp/Sources/AgentVoiceCore/DoctorReport.swift`:

```swift
public struct DoctorReport: Codable, Equatable, Sendable {
    public let version: Int
    public let checks: [DoctorCheck]

    public init(version: Int, checks: [DoctorCheck]) {
        self.version = version
        self.checks = checks
    }
}

public struct DoctorCheck: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let ok: Bool
    public let severity: Severity
    public let message: String
    public let action: String?

    public init(id: String, ok: Bool, severity: Severity, message: String, action: String?) {
        self.id = id
        self.ok = ok
        self.severity = severity
        self.message = message
        self.action = action
    }

    public enum Severity: String, Codable, Equatable, Sendable {
        case info
        case warning
        case error
    }
}
```

- [ ] **Step 4: Implement `AgentVoiceCLI.swift` with explicit commands and errors**

Create `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift` with:

```swift
import Foundation

public struct ProcessRequest: Equatable, Sendable {
    public let executableURL: URL
    public let arguments: [String]
    public let environment: [String: String]

    public init(executableURL: URL, arguments: [String], environment: [String: String]) {
        self.executableURL = executableURL
        self.arguments = arguments
        self.environment = environment
    }
}

public struct ProcessResult: Equatable, Sendable {
    public let exitCode: Int32
    public let stdout: String
    public let stderr: String

    public init(exitCode: Int32, stdout: String, stderr: String) {
        self.exitCode = exitCode
        self.stdout = stdout
        self.stderr = stderr
    }
}

public protocol ProcessRunning: Sendable {
    func run(_ request: ProcessRequest) async throws -> ProcessResult
}

public struct AgentVoiceCLIError: Error, Equatable {
    public let exitCode: Int32
    public let stderr: String

    public init(exitCode: Int32, stderr: String) {
        self.exitCode = exitCode
        self.stderr = stderr
    }
}

public struct AgentVoiceCLI: Sendable {
    public let executableURL: URL
    public let agentVoiceHome: URL?
    public let runner: any ProcessRunning

    public init(executableURL: URL, agentVoiceHome: URL? = nil, runner: any ProcessRunning = FoundationProcessRunner()) {
        self.executableURL = executableURL
        self.agentVoiceHome = agentVoiceHome
        self.runner = runner
    }

    public func status() async throws -> AgentVoiceStatusSnapshot {
        let result = try await run(["status", "--json"])
        return try JSONDecoder().decode(AgentVoiceStatusSnapshot.self, from: Data(result.stdout.utf8))
    }

    public func doctor() async throws -> DoctorReport {
        let result = try await run(["doctor", "--json"])
        return try JSONDecoder().decode(DoctorReport.self, from: Data(result.stdout.utf8))
    }

    public func pause() async throws { _ = try await run(["pause"]) }
    public func resume() async throws { _ = try await run(["resume"]) }
    public func startDaemon() async throws { _ = try await run(["start"]) }
    public func stopDaemon() async throws { _ = try await run(["stop"]) }
    public func runVoiceTest(_ text: String) async throws { _ = try await run(["test", text]) }
    public func setSummarizerMode(_ mode: String) async throws { _ = try await run(["summarizer", "mode", mode]) }

    @discardableResult
    public func run(_ arguments: [String]) async throws -> ProcessResult {
        var environment = ProcessInfo.processInfo.environment
        if let agentVoiceHome {
            environment["AGENT_VOICE_HOME"] = agentVoiceHome.path
        }
        let result = try await runner.run(ProcessRequest(executableURL: executableURL, arguments: arguments, environment: environment))
        guard result.exitCode == 0 else {
            throw AgentVoiceCLIError(exitCode: result.exitCode, stderr: result.stderr)
        }
        return result
    }
}

public struct FoundationProcessRunner: ProcessRunning {
    public init() {}

    public func run(_ request: ProcessRequest) async throws -> ProcessResult {
        try await Task.detached {
            let process = Process()
            process.executableURL = request.executableURL
            process.arguments = request.arguments
            process.environment = request.environment

            let stdout = Pipe()
            let stderr = Pipe()
            process.standardOutput = stdout
            process.standardError = stderr

            try process.run()
            process.waitUntilExit()

            let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()
            let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()
            return ProcessResult(
                exitCode: process.terminationStatus,
                stdout: String(data: stdoutData, encoding: .utf8) ?? "",
                stderr: String(data: stderrData, encoding: .utf8) ?? ""
            )
        }.value
    }
}
```

- [ ] **Step 5: Implement `AppSettings.swift` with deterministic executable discovery**

Create `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppSettings.swift`:

```swift
import Foundation

public struct AppSettings: Equatable, Sendable {
    public var executableURL: URL
    public var agentVoiceHome: URL?

    public init(executableURL: URL, agentVoiceHome: URL? = nil) {
        self.executableURL = executableURL
        self.agentVoiceHome = agentVoiceHome
    }

    public static func defaultSettings(
        env: [String: String] = ProcessInfo.processInfo.environment,
        bundleResourceURL: URL? = Bundle.main.resourceURL,
        currentDirectory: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    ) -> AppSettings {
        let home = env["AGENT_VOICE_HOME"].map { URL(fileURLWithPath: $0) }
        if let override = env["AGENT_VOICE_EXECUTABLE"], !override.isEmpty {
            return AppSettings(executableURL: URL(fileURLWithPath: override), agentVoiceHome: home)
        }
        if let bundled = bundleResourceURL?.appendingPathComponent("agent-voice/bin/agent-voice"), FileManager.default.isExecutableFile(atPath: bundled.path) {
            return AppSettings(executableURL: bundled, agentVoiceHome: home)
        }
        return AppSettings(executableURL: currentDirectory.appendingPathComponent("bin/agent-voice"), agentVoiceHome: home)
    }
}
```

Executable discovery is deterministic: environment override first, bundled CLI second, repo-local development fallback third. Task 12 must bundle the CLI under `Contents/Resources/agent-voice/bin/agent-voice` so packaged app launches do not depend on `$PWD`.

- [ ] **Step 6: Run focused Swift tests**

Run: `swift test --package-path macos/AgentVoiceApp --filter AgentVoiceCLITests`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -- macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift macos/AgentVoiceApp/Sources/AgentVoiceCore/AppSettings.swift macos/AgentVoiceApp/Sources/AgentVoiceCore/DoctorReport.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceCLITests.swift
git diff --cached --name-only
git commit -m "feat: add mac app cli bridge"
```

---

## Task 7: Add Swift setup assistant model

**Files:**
- Create: `macos/AgentVoiceApp/Sources/AgentVoiceCore/SetupAssistantModel.swift`
- Create: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/SetupAssistantModelTests.swift`

- [ ] **Step 1: Write failing setup model tests**

Create `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/SetupAssistantModelTests.swift`:

```swift
import XCTest
@testable import AgentVoiceCore

final class SetupAssistantModelTests: XCTestCase {
    func testInitialStepsAreStable() {
        XCTAssertEqual(SetupStep.allCases.map(\.title), [
            "Welcome",
            "Kokoro",
            "Summaries",
            "Agents",
            "Daemon",
            "Finish"
        ])
    }

    func testDoctorFailuresMapToRepairChecks() {
        let report = DoctorReport(version: 1, checks: [
            DoctorCheck(id: "tts.kokoroScript.exists", ok: false, severity: .error, message: "missing", action: "Choose script"),
            DoctorCheck(id: "daemon.running", ok: false, severity: .warning, message: "stopped", action: "Start daemon")
        ])

        let checks = SetupAssistantModel.checks(from: report, status: nil)

        XCTAssertEqual(checks.map(\.targetStep), [.kokoro, .daemon])
        XCTAssertEqual(checks.first?.action, "Choose script")
    }

    func testPausedStatusMapsToSummaryRepairCheck() {
        let status = AgentVoiceStatusSnapshot(
            version: 1,
            daemon: DaemonStatus(state: .running, running: true, pid: 123),
            queues: QueueCounts(pending: 0, processing: 0, done: 0, failed: 0, skipped: 0),
            config: ConfigSummary(enabled: false, agents: [:]),
            paths: PathSummary(home: "/tmp/av", config: "/tmp/av/config.json", db: "/tmp/av/queue.db"),
            ui: UIStatus(state: .paused, attention: ["system_paused"])
        )

        let checks = SetupAssistantModel.checks(from: nil, status: status)

        XCTAssertTrue(checks.contains { $0.id == "system.paused" && $0.targetStep == .summaries })
    }

    func testAgentActionsAreExplicitCommands() {
        XCTAssertEqual(SetupAssistantModel.command(for: .enableAgent("claude")), ["enable", "claude"])
        XCTAssertEqual(SetupAssistantModel.command(for: .disableAgent("opencode")), ["disable", "opencode"])
        XCTAssertEqual(SetupAssistantModel.command(for: .summarizerMode("heuristic")), ["summarizer", "mode", "heuristic"])
    }
}
```

- [ ] **Step 2: Run failing test**

Run: `swift test --package-path macos/AgentVoiceApp --filter SetupAssistantModelTests`

Expected: FAIL because `SetupAssistantModel` does not exist.

- [ ] **Step 3: Implement `SetupAssistantModel.swift`**

Create:

```swift
public enum SetupStep: String, CaseIterable, Identifiable, Equatable {
    case welcome, kokoro, summaries, agents, daemon, finish
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .welcome: return "Welcome"
        case .kokoro: return "Kokoro"
        case .summaries: return "Summaries"
        case .agents: return "Agents"
        case .daemon: return "Daemon"
        case .finish: return "Finish"
        }
    }
}

public struct SetupCheck: Identifiable, Equatable {
    public let id: String
    public let ok: Bool
    public let title: String
    public let detail: String
    public let targetStep: SetupStep
    public let action: String?
}

public enum SetupAction: Equatable {
    case enableAgent(String)
    case disableAgent(String)
    case summarizerMode(String)
}

public enum SetupAssistantModel {
    public static func checks(from report: DoctorReport?, status: AgentVoiceStatusSnapshot?) -> [SetupCheck] {
        var checks: [SetupCheck] = []
        if let report {
            checks.append(contentsOf: report.checks.compactMap(check(from:)))
        }
        if let status, status.ui.attention.contains("system_paused") {
            checks.append(SetupCheck(
                id: "system.paused",
                ok: false,
                title: "Speech is paused",
                detail: "Agent Voice is disabled in config.",
                targetStep: .summaries,
                action: "Resume speech"
            ))
        }
        return checks
    }

    private static func check(from doctorCheck: DoctorCheck) -> SetupCheck? {
        let target: SetupStep
        switch doctorCheck.id {
        case "tts.kokoroScript.exists": target = .kokoro
        case "daemon.running": target = .daemon
        case "queue.failed.empty": target = .finish
        default: return nil
        }
        return SetupCheck(
            id: doctorCheck.id,
            ok: doctorCheck.ok,
            title: doctorCheck.message,
            detail: doctorCheck.message,
            targetStep: target,
            action: doctorCheck.action
        )
    }

    public static func command(for action: SetupAction) -> [String] {
        switch action {
        case .enableAgent(let agent): return ["enable", agent]
        case .disableAgent(let agent): return ["disable", agent]
        case .summarizerMode(let mode): return ["summarizer", "mode", mode]
        }
    }
}
```

Keep this module UI-independent. It translates status/doctor reports into checks, steps, and command intents only.

- [ ] **Step 4: Run focused tests**

Run: `swift test --package-path macos/AgentVoiceApp --filter SetupAssistantModelTests`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- macos/AgentVoiceApp/Sources/AgentVoiceCore/SetupAssistantModel.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/SetupAssistantModelTests.swift
git diff --cached --name-only
git commit -m "feat: add mac setup assistant model"
```

---

## Task 8: Add app-facing history JSON and Swift history models

**Files:**
- Create: `src/history.ts`
- Create: `tests/history-json.test.ts`
- Modify: `src/cli.ts`
- Create: `macos/AgentVoiceApp/Sources/AgentVoiceCore/HistoryModels.swift`
- Create: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/HistoryModelsTests.swift`
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift`

- [ ] **Step 1: Write failing TypeScript history tests**

Create `tests/history-json.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";
import { openDb } from "../src/db";
import { createEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import { enqueue } from "../src/store";

async function withTempHome<T>(fn: (home: string) => Promise<T> | T): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), "agent-voice-history-test-"));
  try {
    return await fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("agent-voice history --json", () => {
  test("returns recent terminal jobs from queue.db", async () => {
    await withTempHome(async (home) => {
      const paths = resolvePaths({ AGENT_VOICE_HOME: home });
      const done = createEvent({ agent: "claude", text: "Done raw text." });
      const failed = createEvent({ agent: "codex", text: "Failed raw text." });
      const db = openDb(paths.db);
      enqueue(db, { ...done, createdAt: "2026-06-15T00:00:01.000Z" });
      enqueue(db, { ...failed, createdAt: "2026-06-15T00:00:02.000Z" });
      db.query("UPDATE jobs SET status='done', summary=?, summarizer_used=?, finished_at=? WHERE id=?")
        .run("Claude finished.", "heuristic", "2026-06-15T00:01:00.000Z", done.id);
      db.query("UPDATE jobs SET status='failed', last_error=?, finished_at=? WHERE id=?")
        .run("boom", "2026-06-15T00:02:00.000Z", failed.id);
      db.close();

      const result = await runCli(["history", "--json", "--limit", "10"], { env: { AGENT_VOICE_HOME: home } });

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as { version: 1; jobs: Array<Record<string, unknown>> };
      expect(parsed.version).toBe(1);
      expect(parsed.jobs.map((job) => job.id)).toEqual([failed.id, done.id]);
      expect(parsed.jobs[0]).toMatchObject({ status: "failed", lastError: "boom", text: "Failed raw text." });
      expect(parsed.jobs[1]).toMatchObject({ status: "done", summary: "Claude finished.", summarizerUsed: "heuristic" });
    });
  });

  test("rejects plain history until text output is designed", async () => {
    await withTempHome(async (home) => {
      const result = await runCli(["history"], { env: { AGENT_VOICE_HOME: home } });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("history currently requires --json");
    });
  });
});
```

- [ ] **Step 2: Run failing TypeScript test**

Run: `bun test tests/history-json.test.ts`

Expected: FAIL because `history --json` is unknown.

- [ ] **Step 3: Implement `src/history.ts` against SQLite queue storage**

Create `src/history.ts`:

```ts
import { openDb } from "./db";
import type { AgentVoicePaths } from "./paths";
import type { JobStatus } from "./store";

export interface AppHistoryJob {
  id: string;
  agent: string;
  status: Extract<JobStatus, "done" | "failed" | "skipped">;
  text: string;
  cwd?: string;
  createdAt: string;
  finishedAt?: string;
  summary?: string;
  summarizerUsed?: string;
  skipReason?: string;
  lastError?: string;
  attempts: number;
}

export interface AppHistorySnapshot {
  version: 1;
  jobs: AppHistoryJob[];
}

interface HistoryRow {
  id: string;
  agent: string;
  status: "done" | "failed" | "skipped";
  text: string;
  cwd: string | null;
  created_at: string;
  finished_at: string | null;
  summary: string | null;
  summarizer_used: string | null;
  skip_reason: string | null;
  last_error: string | null;
  attempts: number;
}

export function buildHistorySnapshot(paths: AgentVoicePaths, limit = 50): AppHistorySnapshot {
  const db = openDb(paths.db);
  try {
    const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit || 50)));
    const rows = db.query(
      `SELECT id, agent, status, text, cwd, created_at, finished_at, summary, summarizer_used, skip_reason, last_error, attempts
       FROM jobs
       WHERE status IN ('done', 'failed', 'skipped')
       ORDER BY COALESCE(finished_at, created_at) DESC, created_at DESC
       LIMIT $limit`,
    ).all({ $limit: boundedLimit }) as HistoryRow[];
    return { version: 1, jobs: rows.map(rowToHistoryJob) };
  } finally {
    db.close();
  }
}

function rowToHistoryJob(row: HistoryRow): AppHistoryJob {
  return {
    id: row.id,
    agent: row.agent,
    status: row.status,
    text: row.text,
    ...(row.cwd ? { cwd: row.cwd } : {}),
    createdAt: row.created_at,
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.summarizer_used ? { summarizerUsed: row.summarizer_used } : {}),
    ...(row.skip_reason ? { skipReason: row.skip_reason } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    attempts: row.attempts,
  };
}

export function formatHistoryJson(snapshot: AppHistorySnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
```

- [ ] **Step 4: Wire `history --json` in `src/cli.ts`**

Add help line:

```text
  agent-voice history --json [--limit 50]
```

Add command handling:

```ts
if (command === "history") {
  if (!args.includes("--json")) {
    return result(2, "", "history currently requires --json\n");
  }
  const rawLimit = getOption(args, "--limit");
  const limit = rawLimit ? Number(rawLimit) : 50;
  return result(0, formatHistoryJson(buildHistorySnapshot(paths, limit)));
}
```

Import `buildHistorySnapshot` and `formatHistoryJson` from `./history`.

- [ ] **Step 5: Run focused TypeScript tests**

Run: `bun test tests/history-json.test.ts tests/status-json.test.ts tests/daemon-cli.test.ts`

Expected: PASS.

- [ ] **Step 6: Write failing Swift history model tests**

Create `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/HistoryModelsTests.swift`:

```swift
import XCTest
@testable import AgentVoiceCore

final class HistoryModelsTests: XCTestCase {
    func testDecodesHistorySnapshot() throws {
        let data = Data("""
        {
          "version": 1,
          "jobs": [
            { "id": "failed-1", "agent": "codex", "status": "failed", "text": "raw", "createdAt": "2026-06-15T00:00:00.000Z", "finishedAt": "2026-06-15T00:01:00.000Z", "lastError": "boom", "attempts": 3 },
            { "id": "done-1", "agent": "pi", "status": "done", "text": "raw", "createdAt": "2026-06-15T00:00:00.000Z", "summary": "Pi finished tests.", "summarizerUsed": "heuristic", "attempts": 1 }
          ]
        }
        """.utf8)

        let snapshot = try JSONDecoder().decode(AgentVoiceHistorySnapshot.self, from: data)

        XCTAssertEqual(snapshot.version, 1)
        XCTAssertEqual(snapshot.jobs.count, 2)
        XCTAssertEqual(snapshot.jobs[0].status, .failed)
        XCTAssertEqual(snapshot.jobs[0].lastError, "boom")
        XCTAssertEqual(snapshot.jobs[1].summary, "Pi finished tests.")
    }
}
```

- [ ] **Step 7: Run failing Swift test**

Run: `swift test --package-path macos/AgentVoiceApp --filter HistoryModelsTests`

Expected: FAIL because `AgentVoiceHistorySnapshot` does not exist.

- [ ] **Step 8: Implement Swift history models and CLI method**

Create `macos/AgentVoiceApp/Sources/AgentVoiceCore/HistoryModels.swift`:

```swift
public struct AgentVoiceHistorySnapshot: Codable, Equatable, Sendable {
    public let version: Int
    public let jobs: [AgentVoiceHistoryJob]

    public init(version: Int, jobs: [AgentVoiceHistoryJob]) {
        self.version = version
        self.jobs = jobs
    }
}

public struct AgentVoiceHistoryJob: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let agent: String
    public let status: HistoryJobStatus
    public let text: String
    public let cwd: String?
    public let createdAt: String
    public let finishedAt: String?
    public let summary: String?
    public let summarizerUsed: String?
    public let skipReason: String?
    public let lastError: String?
    public let attempts: Int

    public init(id: String, agent: String, status: HistoryJobStatus, text: String, cwd: String?, createdAt: String, finishedAt: String?, summary: String?, summarizerUsed: String?, skipReason: String?, lastError: String?, attempts: Int) {
        self.id = id
        self.agent = agent
        self.status = status
        self.text = text
        self.cwd = cwd
        self.createdAt = createdAt
        self.finishedAt = finishedAt
        self.summary = summary
        self.summarizerUsed = summarizerUsed
        self.skipReason = skipReason
        self.lastError = lastError
        self.attempts = attempts
    }
}

public enum HistoryJobStatus: String, Codable, Equatable, Sendable {
    case done
    case failed
    case skipped
}
```

Modify `AgentVoiceCLI.swift` to add:

```swift
public func history(limit: Int = 50) async throws -> AgentVoiceHistorySnapshot {
    let result = try await run(["history", "--json", "--limit", String(limit)])
    return try JSONDecoder().decode(AgentVoiceHistorySnapshot.self, from: Data(result.stdout.utf8))
}
```

- [ ] **Step 9: Run focused Swift tests**

Run: `swift test --package-path macos/AgentVoiceApp --filter HistoryModelsTests`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -- src/history.ts src/cli.ts tests/history-json.test.ts macos/AgentVoiceApp/Sources/AgentVoiceCore/HistoryModels.swift macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/HistoryModelsTests.swift
git diff --cached --name-only
git commit -m "feat: add app history json"
```

---

## Task 9: Build tested app model and menu bar sentinel shell

**Files:**
- Create: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift`
- Create: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`
- Create: `macos/AgentVoiceApp/Sources/AgentVoiceApp/MenuBarSentinelView.swift`
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift`

- [ ] **Step 1: Write failing app model tests**

Create `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`. Reuse the `RecordingRunner` test fake from `AgentVoiceCLITests.swift`:

```swift
import XCTest
@testable import AgentVoiceCore

@MainActor
final class AppModelTests: XCTestCase {
    func testRefreshLoadsStatusAndHistory() async throws {
        let statusJSON = """
        {"version":1,"daemon":{"state":"running","running":true,"pid":123},"queues":{"pending":0,"processing":0,"done":1,"failed":0,"skipped":0},"config":{"enabled":true,"agents":{}},"paths":{"home":"/tmp/av","config":"/tmp/av/config.json","db":"/tmp/av/queue.db"},"ui":{"state":"ready","attention":[]}}
        """
        let historyJSON = """
        {"version":1,"jobs":[{"id":"done-1","agent":"claude","status":"done","text":"raw","createdAt":"2026-06-15T00:00:00.000Z","summary":"Claude finished.","attempts":1}]}
        """
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: historyJSON, stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()

        XCTAssertEqual(model.status?.ui.state, .ready)
        XCTAssertEqual(model.history?.jobs.first?.summary, "Claude finished.")
        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [["status", "--json"], ["history", "--json", "--limit", "50"]])
    }

    func testPauseDelegatesToCLIAndRecordsErrors() async throws {
        let runner = RecordingRunner(stdout: "paused\n")
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.pause()

        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["pause"])
    }
}
```

- [ ] **Step 2: Run failing app model tests**

Run: `swift test --package-path macos/AgentVoiceApp --filter AppModelTests`

Expected: FAIL because `AppModel` does not exist.

- [ ] **Step 3: Implement testable `AppModel` in `AgentVoiceCore`**

Create `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift`:

```swift
import Combine
import Foundation

@MainActor
public final class AppModel: ObservableObject {
    @Published public private(set) var status: AgentVoiceStatusSnapshot?
    @Published public private(set) var history: AgentVoiceHistorySnapshot?
    @Published public private(set) var lastError: String?

    public let cli: AgentVoiceCLI

    public init(cli: AgentVoiceCLI? = nil) {
        if let cli {
            self.cli = cli
        } else {
            let settings = AppSettings.defaultSettings()
            self.cli = AgentVoiceCLI(executableURL: settings.executableURL, agentVoiceHome: settings.agentVoiceHome)
        }
    }

    public func refresh() async {
        do {
            status = try await cli.status()
            history = try await cli.history(limit: 50)
            lastError = nil
        } catch {
            lastError = String(describing: error)
        }
    }

    public func pause() async { await perform { try await cli.pause() } }
    public func resume() async { await perform { try await cli.resume() } }
    public func startDaemon() async { await perform { try await cli.startDaemon() } }
    public func stopDaemon() async { await perform { try await cli.stopDaemon() } }
    public func testVoice() async { await perform { try await cli.runVoiceTest("Agent Voice test.") } }
    public func setSummarizerMode(_ mode: String) async { await perform { try await cli.setSummarizerMode(mode) } }

    private func perform(_ operation: () async throws -> Void) async {
        do {
            try await operation()
            lastError = nil
        } catch {
            lastError = String(describing: error)
        }
    }
}
```

- [ ] **Step 4: Run focused app model tests**

Run: `swift test --package-path macos/AgentVoiceApp --filter AppModelTests`

Expected: PASS.

- [ ] **Step 5: Add menu bar view**

Create `MenuBarSentinelView.swift`:

- Import `AgentVoiceCore` and `SwiftUI`.
- Accept `@ObservedObject var model: AppModel`.
- Show UI state label from `model.status?.ui.state.displayName ?? "Unknown"`.
- Show queue counts using `pending`, `processing`, `done`, `failed`, and `skipped`.
- Add buttons for refresh, pause/resume, start/stop daemon, voice test, open dashboard, and open setup.
- Use `@Environment(\.openWindow)` and call `openWindow(id: "dashboard")` / `openWindow(id: "setup")` for window buttons.
- Wrap async actions in `Task { await model.refresh() }` style handlers.

- [ ] **Step 6: Convert app to `MenuBarExtra` with explicit scenes**

Modify `AgentVoiceApp.swift` to:

- Import `AgentVoiceCore` and `SwiftUI`.
- Hold `@StateObject private var model = AppModel()` in the `App` struct.
- Use `MenuBarExtra("Agent Voice", systemImage: "waveform.circle") { MenuBarSentinelView(model: model) }`.
- Keep a `WindowGroup("Dashboard", id: "dashboard")` placeholder window and a `WindowGroup("Setup", id: "setup")` placeholder window so menu buttons compile before Tasks 10/11 replace them.

- [ ] **Step 7: Build Swift app**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AppModelTests
swift build --package-path macos/AgentVoiceApp
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -- macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift macos/AgentVoiceApp/Sources/AgentVoiceApp/MenuBarSentinelView.swift macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift
git diff --cached --name-only
git commit -m "feat: add tested mac menu bar shell"
```

---

## Task 10: Add setup assistant SwiftUI view

**Files:**
- Create: `macos/AgentVoiceApp/Sources/AgentVoiceApp/SetupAssistantView.swift`
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift`

- [ ] **Step 1: Add view with static model-driven steps**

Create `SetupAssistantView.swift` using `SetupStep.allCases`. Include:

- Step sidebar/list.
- Main detail panel.
- Static Kokoro path/config rows labeled "Choose path support coming later" and "Run Voice Test" wired to `model.testVoice()`.
- Summarizer mode buttons calling the app model `setSummarizerMode(_:)` method from Task 9.
- Agent enable/disable controls rendered as disabled buttons with helper text "Use CLI enable/disable for now". Do not call `SetupAction` command helpers and do not add agent enable/disable CLI calls in this task; those require a later task with exact `AgentVoiceCLI` methods.

- [ ] **Step 2: Add setup window scene**

Replace the Task 9 placeholder with `WindowGroup("Setup", id: "setup") { SetupAssistantView(model: model) }`. Keep the menu bar item able to open setup via `openWindow(id: "setup")`.

- [ ] **Step 3: Build**

Run: `swift build --package-path macos/AgentVoiceApp`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -- macos/AgentVoiceApp/Sources/AgentVoiceApp/SetupAssistantView.swift macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift
git diff --cached --name-only
git commit -m "feat: add mac setup assistant view"
```

---

## Task 11: Add dashboard console SwiftUI view

**Files:**
- Create: `macos/AgentVoiceApp/Sources/AgentVoiceApp/DashboardView.swift`
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift`

- [ ] **Step 1: Add dashboard view**

Create sections matching the spec:

- Daemon card.
- Kokoro/config card.
- Queue count cards.
- Recent done events from `AppModel.history` (`history --json`).
- Failed jobs from `AppModel.history` (`history --json`).
- Agent grid from status config.

For data not exposed by current CLI JSON, render static text explicitly labeled "Not exposed by current CLI yet". Do not invent health values.

- [ ] **Step 2: Add dashboard window scene**

Replace the Task 9 placeholder with `WindowGroup("Dashboard", id: "dashboard") { DashboardView(model: model) }`. Keep the menu bar item able to open dashboard via `openWindow(id: "dashboard")`.

- [ ] **Step 3: Build**

Run: `swift build --package-path macos/AgentVoiceApp`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -- macos/AgentVoiceApp/Sources/AgentVoiceApp/DashboardView.swift macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift
git diff --cached --name-only
git commit -m "feat: add mac dashboard console"
```

---

## Task 12: Add app icon generation and local app bundle scripts

**Files:**
- Create: `scripts/generate-macos-icon.sh`
- Create: `scripts/build-macos-app.sh`
- Create: `macos/AgentVoiceApp/Resources/AppIcon.icns`
- Create: `macos/AgentVoiceApp/Resources/Info.plist`
- Modify: `.gitignore`

Note: keep packaging resources under `macos/AgentVoiceApp/Resources/`, outside `Sources/`, so SwiftPM does not treat them as unhandled target files. Do not add SwiftPM resource declarations for this development bundle helper.

- [ ] **Step 1: Run script checks before files exist**

Run:

```bash
bash -n scripts/generate-macos-icon.sh
bash -n scripts/build-macos-app.sh
```

Expected: FAIL with file-not-found for both scripts. This is the red step for the packaging task.

- [ ] **Step 2: Create minimal scripts and verify syntax passes**

Create both scripts with only shebang, strict mode, and a placeholder message:

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "not implemented yet" >&2
exit 2
```

Run:

```bash
bash -n scripts/generate-macos-icon.sh
bash -n scripts/build-macos-app.sh
```

Expected: PASS syntax checks.

- [ ] **Step 3: Implement icon generation script**

`scripts/generate-macos-icon.sh` must:

- Resolve `ROOT_DIR` from the script path, not `$PWD`.
- Read `assets/app-icon/agent-voice-local-voice-orb.png`.
- Create an `.iconset` under `mktemp -d`.
- Generate these files with `sips`:
  - `icon_16x16.png` from 16
  - `icon_16x16@2x.png` from 32
  - `icon_32x32.png` from 32
  - `icon_32x32@2x.png` from 64
  - `icon_128x128.png` from 128
  - `icon_128x128@2x.png` from 256
  - `icon_256x256.png` from 256
  - `icon_256x256@2x.png` from 512
  - `icon_512x512.png` from 512
  - `icon_512x512@2x.png` from 1024
- Run `iconutil -c icns` to write `macos/AgentVoiceApp/Resources/AppIcon.icns`.
- Clean temp directory via `trap`.

- [ ] **Step 4: Create `Info.plist`**

Create `macos/AgentVoiceApp/Resources/Info.plist` with at least:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>AgentVoiceApp</string>
  <key>CFBundleIdentifier</key>
  <string>local.agentvoice.app</string>
  <key>CFBundleName</key>
  <string>Agent Voice</string>
  <key>CFBundleDisplayName</key>
  <string>Agent Voice</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
</dict>
</plist>
```

Do not set `LSUIElement` yet; keep the preview app debuggable with visible windows while menu-bar behavior is still evolving.

- [ ] **Step 5: Implement local bundle script with product path discovery**

`scripts/build-macos-app.sh` must:

- Resolve `ROOT_DIR` from the script path, not `$PWD`.
- Run `swift build -c release --package-path "$ROOT_DIR/macos/AgentVoiceApp"`.
- Get build products via:

```bash
BIN_DIR="$(swift build -c release --package-path "$ROOT_DIR/macos/AgentVoiceApp" --show-bin-path)"
```

- Create `dist/Agent Voice.app/Contents/MacOS` and `dist/Agent Voice.app/Contents/Resources`.
- Copy `$BIN_DIR/AgentVoiceApp` to `dist/Agent Voice.app/Contents/MacOS/AgentVoiceApp`.
- Copy `macos/AgentVoiceApp/Resources/Info.plist` to `dist/Agent Voice.app/Contents/Info.plist`.
- Copy `macos/AgentVoiceApp/Resources/AppIcon.icns` to `dist/Agent Voice.app/Contents/Resources/AppIcon.icns`.
- Bundle the existing CLI under `dist/Agent Voice.app/Contents/Resources/agent-voice/` by copying:
  - `bin/agent-voice`
  - `src/`
  - `package.json`
  - `bun.lock` if present
- Preserve executable mode for `dist/Agent Voice.app/Contents/Resources/agent-voice/bin/agent-voice`.
- Print the app path.

This script is a development bundle helper, not a signed/notarized installer. It assumes `bun` is available on the user's PATH; it does not vendor Bun.

- [ ] **Step 6: Add `dist/` to `.gitignore`**

Add `dist/` explicitly. Do not commit generated app bundles.

- [ ] **Step 7: Run scripts**

Run:

```bash
bash scripts/generate-macos-icon.sh
bash scripts/build-macos-app.sh
test -f macos/AgentVoiceApp/Resources/AppIcon.icns
test -d "dist/Agent Voice.app"
test -f "dist/Agent Voice.app/Contents/MacOS/AgentVoiceApp"
test -f "dist/Agent Voice.app/Contents/Resources/AppIcon.icns"
test -f "dist/Agent Voice.app/Contents/Info.plist"
test -x "dist/Agent Voice.app/Contents/Resources/agent-voice/bin/agent-voice"
test -f "dist/Agent Voice.app/Contents/Resources/agent-voice/src/index.ts"
SMOKE_HOME="$(mktemp -d)"
AGENT_VOICE_HOME="$SMOKE_HOME" "dist/Agent Voice.app/Contents/Resources/agent-voice/bin/agent-voice" status --json >/tmp/agent-voice-bundled-status.json
python3 -m json.tool /tmp/agent-voice-bundled-status.json >/dev/null
rm -rf "$SMOKE_HOME" /tmp/agent-voice-bundled-status.json
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -- scripts/generate-macos-icon.sh scripts/build-macos-app.sh macos/AgentVoiceApp/Resources/AppIcon.icns macos/AgentVoiceApp/Resources/Info.plist .gitignore
git diff --cached --name-only
git commit -m "feat: add mac app icon packaging"
```

---

## Task 13: Update README with Mac app development notes

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add README section**

Add a section after current daemon usage:

```md
## macOS app preview

The native macOS app is developed under `macos/AgentVoiceApp`. It is a SwiftUI menu-bar utility that shells out to the existing `agent-voice` CLI and preserves the local SQLite queue/daemon architecture.

Development commands:

```bash
swift test --package-path macos/AgentVoiceApp
swift build --package-path macos/AgentVoiceApp
bash scripts/generate-macos-icon.sh
bash scripts/build-macos-app.sh
open "dist/Agent Voice.app"
```

The app preview does not install global agent hooks or wrappers. Use the existing manual daemon flow unless an install feature is explicitly implemented.
```

- [ ] **Step 2: Verify docs and commands**

Run:

```bash
bun run typecheck
bun test
swift test --package-path macos/AgentVoiceApp
swift test --package-path macos/AgentVoiceApp --filter AgentVoiceCLITests
swift test --package-path macos/AgentVoiceApp --filter AppModelTests
swift build --package-path macos/AgentVoiceApp
```

Expected: PASS, including the focused `AgentVoiceCLITests` CLI bridge contract.

- [ ] **Step 3: Commit**

```bash
git add -- README.md
git diff --cached --name-only
git commit -m "docs: add mac app preview notes"
```

---

## Task 14: Final quality gate

**Files:**
- No new files unless fixing issues discovered by verification.

- [ ] **Step 1: Verify repo status and avoid unrelated staging**

Run:

```bash
git status --short
git diff --cached --name-only
```

Expected: only intentional files for any final fixes, and no unrelated files staged. Unrelated pre-existing files may remain untracked/modified, but must not be staged.

- [ ] **Step 2: Run full TypeScript verification**

Run:

```bash
bun test
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full Swift verification**

Run:

```bash
swift test --package-path macos/AgentVoiceApp
swift test --package-path macos/AgentVoiceApp --filter AgentVoiceCLITests
swift test --package-path macos/AgentVoiceApp --filter AppModelTests
swift build --package-path macos/AgentVoiceApp
```

Expected: PASS, including the focused `AgentVoiceCLITests` CLI bridge contract.

- [ ] **Step 4: Run packaging smoke checks**

Run:

```bash
bash -n scripts/generate-macos-icon.sh
bash -n scripts/build-macos-app.sh
bash scripts/generate-macos-icon.sh
bash scripts/build-macos-app.sh
test -d "dist/Agent Voice.app"
test -x "dist/Agent Voice.app/Contents/MacOS/AgentVoiceApp"
test -f "dist/Agent Voice.app/Contents/Info.plist"
test -f "dist/Agent Voice.app/Contents/Resources/AppIcon.icns"
test -x "dist/Agent Voice.app/Contents/Resources/agent-voice/bin/agent-voice"
test -f "dist/Agent Voice.app/Contents/Resources/agent-voice/src/index.ts"
SMOKE_HOME="$(mktemp -d)"
AGENT_VOICE_HOME="$SMOKE_HOME" "dist/Agent Voice.app/Contents/Resources/agent-voice/bin/agent-voice" status --json >/tmp/agent-voice-bundled-status.json
python3 -m json.tool /tmp/agent-voice-bundled-status.json >/dev/null
rm -rf "$SMOKE_HOME" /tmp/agent-voice-bundled-status.json
/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "dist/Agent Voice.app/Contents/Info.plist" | grep -qx "AgentVoiceApp"
/usr/libexec/PlistBuddy -c "Print :CFBundleIconFile" "dist/Agent Voice.app/Contents/Info.plist" | grep -qx "AppIcon"
git check-ignore dist/ "dist/Agent Voice.app"
```

Expected: PASS. `dist/` remains ignored and must not be staged.

- [ ] **Step 5: Run whitespace check**

Run: `git diff --check`

If unrelated pre-existing tracked formatting drift is still present, also run `git diff --check -- <files touched by this plan>` before committing any final fix.

Expected: no output.

- [ ] **Step 6: Commit final fixes if any**

If verification required fixes:

```bash
git add -- <exact fixed files>
git commit -m "fix: stabilize mac app preview"
```

If no fixes were needed, do not create an empty commit.

---

## Execution handoff

Recommended execution mode: **Subagent-Driven** with one task per worker and parent review between tasks. The parent should remain the single integrator and should not let multiple workers edit the same files concurrently.

Because the user requested working on `master`, do not create a worktree unless they explicitly change that preference.
