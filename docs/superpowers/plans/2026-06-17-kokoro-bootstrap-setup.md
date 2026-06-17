# Kokoro Bootstrap Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit Kokoro bootstrap flow so Agent Voice can install and configure its local Kokoro TTS service from the CLI and macOS Setup Assistant without requiring users to manually clone another Kokoro repo.

**Architecture:** Commit the Kokoro JSONL Python service script under `resources/kokoro/`, then add a focused TypeScript setup module that installs runtime pieces into `AGENT_VOICE_HOME/kokoro`. The macOS app remains a thin UI over the CLI: it launches `agent-voice kokoro setup --jsonl`, streams progress events into a temporary setup window, and refreshes config/doctor/status after completion.

**Tech Stack:** Bun/TypeScript CLI, Swift/SwiftUI macOS app, `uv` for Python environment creation, Python Kokoro package, JSONL progress events, Bun tests, XCTest.

---

## Implementation safety notes

- Do not implement in a dirty shared workspace. Use an isolated worktree before code changes if possible.
- Do not overwrite unrelated current changes in `README.md`, `src/cli.ts`, Swift app files, or tests. Inspect diffs before editing.
- Keep setup manual-consent only. No automatic install on launch.
- Do not curl-pipe installers. If `uv` is missing, fail with instructions.
- Do not log full environment variables or secrets.
- Prevent duplicate installs with a managed setup lock; do not let two setup processes mutate `AGENT_VOICE_HOME/kokoro` concurrently.
- Treat the committed Python service script as Agent Voice source code; do not depend on a sibling checkout at runtime.
- If copying code from `/Users/meidhy/junk/repo/kokoro-tts/Python/kokoro_tts_service.py`, confirm it is owned/licensable for this repo before committing it. Otherwise write a clean equivalent.

## File structure

### New files

- `resources/kokoro/kokoro_tts_service.py` — repo-owned Kokoro JSONL service script.
- `resources/kokoro/requirements.txt` — pinned Python dependencies for the managed environment.
- `src/kokoro-setup.ts` — setup/status logic, JSONL event types, managed-install locking, dependency injection seams.
- `tests/kokoro-setup.test.ts` — TypeScript setup module and CLI coverage.
- `macos/AgentVoiceApp/Sources/AgentVoiceCore/KokoroSetupModels.swift` — Swift event/state models and single source of truth for setup step order.
- `macos/AgentVoiceApp/Sources/AgentVoiceApp/KokoroSetupProgressView.swift` — temporary setup progress window.
- `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/KokoroSetupModelTests.swift` — JSONL parsing/state tests.
- `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/KokoroSetupProgressViewSourceTests.swift` — UI source contract tests.

### Modified files

- `src/cli.ts` — help text, `kokoro setup`, `kokoro status`, `CliIo` test seam.
- `src/config.ts` — remove maintainer-local Kokoro default; optionally add managed default helper.
- `src/doctor.ts` — action should point to Kokoro setup when script is missing.
- `tests/cli.test.ts` — help assertions.
- `tests/config.test.ts` — default Kokoro path expectation update.
- `tests/doctor.test.ts` — missing Kokoro action expectations.
- `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift` — streaming process support and Kokoro setup launcher.
- `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift` — `installKokoro`, cancel/retry state, diagnostics.
- `macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift` — register `kokoroSetup` window.
- `macos/AgentVoiceApp/Sources/AgentVoiceApp/SetupAssistantView.swift` — Install Kokoro button and disclosure.
- Existing Swift tests under `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/` — AppModel and source assertions.
- `README.md` — quick start and troubleshooting.

---

## Task 0: Preparation and baseline

**Files:** none

- [ ] **Step 1: Inspect current worktree state**

Run:

```bash
git status --short --branch
git worktree list
```

Expected: identify unrelated dirty files before implementation. Do not discard them.

- [ ] **Step 2: Create an implementation worktree or branch**

Preferred, if the current tree can support it:

```bash
git worktree add .worktrees/kokoro-bootstrap -b feature/kokoro-bootstrap-setup HEAD
cd .worktrees/kokoro-bootstrap
```

If existing dirty changes must be preserved in the current workspace, ask the parent/orchestrator before proceeding.

- [ ] **Step 3: Run baseline TypeScript checks**

Run:

```bash
bun test
bun run typecheck
```

Expected: establish current baseline. If failures are unrelated pre-existing failures, record them before continuing.

- [ ] **Step 4: Run baseline Swift checks**

Run:

```bash
swift test --package-path macos/AgentVoiceApp
swift build --package-path macos/AgentVoiceApp
```

Expected: establish current baseline or record pre-existing failures.

- [ ] **Step 5: Commit only baseline/spec docs if needed**

If the spec/plan docs are not committed and the index is available:

```bash
git add docs/superpowers/specs/2026-06-17-kokoro-bootstrap-setup-design.md docs/superpowers/plans/2026-06-17-kokoro-bootstrap-setup.md
git commit -m "docs: plan kokoro bootstrap setup"
```

Expected: commit contains only docs. If another git process holds `.git/index.lock`, do not force-delete it; continue implementation and report the blocked commit.

---

## Task 1: Add committed Kokoro service resources

**Files:**

- Create: `resources/kokoro/kokoro_tts_service.py`
- Create: `resources/kokoro/requirements.txt`
- Create: `tests/kokoro-setup.test.ts`

- [ ] **Step 1: Write failing tests for resource presence and pinned dependencies**

Add to `tests/kokoro-setup.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const resourceRoot = join(import.meta.dir, "..", "resources", "kokoro");

describe("Kokoro setup resources", () => {
  test("ships a Kokoro JSONL service script", () => {
    const script = join(resourceRoot, "kokoro_tts_service.py");
    expect(existsSync(script)).toBe(true);
    const source = readFileSync(script, "utf8");
    expect(source).toContain("KPipeline");
    expect(source).toContain("MAX_TEXT_CHARS");
    expect(source).toContain("KOKORO_REPO_ID");
    expect(source).toContain('"status": "ready"');
    expect(source).toContain('"audio"');
  });

  test("pins Python dependencies for managed Kokoro install", () => {
    const requirements = readFileSync(join(resourceRoot, "requirements.txt"), "utf8");
    expect(requirements).toContain("kokoro==0.9.4");
    expect(requirements).toContain("soundfile==0.14.0");
    expect(requirements).toContain("numpy==2.4.6");
    expect(requirements).not.toMatch(/>=|~/);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
bun test tests/kokoro-setup.test.ts
```

Expected: FAIL because `resources/kokoro/` files do not exist.

- [ ] **Step 3: Create `resources/kokoro/requirements.txt`**

Create:

```txt
kokoro==0.9.4
soundfile==0.14.0
numpy==2.4.6
huggingface-hub==1.19.0
tqdm==4.68.2
```

If dependency resolution later proves these exact pins incompatible, change the pins and update the test in the same task with evidence from `uv pip install`.

- [ ] **Step 4: Create `resources/kokoro/kokoro_tts_service.py`**

Use a repo-owned script that:

- reads JSON lines from stdin,
- writes JSON lines to stdout,
- emits `{"status":"ready"}` after `KPipeline` loads,
- accepts `{"text":"...","voice":"af_heart","lang":"a"}`,
- returns `{"audio":"<base64-wav>","duration":1.23}`,
- emits `{"error":"..."}` for invalid input or TTS failure,
- redirects third-party warnings to stderr during model load,
- validates text length, voice id, and language id before synthesis,
- limits request text with `MAX_TEXT_CHARS` so a direct TTS request cannot create unbounded work,
- reads optional `KOKORO_REPO_ID` and `KOKORO_REPO_REVISION` environment variables for pinned model loading,
- optionally emits `{"status":"downloading",...}` progress while Hugging Face downloads model files.

Core implementation shape:

```python
#!/usr/bin/env python3
"""Kokoro TTS service. Reads JSON from stdin, writes JSON to stdout."""

import base64
import io
import json
import sys

import os
import re

import numpy as np
import soundfile as sf
from kokoro import KPipeline

MAX_TEXT_CHARS = 1000
VOICE_RE = re.compile(r"^[a-z]{2}_[a-z0-9_]+$")
LANG_RE = re.compile(r"^[a-z]$")
KOKORO_REPO_ID = os.environ.get("KOKORO_REPO_ID", "hexgrad/Kokoro-82M")
KOKORO_REPO_REVISION = os.environ.get("KOKORO_REPO_REVISION")


def send_message(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def audio_to_base64_wav(audio_data, sample_rate=24000):
    buffer = io.BytesIO()
    sf.write(buffer, audio_data, sample_rate, format="WAV", subtype="PCM_16")
    buffer.seek(0)
    return base64.b64encode(buffer.read()).decode("ascii")


def load_pipeline(lang):
    real_stdout = sys.stdout
    try:
        sys.stdout = sys.stderr
        kwargs = {"lang_code": lang, "repo_id": KOKORO_REPO_ID}
        if KOKORO_REPO_REVISION:
            kwargs["revision"] = KOKORO_REPO_REVISION
        return KPipeline(**kwargs)
    finally:
        sys.stdout = real_stdout


def main():
    current_lang = "a"
    try:
        pipeline = load_pipeline(current_lang)
        send_message({"status": "ready"})
    except Exception as error:
        send_message({"error": f"Failed to load model: {error}"})
        raise SystemExit(1)

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as error:
            send_message({"error": f"Invalid JSON: {error}"})
            continue

        text = request.get("text", "")
        voice = request.get("voice", "af_heart")
        lang = request.get("lang", "a")
        if not text:
            send_message({"error": "Empty text"})
            continue
        if len(text) > MAX_TEXT_CHARS:
            send_message({"error": f"Text too long; max {MAX_TEXT_CHARS} characters"})
            continue
        if not VOICE_RE.match(voice):
            send_message({"error": "Invalid voice id"})
            continue
        if not LANG_RE.match(lang):
            send_message({"error": "Invalid language id"})
            continue

        try:
            if lang != current_lang:
                pipeline = load_pipeline(lang)
                current_lang = lang
            chunks = [audio for _, _, audio in pipeline(text, voice=voice)]
            if not chunks:
                send_message({"error": "No audio generated"})
                continue
            combined = np.concatenate(chunks)
            send_message({
                "audio": audio_to_base64_wav(combined),
                "duration": round(len(combined) / 24000.0, 2),
            })
        except Exception as error:
            send_message({"error": f"TTS failed: {error}"})


if __name__ == "__main__":
    main()
```

If preserving download progress, port the `tqdm` patch from the existing local service script only after confirming it is owned/licensable.

- [ ] **Step 5: Run focused tests and verify pass**

Run:

```bash
bun test tests/kokoro-setup.test.ts
```

Expected: PASS for resource tests.

- [ ] **Step 6: Commit resources**

```bash
git add resources/kokoro tests/kokoro-setup.test.ts
git commit -m "feat: add kokoro setup resources"
```

---

## Task 2: Implement TypeScript Kokoro setup module with test seams

**Files:**

- Create: `src/kokoro-setup.ts`
- Modify: `tests/kokoro-setup.test.ts`

- [ ] **Step 1: Write failing tests for setup events, missing uv, and read-only status**

Append tests using dependency injection instead of real `uv` or network:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildKokoroStatus,
  runKokoroSetup,
  type KokoroSetupDeps,
  type KokoroSetupEvent,
} from "../src/kokoro-setup";
import { loadConfig } from "../src/config";
import { resolvePaths } from "../src/paths";

function tempHome() {
  return mkdtempSync(join(tmpdir(), "agent-voice-kokoro-setup-"));
}

function fakeDeps(overrides: Partial<KokoroSetupDeps> = {}): KokoroSetupDeps {
  return {
    commandExists: async (cmd) => cmd === "uv",
    run: async () => ({ ok: true, stdout: "ok", stderr: "" }),
    smokeTest: async () => ({ ok: true }),
    ...overrides,
  };
}

test("kokoro setup emits ordered JSONL-friendly progress events and updates config after smoke test", async () => {
  const home = tempHome();
  const events: KokoroSetupEvent[] = [];
  try {
    const paths = resolvePaths({ AGENT_VOICE_HOME: home });
    const outcome = await runKokoroSetup(paths, {
      deps: fakeDeps(),
      emit: (event) => events.push(event),
    });

    expect(outcome.ok).toBe(true);
    expect(events.map((event) => event.type)).toContain("complete");
    const runningStepIds = events
      .filter((event): event is Extract<KokoroSetupEvent, { type: "step" }> => event.type === "step" && event.status === "running")
      .map((event) => event.id);
    expect(runningStepIds).toEqual([
      "prepare",
      "uv-check",
      "script",
      "venv",
      "deps",
      "model",
      "config",
      "smoke-test",
    ]);
    expect(events).toContainEqual({ type: "complete", ok: true });
    const config = loadConfig(paths, { createIfMissing: false });
    expect(config.tts.python).toBe(join(home, "kokoro", ".venv", "bin", "python"));
    expect(config.tts.kokoroScript).toBe(join(home, "kokoro", "kokoro_tts_service.py"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("kokoro setup fails before config mutation when uv is missing", async () => {
  const home = tempHome();
  try {
    const paths = resolvePaths({ AGENT_VOICE_HOME: home });
    const before = loadConfig(paths);
    const outcome = await runKokoroSetup(paths, {
      deps: fakeDeps({ commandExists: async () => false }),
      emit: () => {},
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("uv is required");
    const after = loadConfig(paths, { createIfMissing: false });
    expect(after.tts).toEqual(before.tts);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("kokoro status is read-only and reports bundled resource availability", () => {
  const home = tempHome();
  try {
    const paths = resolvePaths({ AGENT_VOICE_HOME: home });
    const status = buildKokoroStatus(paths);
    expect(status.managedHome).toBe(join(home, "kokoro"));
    expect(status.installed).toBe(false);
    expect(status.resourceScriptExists).toBe(true);
    expect(existsSync(paths.config)).toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("kokoro setup refuses a concurrent managed install", async () => {
  const home = tempHome();
  try {
    const paths = resolvePaths({ AGENT_VOICE_HOME: home });
    mkdirSync(join(home, "kokoro"), { recursive: true });
    writeFileSync(join(home, "kokoro", "setup.lock"), "123\n");
    const outcome = await runKokoroSetup(paths, { deps: fakeDeps(), emit: () => {} });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("already running");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run focused tests and verify import failure**

Run:

```bash
bun test tests/kokoro-setup.test.ts
```

Expected: FAIL because `src/kokoro-setup.ts` does not exist.

- [ ] **Step 3: Create `src/kokoro-setup.ts` public types and constants**

Implement these exports first:

```ts
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  lstatSync,
  openSync,
  closeSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadConfig, saveConfig } from "./config";
import type { AgentVoicePaths } from "./paths";

export type KokoroSetupStepId =
  | "prepare"
  | "uv-check"
  | "script"
  | "venv"
  | "deps"
  | "model"
  | "config"
  | "smoke-test";

export type KokoroSetupStepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type KokoroSetupEvent =
  | { type: "step"; id: KokoroSetupStepId; status: KokoroSetupStepStatus; title: string; error?: string }
  | { type: "log"; stream: "stdout" | "stderr"; message: string }
  | { type: "complete"; ok: boolean; error?: string };

export interface KokoroSetupRunResult {
  ok: boolean;
  error?: string;
  pythonPath?: string;
  scriptPath?: string;
}

export interface KokoroSetupDeps {
  commandExists(command: string): Promise<boolean>;
  run(request: { cmd: string; args: string[]; cwd?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<{ ok: boolean; stdout?: string; stderr?: string; exitCode?: number }>;
  smokeTest(pythonPath: string, scriptPath: string, env: Record<string, string>): Promise<{ ok: boolean; error?: string }>;
}

export interface KokoroSetupOptions {
  deps?: KokoroSetupDeps;
  emit?: (event: KokoroSetupEvent) => void;
}

export interface KokoroStatusOptions {
  resourceRoot?: string;
}

export interface KokoroManagedStatus {
  managedHome: string;
  installed: boolean;
  scriptPath: string;
  pythonPath: string;
  resourceScriptPath: string;
  resourceScriptExists: boolean;
  lockPath: string;
  checks: Array<{ id: string; ok: boolean; message: string }>;
}
```

- [ ] **Step 4: Implement managed path helpers**

Add helpers:

```ts
export function kokoroManagedHome(paths: AgentVoicePaths): string {
  return join(paths.home, "kokoro");
}

export function kokoroManagedScript(paths: AgentVoicePaths): string {
  return join(kokoroManagedHome(paths), "kokoro_tts_service.py");
}

export function kokoroManagedPython(paths: AgentVoicePaths): string {
  return join(kokoroManagedHome(paths), ".venv", "bin", "python");
}

function defaultResourceRoot(): string {
  return resolve(import.meta.dir, "..", "resources", "kokoro");
}

function resourcePath(root: string, ...parts: string[]): string {
  return resolve(root, ...parts);
}
```

- [ ] **Step 5: Implement setup locking and safe managed writes**

Add a managed lock file and symlink-safe copy helpers before any mutation. Do not run two installers against the same `AGENT_VOICE_HOME/kokoro`.

```ts
import { lstatSync, openSync, closeSync, rmSync } from "node:fs";

export function kokoroSetupLockPath(paths: AgentVoicePaths): string {
  return join(kokoroManagedHome(paths), "setup.lock");
}

function assertManagedChild(paths: AgentVoicePaths, target: string): void {
  const home = resolve(kokoroManagedHome(paths));
  const resolved = resolve(target);
  if (resolved !== home && !resolved.startsWith(`${home}/`)) {
    throw new Error(`Refusing to write outside managed Kokoro home: ${target}`);
  }
}

function assertSafeOverwrite(paths: AgentVoicePaths, target: string): void {
  assertManagedChild(paths, target);
  if (!existsSync(target)) return;
  const stat = lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Refusing to overwrite unsafe managed path: ${target}`);
  }
}

function acquireSetupLock(paths: AgentVoicePaths): () => void {
  mkdirSync(kokoroManagedHome(paths), { recursive: true });
  const lockPath = kokoroSetupLockPath(paths);
  const fd = openSync(lockPath, "wx");
  writeFileSync(fd, `${process.pid}\n`, "utf8");
  return () => {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  };
}
```

If lock acquisition fails because `setup.lock` exists, return a clear setup failure: `Kokoro setup is already running for this Agent Voice home`.

- [ ] **Step 6: Implement `buildKokoroStatus`**

Implement read-only status:

```ts
export function buildKokoroStatus(
  paths: AgentVoicePaths,
  options: KokoroStatusOptions = {},
): KokoroManagedStatus {
  const managedHome = kokoroManagedHome(paths);
  const scriptPath = kokoroManagedScript(paths);
  const pythonPath = kokoroManagedPython(paths);
  const scriptExists = existsSync(scriptPath);
  const pythonExists = existsSync(pythonPath);
  const resourceRoot = options.resourceRoot ?? defaultResourceRoot();
  const resourceScriptPath = resourcePath(resourceRoot, "kokoro_tts_service.py");
  const resourceScriptExists = existsSync(resourceScriptPath);
  const lockPath = kokoroSetupLockPath(paths);
  return {
    managedHome,
    scriptPath,
    pythonPath,
    resourceScriptPath,
    resourceScriptExists,
    lockPath,
    installed: scriptExists && pythonExists,
    checks: [
      { id: "managedHome.exists", ok: existsSync(managedHome), message: managedHome },
      { id: "resourceScript.exists", ok: resourceScriptExists, message: resourceScriptPath },
      { id: "script.exists", ok: scriptExists, message: scriptPath },
      { id: "python.exists", ok: pythonExists, message: pythonPath },
      { id: "setupLock.absent", ok: !existsSync(lockPath), message: lockPath },
    ],
  };
}
```

- [ ] **Step 7: Implement default dependencies**

Implement with `Bun.spawn` for real commands:

```ts
async function commandExists(command: string): Promise<boolean> {
  if (!/^[a-zA-Z0-9._-]+$/.test(command)) return false;
  const proc = Bun.spawn(["/usr/bin/env", "which", command], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return (await proc.exited) === 0;
}
```

For `run`, capture stdout/stderr and enforce timeout. Keep subprocess execution injectable so tests never need `uv`, Python, or network. Do not expose a generic download helper unless fixed URLs and checksums are implemented in the same task.

- [ ] **Step 8: Implement `runKokoroSetup` in phases**

Implement phase order:

1. Acquire `setup.lock`; release it in `finally`.
2. `prepare`: create `AGENT_VOICE_HOME/kokoro`, `models`, and `models/huggingface`.
3. `uv-check`: verify `uv`.
4. `script`: safely copy `resources/kokoro/kokoro_tts_service.py`.
5. `venv`: run `uv venv .venv` in managed dir.
6. `deps`: run `uv pip install -r <resource requirements>` with managed cwd.
7. `model`: run a preload command through the managed Python so Hugging Face/Kokoro assets are cached under `AGENT_VOICE_HOME/kokoro/models/huggingface` before config is changed. Set `HF_HOME`, `KOKORO_REPO_ID`, and `KOKORO_REPO_REVISION` in the child env. If a fixed model revision/checksum is later selected, add checksum verification here; do not claim checksum coverage without it.
8. `config`: stage config update in memory, but do not write yet.
9. `smoke-test`: start `python kokoro_tts_service.py` with `HF_HOME` and wait for `ready`.
10. Write config and emit `complete`.

Each step should emit at least `running` and one terminal status (`done`, `failed`, or `skipped`) so the UI cannot get stuck on a misleading current step. If any pre-config step fails, leave old config unchanged.

- [ ] **Step 9: Run focused tests and verify pass**

Run:

```bash
bun test tests/kokoro-setup.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit setup module**

```bash
git add src/kokoro-setup.ts tests/kokoro-setup.test.ts
git commit -m "feat: add kokoro setup module"
```

---

## Task 3: Wire Kokoro setup into the CLI

**Files:**

- Modify: `src/cli.ts`
- Modify: `tests/cli.test.ts`
- Modify: `tests/kokoro-setup.test.ts`

- [ ] **Step 1: Write failing help test**

Update `tests/cli.test.ts` help test:

```ts
expect(result.stdout).toContain("agent-voice kokoro setup");
expect(result.stdout).toContain("agent-voice kokoro status --json");
```

- [ ] **Step 2: Write failing CLI command tests**

Add to `tests/kokoro-setup.test.ts`:

```ts
import { runCli } from "../src/cli";

test("CLI kokoro status returns managed status json", async () => {
  const home = tempHome();
  try {
    const result = await runCli(["kokoro", "status", "--json"], {
      env: { AGENT_VOICE_HOME: home },
    });
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.managedHome).toBe(join(home, "kokoro"));
    expect(payload.installed).toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("CLI kokoro setup --jsonl emits json lines", async () => {
  const home = tempHome();
  try {
    const result = await runCli(["kokoro", "setup", "--jsonl"], {
      env: { AGENT_VOICE_HOME: home },
      kokoroSetupDeps: fakeDeps(),
    } as any);
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split("\n").map(JSON.parse);
    expect(lines.at(-1)).toMatchObject({ type: "complete", ok: true });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
```

If TypeScript rejects `kokoroSetupDeps`, add it to `CliIo` instead of using `as any`.

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```bash
bun test tests/cli.test.ts tests/kokoro-setup.test.ts
```

Expected: FAIL because CLI command is not implemented.

- [ ] **Step 4: Update `src/cli.ts` imports and `CliIo`**

Add imports:

```ts
import {
  buildKokoroStatus,
  runKokoroSetup,
  type KokoroSetupDeps,
  type KokoroSetupEvent,
} from "./kokoro-setup";
```

Extend `CliIo`:

```ts
kokoroSetupDeps?: KokoroSetupDeps;
```

- [ ] **Step 5: Update CLI help text**

Add usage lines:

```text
  agent-voice kokoro setup [--jsonl]
  agent-voice kokoro status --json
```

- [ ] **Step 6: Implement `kokoro` command branch before `doctor`**

Add:

```ts
if (command === "kokoro") {
  const [, subcommand] = args;
  if (subcommand === "status") {
    if (!args.includes("--json")) {
      return result(2, "", "Usage: agent-voice kokoro status --json\n");
    }
    return result(0, `${JSON.stringify(buildKokoroStatus(paths), null, 2)}\n`);
  }

  if (subcommand === "setup") {
    const jsonl = args.includes("--jsonl");
    const events: KokoroSetupEvent[] = [];
    const outcome = await runKokoroSetup(paths, {
      deps: io.kokoroSetupDeps,
      emit: (event) => events.push(event),
    });
    if (jsonl) {
      return result(outcome.ok ? 0 : 1, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
    }
    return outcome.ok
      ? result(0, `Kokoro installed: ${outcome.scriptPath}\n`)
      : result(1, "", `${outcome.error ?? "Kokoro setup failed"}\n`);
  }

  return result(2, "", "Usage: agent-voice kokoro setup [--jsonl] | kokoro status --json\n");
}
```

- [ ] **Step 7: Run focused tests and verify pass**

Run:

```bash
bun test tests/cli.test.ts tests/kokoro-setup.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit CLI integration**

```bash
git add src/cli.ts tests/cli.test.ts tests/kokoro-setup.test.ts
git commit -m "feat: expose kokoro setup cli"
```

---

## Task 4: Update config defaults and doctor guidance

**Files:**

- Modify: `src/config.ts`
- Modify: `src/doctor.ts`
- Modify: `tests/config.test.ts`
- Modify: `tests/doctor.test.ts`
- Modify: `tests/kokoro-setup.test.ts`

- [ ] **Step 1: Write failing config test for no maintainer-local default**

Update `tests/config.test.ts` default config test to expect no `/Users/meidhy` path:

```ts
expect(defaultConfig.tts.kokoroScript).not.toContain("/Users/");
expect(defaultConfig.tts.kokoroScript).toBe("");
```

If choosing a dynamic managed default instead, test `loadConfig(resolvePaths({ AGENT_VOICE_HOME: home }))` points at `join(home, "kokoro", "kokoro_tts_service.py")`.

Recommended simple v1: default empty string until setup writes managed config.

- [ ] **Step 2: Write failing doctor action test**

In `tests/doctor.test.ts`, add or update missing Kokoro expectations:

```ts
const kokoroCheck = parsed.checks.find((check) => check.id === "tts.kokoroScript.exists");
expect(kokoroCheck).toMatchObject({ ok: false, severity: "error" });
expect(kokoroCheck?.action).toContain("agent-voice kokoro setup");
```

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```bash
bun test tests/config.test.ts tests/doctor.test.ts
```

Expected: FAIL because default still has maintainer-local path and doctor action is generic.

- [ ] **Step 4: Update `src/config.ts` default tts path**

Change:

```ts
tts: {
  kokoroScript: "",
  python: "python3",
  voice: "af_heart",
  timeoutSeconds: 30,
},
```

Do not change summarizer defaults in this task.

- [ ] **Step 5: Update `src/doctor.ts` missing script messaging**

Handle empty path cleanly:

```ts
const script = config.tts.kokoroScript;
const exists = script.length > 0 && existsSync(script);
message: exists ? "Kokoro script exists" : script ? `Kokoro script not found: ${script}` : "Kokoro script is not configured";
action: "Run agent-voice kokoro setup or choose an existing Kokoro Python service script";
```

- [ ] **Step 6: Run focused tests and verify pass**

Run:

```bash
bun test tests/config.test.ts tests/doctor.test.ts tests/kokoro-setup.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit config/doctor updates**

```bash
git add src/config.ts src/doctor.ts tests/config.test.ts tests/doctor.test.ts tests/kokoro-setup.test.ts
git commit -m "feat: guide users to kokoro setup"
```

---

## Task 5: Add Swift streaming process support for Kokoro setup

**Files:**

- Create: `macos/AgentVoiceApp/Sources/AgentVoiceCore/KokoroSetupModels.swift`
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift`
- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceCLITests.swift`
- Create: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/KokoroSetupModelTests.swift`

- [ ] **Step 1: Write failing Swift model parsing tests**

Create `KokoroSetupModelTests.swift`:

```swift
import XCTest
@testable import AgentVoiceCore

final class KokoroSetupModelTests: XCTestCase {
    func testDecodesStepLogAndCompleteEvents() throws {
        let decoder = JSONDecoder()
        let step = try decoder.decode(KokoroSetupEvent.self, from: Data(#"{"type":"step","id":"prepare","status":"running","title":"Preparing"}"#.utf8))
        let log = try decoder.decode(KokoroSetupEvent.self, from: Data(#"{"type":"log","stream":"stdout","message":"ok"}"#.utf8))
        let complete = try decoder.decode(KokoroSetupEvent.self, from: Data(#"{"type":"complete","ok":true}"#.utf8))

        XCTAssertEqual(step.type, .step)
        XCTAssertEqual(step.id, "prepare")
        XCTAssertEqual(log.message, "ok")
        XCTAssertEqual(complete.ok, true)
    }
}
```

- [ ] **Step 2: Write failing streaming CLI command test**

In `AgentVoiceCLITests.swift`, add a streaming runner test instead of a buffered-output test:

```swift
actor RecordingStreamingRunner: ProcessStreaming {
    private(set) var requests: [ProcessRequest] = []
    private let lines: [String]
    private(set) var didCancel = false

    init(lines: [String]) { self.lines = lines }

    func stream(_ request: ProcessRequest) -> AsyncThrowingStream<String, Error> {
        requests.append(request)
        let lines = self.lines
        return AsyncThrowingStream { continuation in
            for line in lines { continuation.yield(line) }
            continuation.finish()
        }
    }

    func cancelActiveStream() { didCancel = true }
    func capturedRequests() -> [ProcessRequest] { requests }
}

func testKokoroSetupCommandStreamsJsonl() async throws {
    let streamingRunner = RecordingStreamingRunner(lines: ["{\"type\":\"complete\",\"ok\":true}"])
    let cli = AgentVoiceCLI(
        executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
        runner: RecordingRunner(),
        streamingRunner: streamingRunner
    )

    var received: [KokoroSetupEvent] = []
    for try await event in cli.streamKokoroSetupEvents() {
        received.append(event)
    }

    XCTAssertEqual(received.last?.ok, true)
    let requests = await streamingRunner.capturedRequests()
    XCTAssertEqual(requests.first?.arguments, ["kokoro", "setup", "--jsonl"])
}
```

- [ ] **Step 3: Run Swift focused tests and verify failure**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter KokoroSetupModelTests
swift test --package-path macos/AgentVoiceApp --filter AgentVoiceCLITests/testKokoroSetupCommandStreamsJsonl
```

Expected: FAIL because models/method do not exist.

- [ ] **Step 4: Create `KokoroSetupModels.swift`**

Implement flexible event model:

```swift
import Foundation

public struct KokoroSetupEvent: Codable, Equatable, Sendable {
    public enum EventType: String, Codable, Sendable { case step, log, complete }

    public let type: EventType
    public let id: String?
    public let status: String?
    public let title: String?
    public let stream: String?
    public let message: String?
    public let ok: Bool?
    public let error: String?
}

public enum KokoroSetupPhase: String, Equatable, Sendable {
    case idle
    case running
    case succeeded
    case failed
    case cancelled
}

public struct KokoroSetupStepDefinition: Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
}

public enum KokoroSetupSteps {
    public static let all: [KokoroSetupStepDefinition] = [
        .init(id: "prepare", title: "Prepare install directory"),
        .init(id: "uv-check", title: "Check uv"),
        .init(id: "script", title: "Install service script"),
        .init(id: "venv", title: "Create Python environment"),
        .init(id: "deps", title: "Install Python dependencies"),
        .init(id: "model", title: "Download model assets"),
        .init(id: "config", title: "Save Agent Voice config"),
        .init(id: "smoke-test", title: "Verify Kokoro"),
    ]
}

public struct KokoroSetupSnapshot: Equatable, Sendable {
    public var phase: KokoroSetupPhase = .idle
    public var currentStepID: String?
    public var currentTitle: String?
    public var completedStepIDs: [String] = []
    public var failedStepID: String?
    public var logs: [String] = []
    public var error: String?
}
```

- [ ] **Step 5: Add true streaming CLI support to `AgentVoiceCLI.swift`**

Add a streaming protocol and inject it beside the existing buffered runner:

```swift
public protocol ProcessStreaming: Sendable {
    func stream(_ request: ProcessRequest) -> AsyncThrowingStream<String, Error>
    func cancelActiveStream()
}
```

Extend `AgentVoiceCLI` with `streamingRunner`, then implement:

```swift
public func streamKokoroSetupEvents() -> AsyncThrowingStream<KokoroSetupEvent, Error> {
    let request = makeRequest(["kokoro", "setup", "--jsonl"])
    return AsyncThrowingStream { continuation in
        let task = Task {
            do {
                for try await line in streamingRunner.stream(request) {
                    guard let data = line.data(using: .utf8) else { continue }
                    let event = try JSONDecoder().decode(KokoroSetupEvent.self, from: data)
                    continuation.yield(event)
                }
                continuation.finish()
            } catch {
                continuation.finish(throwing: error)
            }
        }
        continuation.onTermination = { _ in
            task.cancel()
            streamingRunner.cancelActiveStream()
        }
    }
}

public func cancelKokoroSetup() {
    streamingRunner.cancelActiveStream()
}
```

Refactor environment/request construction out of `run(_:)` into a shared private `makeRequest(_:)` helper so buffered and streaming paths use identical PATH and `AGENT_VOICE_HOME` handling.

- [ ] **Step 6: Run focused tests and verify pass**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter KokoroSetupModelTests
swift test --package-path macos/AgentVoiceApp --filter AgentVoiceCLITests/testKokoroSetupCommandStreamsJsonl
```

Expected: PASS.

- [ ] **Step 7: Add cancellation test**

Add a focused test that starts `streamKokoroSetupEvents()`, cancels the consuming task, and asserts `cancelActiveStream()` was called on the streaming runner.

- [ ] **Step 8: Commit Swift streaming models**

```bash
git add macos/AgentVoiceApp/Sources/AgentVoiceCore/KokoroSetupModels.swift macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceCLITests.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/KokoroSetupModelTests.swift
git commit -m "feat: add kokoro setup cli models"
```

---

## Task 6: Add AppModel Kokoro setup state and actions

**Files:**

- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift`
- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`
- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/KokoroSetupModelTests.swift`

- [ ] **Step 1: Write failing state transition test**

In `AppModelTests.swift`, add:

```swift
func testInstallKokoroUpdatesSetupStateAndRefreshes() async throws {
    let streamingRunner = RecordingStreamingRunner(lines: [
        "{\"type\":\"step\",\"id\":\"prepare\",\"status\":\"running\",\"title\":\"Preparing install directory\"}",
        "{\"type\":\"step\",\"id\":\"prepare\",\"status\":\"done\",\"title\":\"Preparing install directory\"}",
        "{\"type\":\"complete\",\"ok\":true}"
    ])
    let runner = RecordingRunner(results: [
        ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
        ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
        ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
        ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
    ])
    let cli = AgentVoiceCLI(
        executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
        runner: runner,
        streamingRunner: streamingRunner
    )
    let model = AppModel(cli: cli)

    await model.installKokoro()

    XCTAssertEqual(model.kokoroSetup.phase, .succeeded)
    let requests = await streamingRunner.capturedRequests()
    XCTAssertEqual(requests.first?.arguments, ["kokoro", "setup", "--jsonl"])
}
```

- [ ] **Step 2: Write failing failure diagnostics test**

Add:

```swift
func testInstallKokoroFailureKeepsDiagnostics() async throws {
    let streamingRunner = RecordingStreamingRunner(lines: [
        "{\"type\":\"step\",\"id\":\"uv-check\",\"status\":\"failed\",\"title\":\"Checking uv\",\"error\":\"uv is required\"}",
        "{\"type\":\"complete\",\"ok\":false,\"error\":\"uv is required\"}"
    ])
    let cli = AgentVoiceCLI(
        executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
        runner: RecordingRunner(),
        streamingRunner: streamingRunner
    )
    let model = AppModel(cli: cli)

    await model.installKokoro()

    XCTAssertEqual(model.kokoroSetup.phase, .failed)
    XCTAssertTrue(model.kokoroSetup.error?.contains("uv") == true)
    XCTAssertTrue(model.kokoroSetupDiagnostics().contains("uv is required"))
}
```

- [ ] **Step 3: Add race and terminal-state tests**

Also add tests for the workflow-audited edge cases:

```swift
func testInstallKokoroIgnoresSecondStartWhileRunning() async throws {
    let streamingRunner = RecordingStreamingRunner(lines: [
        "{\"type\":\"step\",\"id\":\"prepare\",\"status\":\"running\",\"title\":\"Preparing\"}",
        "{\"type\":\"complete\",\"ok\":true}"
    ])
    let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: RecordingRunner(), streamingRunner: streamingRunner)
    let model = AppModel(cli: cli)

    async let first: Void = model.installKokoro()
    async let second: Void = model.installKokoro()
    _ = await (first, second)

    let requests = await streamingRunner.capturedRequests()
    XCTAssertEqual(requests.count, 1)
}

func testInstallKokoroFailsIfStreamEndsWithoutCompleteEvent() async throws {
    let streamingRunner = RecordingStreamingRunner(lines: [
        "{\"type\":\"step\",\"id\":\"prepare\",\"status\":\"running\",\"title\":\"Preparing\"}"
    ])
    let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: RecordingRunner(), streamingRunner: streamingRunner)
    let model = AppModel(cli: cli)

    await model.installKokoro()

    XCTAssertEqual(model.kokoroSetup.phase, .failed)
    XCTAssertTrue(model.kokoroSetup.error?.contains("complete event") == true)
}
```

- [ ] **Step 4: Run focused Swift tests and verify failure**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AppModelTests/testInstallKokoro
```

Expected: FAIL because `installKokoro` and state do not exist.

- [ ] **Step 5: Add published setup state to `AppModel.swift`**

Add:

```swift
@Published public private(set) var kokoroSetup = KokoroSetupSnapshot()
```

- [ ] **Step 6: Add event reducer**

Add private reducer:

```swift
private func applyKokoroSetupEvent(_ event: KokoroSetupEvent) {
    switch event.type {
    case .step:
        kokoroSetup.phase = event.status == "failed" ? .failed : .running
        kokoroSetup.currentStepID = event.id
        kokoroSetup.currentTitle = event.title
        if event.status == "done", let id = event.id, !kokoroSetup.completedStepIDs.contains(id) {
            kokoroSetup.completedStepIDs.append(id)
        }
        if event.status == "failed" {
            kokoroSetup.failedStepID = event.id
            kokoroSetup.error = event.error ?? event.title
        }
    case .log:
        if let message = event.message { kokoroSetup.logs.append(message) }
    case .complete:
        kokoroSetup.phase = event.ok == true ? .succeeded : .failed
        kokoroSetup.error = event.error ?? kokoroSetup.error
    }
}
```

- [ ] **Step 7: Add `installKokoro` and diagnostics methods**

Add:

```swift
private var kokoroSetupTask: Task<Void, Never>?
private var isCancellingKokoroSetup = false

public func installKokoro() async {
    guard kokoroSetup.phase != .running else { return }
    isCancellingKokoroSetup = false
    kokoroSetup = KokoroSetupSnapshot(phase: .running)
    var sawComplete = false
    let task = Task { [weak self] in
        guard let self else { return }
        do {
            for try await event in self.cli.streamKokoroSetupEvents() {
                if event.type == .complete { sawComplete = true }
                await MainActor.run { self.applyKokoroSetupEvent(event) }
            }
            await MainActor.run {
                if !sawComplete && self.kokoroSetup.phase == .running {
                    self.kokoroSetup.phase = .failed
                    self.kokoroSetup.error = "Kokoro setup ended before a complete event."
                }
            }
            let succeeded = await MainActor.run { self.kokoroSetup.phase == .succeeded }
            if succeeded { await self.refresh() }
            await MainActor.run { self.lastError = self.kokoroSetup.phase == .failed ? self.kokoroSetup.error : nil }
        } catch is CancellationError {
            await MainActor.run {
                self.kokoroSetup.phase = .cancelled
                self.kokoroSetup.error = nil
            }
        } catch {
            await MainActor.run {
                self.kokoroSetup.phase = self.isCancellingKokoroSetup ? .cancelled : .failed
                self.kokoroSetup.error = self.isCancellingKokoroSetup ? nil : String(describing: error)
                self.lastError = self.kokoroSetup.error
            }
        }
    }
    kokoroSetupTask = task
    await task.value
    kokoroSetupTask = nil
}

public func cancelKokoroSetup() {
    isCancellingKokoroSetup = true
    kokoroSetupTask?.cancel()
    cli.cancelKokoroSetup()
    kokoroSetup.phase = .cancelled
}

public func retryKokoroSetup() async {
    await installKokoro()
}

public func kokoroSetupDiagnostics() -> String {
    ([kokoroSetup.error].compactMap { $0 } + kokoroSetup.logs).joined(separator: "\n")
}
```

- [ ] **Step 8: Run focused tests and verify pass**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AppModelTests/testInstallKokoro
```

Expected: PASS.

- [ ] **Step 9: Commit AppModel state**

```bash
git add macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/KokoroSetupModelTests.swift
git commit -m "feat: track kokoro setup progress"
```

---

## Task 7: Add temporary macOS Kokoro setup window

**Files:**

- Create: `macos/AgentVoiceApp/Sources/AgentVoiceApp/KokoroSetupProgressView.swift`
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift`
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/SetupAssistantView.swift`
- Create: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/KokoroSetupProgressViewSourceTests.swift`
- Modify: existing Swift source tests as needed.

- [ ] **Step 1: Write failing source tests for window registration**

Create `KokoroSetupProgressViewSourceTests.swift`:

```swift
import XCTest

final class KokoroSetupProgressViewSourceTests: XCTestCase {
    func testApplicationRegistersKokoroSetupWindow() throws {
        let source = try appSource("AgentVoiceApp.swift")
        XCTAssertTrue(source.contains("static let kokoroSetup"))
        XCTAssertTrue(source.contains("Window(\"Installing Kokoro\", id: AgentVoiceWindowID.kokoroSetup)"))
        XCTAssertTrue(source.contains("KokoroSetupProgressView(model: model)"))
    }

    func testSetupAssistantShowsInstallKokoroButton() throws {
        let source = try appSource("SetupAssistantView.swift")
        XCTAssertTrue(source.contains("Install Kokoro"))
        XCTAssertTrue(source.contains("openWindow(id: AgentVoiceWindowID.kokoroSetup)"))
        XCTAssertFalse(source.contains("model.installKokoro()"), "SetupAssistant should only open the setup window; the window owns starting the install to avoid duplicate installers.")
    }

    func testProgressViewHasDiagnosticsControls() throws {
        let source = try appSource("KokoroSetupProgressView.swift")
        XCTAssertTrue(source.contains("Details"))
        XCTAssertTrue(source.contains("Copy Diagnostics"))
        XCTAssertTrue(source.contains("Retry"))
        XCTAssertTrue(source.contains("Cancel"))
        XCTAssertTrue(source.contains("model.cancelKokoroSetup()"))
        XCTAssertTrue(source.contains("KokoroSetupSteps.all"))
    }

    private func appSource(_ fileName: String) throws -> String {
        let packageRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let sourceFile = packageRoot.appendingPathComponent("Sources/AgentVoiceApp/\(fileName)")
        return try String(contentsOf: sourceFile)
    }
}
```

- [ ] **Step 2: Run source tests and verify failure**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter KokoroSetupProgressViewSourceTests
```

Expected: FAIL because window/view/button do not exist.

- [ ] **Step 3: Register window id in `AgentVoiceApp.swift`**

Add:

```swift
enum AgentVoiceWindowID {
    static let dashboard = "dashboard"
    static let setup = "setup"
    static let attention = "attention"
    static let kokoroSetup = "kokoro-setup"
}
```

Add scene:

```swift
Window("Installing Kokoro", id: AgentVoiceWindowID.kokoroSetup) {
    KokoroSetupProgressView(model: model)
}
.defaultSize(width: 620, height: 520)
```

- [ ] **Step 4: Modify `SetupAssistantView.swift`**

Add environment:

```swift
@Environment(\.openWindow) private var openWindow
```

In `.kokoro` step, add disclosure and button:

```swift
Text("Automatic setup installs pinned Python dependencies and Kokoro model files under Agent Voice Home. It requires uv and may download files from the network.")
    .font(.caption)
    .foregroundStyle(.secondary)

Button("Install Kokoro") {
    openWindow(id: AgentVoiceWindowID.kokoroSetup)
}

Do not start `model.installKokoro()` from the Setup Assistant button. The progress window owns starting the install in its `.task` so there is only one start path.
```

Keep existing voice controls and Run Voice Test.

- [ ] **Step 5: Create `KokoroSetupProgressView.swift`**

Implement friendly steps + details:

```swift
import AgentVoiceCore
import AppKit
import SwiftUI

struct KokoroSetupProgressView: View {
    @ObservedObject var model: AppModel
    @State private var showDetails = false
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Installing Kokoro")
                .font(.largeTitle.bold())
                .accessibilityAddTraits(.isHeader)

            Text(model.kokoroSetup.currentTitle ?? statusTitle)
                .font(.headline)

            ProgressView(value: progressValue)
                .accessibilityLabel("Kokoro setup progress")
                .accessibilityValue(statusTitle)

            stepList

            DisclosureGroup("Details", isExpanded: $showDetails) {
                ScrollView {
                    Text(model.kokoroSetupDiagnostics().isEmpty ? "No log output yet." : model.kokoroSetupDiagnostics())
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(minHeight: 120)
            }

            if let error = model.kokoroSetup.error {
                Text(error)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }

            HStack {
                if model.kokoroSetup.phase == .running {
                    Button("Cancel") { model.cancelKokoroSetup() }
                } else {
                    Button("Retry") { Task { await model.retryKokoroSetup() } }
                }
                Button("Copy Diagnostics") { copyDiagnostics() }
                Spacer()
                Button(doneTitle) { NSApp.keyWindow?.close() }
            }
        }
        .padding(24)
        .task {
            if model.kokoroSetup.phase == .idle {
                await model.installKokoro()
            }
        }
    }

    private var statusTitle: String { model.kokoroSetup.phase.rawValue.capitalized }
    private var doneTitle: String { model.kokoroSetup.phase == .succeeded ? "Done" : "Close" }
    private var progressValue: Double { Double(model.kokoroSetup.completedStepIDs.count) / Double(KokoroSetupSteps.all.count) }

    private var stepList: some View {
        VStack(alignment: .leading) {
            ForEach(KokoroSetupSteps.all) { step in
                Text(stepLabel(step.id, title: step.title))
            }
        }
    }

    private func stepLabel(_ id: String, title: String) -> String {
        if model.kokoroSetup.completedStepIDs.contains(id) { return "✓ \(title)" }
        if model.kokoroSetup.failedStepID == id { return "✕ \(title)" }
        if model.kokoroSetup.currentStepID == id { return "● \(title)" }
        return "○ \(title)"
    }

    private func copyDiagnostics() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(model.kokoroSetupDiagnostics(), forType: .string)
        copied = true
    }
}
```

Cancel must call `model.cancelKokoroSetup()` because Task 5 requires true streaming with process cancellation. Do not show a fake Cancel button that only closes the window.

- [ ] **Step 6: Run focused Swift tests and verify pass**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter KokoroSetupProgressViewSourceTests
swift test --package-path macos/AgentVoiceApp --filter AppModelTests/testInstallKokoro
```

Expected: PASS.

- [ ] **Step 7: Commit UI window**

```bash
git add macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift macos/AgentVoiceApp/Sources/AgentVoiceApp/SetupAssistantView.swift macos/AgentVoiceApp/Sources/AgentVoiceApp/KokoroSetupProgressView.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/KokoroSetupProgressViewSourceTests.swift
git commit -m "feat: add kokoro setup window"
```

---

## Task 8: Bundle Kokoro resources into the macOS app bundle

**Files:**

- Modify: `scripts/build-macos-app.sh`
- Modify: `tests/kokoro-setup.test.ts`

- [ ] **Step 1: Write failing build-script source check**

If no build script tests exist, add a source assertion to an existing script test or create a small Bun test:

```ts
test("macOS app build bundles Kokoro resources", () => {
  const script = readFileSync(join(import.meta.dir, "..", "scripts", "build-macos-app.sh"), "utf8");
  expect(script).toContain("resources/kokoro");
  expect(script).toContain("$CLI_DIR/resources");
});

test("kokoro status reports missing bundled resource script", () => {
  const home = tempHome();
  try {
    const paths = resolvePaths({ AGENT_VOICE_HOME: home });
    const status = buildKokoroStatus(paths, { resourceRoot: join(home, "missing-resources") });
    expect(status.resourceScriptExists).toBe(false);
    expect(status.checks.find((check) => check.id === "resourceScript.exists")?.ok).toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
bun test tests/kokoro-setup.test.ts
```

Expected: FAIL if the source check was added there.

- [ ] **Step 3: Update `scripts/build-macos-app.sh`**

Copy resources into the bundled CLI:

```bash
mkdir -p "$CLI_DIR/resources"
cp -R "$ROOT_DIR/resources/kokoro" "$CLI_DIR/resources/kokoro"
```

Place this beside the existing `cp -R "$ROOT_DIR/src" "$CLI_DIR/src"`.

- [ ] **Step 4: Run focused test and app bundle smoke**

Run:

```bash
bun test tests/kokoro-setup.test.ts
bash scripts/build-macos-app.sh
TMP_HOME="$(mktemp -d)"
AGENT_VOICE_HOME="$TMP_HOME" "dist/Agent Voice.app/Contents/Resources/agent-voice/bin/agent-voice" kokoro status --json > /tmp/agent-voice-kokoro-status.json
bun -e 'const s=JSON.parse(await Bun.file("/tmp/agent-voice-kokoro-status.json").text()); if (!s.resourceScriptExists) process.exit(1)'
rm -rf "$TMP_HOME" /tmp/agent-voice-kokoro-status.json
```

Expected: status command runs from bundled CLI and reports `resourceScriptExists: true`, proving bundled resource discovery works.

- [ ] **Step 5: Commit bundle resource copy**

```bash
git add scripts/build-macos-app.sh tests/kokoro-setup.test.ts
git commit -m "feat: bundle kokoro setup resources"
```

---

## Task 9: Update README and user-facing help

**Files:**

- Modify: `README.md`
- Modify: `tests/cli.test.ts` if help assertions need refinement.

- [ ] **Step 1: Update README quick start**

Replace manual-first Kokoro setup with automatic setup:

```bash
./bin/agent-voice kokoro setup
./bin/agent-voice doctor --json
./bin/agent-voice test 'hello'
```

Keep manual override as an advanced path:

```bash
./bin/agent-voice config set tts.kokoroScript /absolute/path/to/kokoro_tts_service.py
./bin/agent-voice config set tts.python python3
```

- [ ] **Step 2: Document prerequisites and disclosures**

Add bullets:

- automatic Kokoro setup requires `uv`,
- setup may download Python packages and Kokoro model files,
- managed files live under `AGENT_VOICE_HOME/kokoro`,
- summarizer privacy/network behavior is separate from Kokoro setup,
- use `summarizer mode heuristic` for local-only summarization.

- [ ] **Step 3: Update troubleshooting**

Add entries:

- `uv` missing,
- dependency install fails,
- model download fails,
- checksum/model verification fails,
- smoke test never emits ready,
- choosing an existing Kokoro script manually.

- [ ] **Step 4: Run docs-relevant checks**

Run:

```bash
rg -n "kokoro setup|uv|AGENT_VOICE_HOME/kokoro|manual" README.md
bun test tests/cli.test.ts
```

Expected: README contains setup docs and CLI tests pass.

- [ ] **Step 5: Commit docs**

```bash
git add README.md tests/cli.test.ts
git commit -m "docs: document kokoro setup"
```

---

## Task 10: Full verification and review handoff

**Files:** all changed files

- [ ] **Step 1: Run full Bun suite**

```bash
bun test
```

Expected: all Bun tests pass or pre-existing failures are documented.

- [ ] **Step 2: Run TypeScript typecheck**

```bash
bun run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Run Swift tests**

```bash
swift test --package-path macos/AgentVoiceApp
```

Expected: exit 0.

- [ ] **Step 4: Run Swift build**

```bash
swift build --package-path macos/AgentVoiceApp
```

Expected: exit 0.

- [ ] **Step 5: Run bundled CLI smoke**

```bash
bash scripts/build-macos-app.sh
TMP_HOME="$(mktemp -d)"
AGENT_VOICE_HOME="$TMP_HOME" "dist/Agent Voice.app/Contents/Resources/agent-voice/bin/agent-voice" kokoro status --json
rm -rf "$TMP_HOME"
```

Expected: bundled CLI can run `kokoro status --json` without missing resources.

- [ ] **Step 6: Optional real setup smoke on a disposable home**

Only run if network and `uv` are available:

```bash
TMP_HOME="$(mktemp -d)"
AGENT_VOICE_HOME="$TMP_HOME" ./bin/agent-voice kokoro setup --jsonl
AGENT_VOICE_HOME="$TMP_HOME" ./bin/agent-voice doctor --json
AGENT_VOICE_HOME="$TMP_HOME" ./bin/agent-voice test 'Agent Voice Kokoro setup works.'
rm -rf "$TMP_HOME"
```

Expected: setup completes, doctor sees script, voice test succeeds. If skipped, document why.

- [ ] **Step 7: Inspect final diff**

```bash
git status --short
git diff --stat HEAD
git diff HEAD -- resources/kokoro src/kokoro-setup.ts src/cli.ts src/config.ts src/doctor.ts macos/AgentVoiceApp README.md scripts/build-macos-app.sh tests
```

Expected: changes match approved scope only.

- [ ] **Step 8: Request implementation review**

Use fresh reviewers for:

- setup correctness/idempotency,
- security/supply-chain/download handling,
- Swift setup UX/state handling,
- docs accuracy.

Do not merge until blockers are fixed or explicitly deferred.
