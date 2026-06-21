# Linux Electron Sibling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Linux Electron sibling app with a Svelte Operator Console, optional Desktop Capsule, shared TypeScript app-service layer, Linux system-tool playback, and preserved CLI/macOS compatibility.

**Architecture:** Refactor UI-facing TypeScript behavior into focused `src/app-service/*` modules consumed by Electron main/preload while keeping CLI contracts stable. Electron renderer is Svelte-only UI behind a narrow preload API; all filesystem/process mutations stay in main/app-service. Linux playback becomes a tested platform abstraction used by the existing TTS path.

**Tech Stack:** Bun, TypeScript, Electron, Svelte, Vite, Vitest, @testing-library/svelte, bun:test for existing core tests, `paplay`/`aplay` Linux playback tools.

---

## Source Inputs

- Approved spec: `docs/superpowers/specs/2026-06-21-linux-electron-sibling-design.md`
- Baseline commands already run in worktree:
  - `bun test` → 346 pass
  - `bun run typecheck` → pass
- Hard constraints:
  - Do not edit Swift/macOS app source files.
  - Preserve public CLI/bin behavior unless this plan explicitly updates tests for compatibility-safe behavior.
  - Hide pause/resume in Linux UI.
  - Linux v1 is dev-build only.
  - Desktop Capsule ships in v1 but is optional/user-enabled and safe-action-only.

## Files and Responsibilities

### Root/config files

- Modify: `package.json`
  - Add Electron/Svelte/Vite/Vitest dev dependencies.
  - Add scripts: `dev:linux`, `build:linux-renderer`, `test:renderer`, `test:electron` if needed.
- Modify: `tsconfig.json`
  - Include new TypeScript files under `linux/electron/**/*.ts` and Svelte support config if needed.
- Create: `linux/electron/tsconfig.json`
  - Electron/preload/renderer TypeScript settings if root config becomes too broad.
- Create: `linux/electron/vite.config.ts`
  - Svelte renderer Vite configuration.
- Create: `linux/electron/index.html`
- Create: `linux/electron/dev-runner.ts`
  - Renderer host page.

### Shared service and platform files

- Create: `src/platform/playback.ts`
  - Detect playback backend (`paplay`, `aplay`, macOS `afplay`) and execute WAV playback using arg arrays.
- Modify: `src/tts.ts`
  - Delegate playback command selection/execution to `src/platform/playback.ts`.
- Create: `src/app-service/types.ts`
  - Domain result/error types and shared UI-safe method types.
- Create: `src/app-service/config-service.ts`
  - Config read/update, safe patching, Desktop Capsule setting helpers.
- Create: `src/app-service/status-service.ts`
  - UI status snapshot and degraded first-run priority mapping.
- Create: `src/app-service/daemon-service.ts`
  - Start/stop daemon wrappers, already-running/stale handling, typed daemon errors.
- Create: `src/app-service/history-service.ts`
  - History list wrapper, clear active/failed, failed detail helpers.
- Create: `src/app-service/voice-service.ts`
  - Voice Test and Speak Latest replay behavior.
- Create: `src/app-service/kokoro-service.ts`
  - Kokoro status/setup stream adapter, consent token/session handling, cancel state.
- Create: `src/app-service/hook-service.ts`
  - Hook state/install/uninstall UI-safe wrapper.
- Create: `src/app-service/diagnostics-service.ts`
  - Doctor/snapshot aggregation, redaction/truncation/preview payloads.
- Create: `src/app-service/index.ts`
  - Public app-service export surface consumed by Electron.

### Electron files

- Create: `linux/electron/main.ts`
  - BrowserWindow lifecycle, capsule window lifecycle, app-service IPC handlers.
- Create: `linux/electron/preload.ts`
  - Narrow typed `window.agentVoice` API.
- Create: `linux/electron/ipc-contract.ts`
  - Shared channel names, request/response types, renderer-safe API definitions.
- Create: `linux/electron/dev.ts` or `linux/electron/main-dev.ts` if needed
  - Dev boot path for Vite renderer URL.

### Svelte renderer files

- Create: `linux/electron/renderer/src/main.ts`
- Create: `linux/electron/renderer/src/App.svelte`
- Create: `linux/electron/renderer/src/app.css`
- Create: `linux/electron/renderer/src/lib/api.ts`
- Create: `linux/electron/renderer/src/lib/test-api-mock.ts`
- Create: `linux/electron/renderer/src/lib/types.ts`
- Create: `linux/electron/renderer/src/lib/stores.ts`
- Create: `linux/electron/renderer/src/components/OperatorRail.svelte`
- Create: `linux/electron/renderer/src/components/StatusBadge.svelte`
- Create: `linux/electron/renderer/src/components/ConfirmDialog.svelte`
- Create: `linux/electron/renderer/src/components/PrivacyLabel.svelte`
- Create: `linux/electron/renderer/src/routes/HomeSignalFeed.svelte`
- Create: `linux/electron/renderer/src/routes/VoiceBench.svelte`
- Create: `linux/electron/renderer/src/routes/QueueHistory.svelte`
- Create: `linux/electron/renderer/src/routes/SetupRepair.svelte`
- Create: `linux/electron/renderer/src/routes/HooksPanel.svelte`
- Create: `linux/electron/renderer/src/routes/DiagnosticsPanel.svelte`
- Create: `linux/electron/renderer/src/routes/SettingsPanel.svelte`
- Create: `linux/electron/renderer/src/capsule/CapsuleApp.svelte`

### Tests

- Create: `tests/playback.test.ts`
- Create: `tests/app-service/config-service.test.ts`
- Create: `tests/app-service/status-service.test.ts`
- Create: `tests/app-service/daemon-service.test.ts`
- Create: `tests/app-service/history-service.test.ts`
- Create: `tests/app-service/voice-service.test.ts`
- Create: `tests/app-service/kokoro-service.test.ts`
- Create: `tests/app-service/hook-service.test.ts`
- Create: `tests/app-service/diagnostics-service.test.ts`
- Create: `tests/electron/preload-contract.test.ts`
- Create: `tests/electron/main-security.test.ts`
- Create: `tests/electron/setup-session-ipc.test.ts`
- Create: `tests/electron/capsule-lifecycle.test.ts`
- Create: `linux/electron/renderer/src/**/*.test.ts` or `tests/renderer/*.test.ts` depending on Vitest config.
- Modify existing tests only when refactors require import path updates; do not weaken coverage.

---


## Plan-Gate Decisions from Challenge

The plan challenge surfaced three product/engineering choices. Use these defaults unless the user explicitly changes them before implementation:

1. **Kokoro cancellation:** v1 uses honest best-effort cancel. The UI may request cancellation and stop listening to the current setup stream, but deeper subprocess abort support is deferred unless a task explicitly adds abort-signal support to `kokoro/commands` and proves it with tests.
2. **Capsule privacy/provider behavior:** if the latest eligible summary was provider-backed or the summarizer privacy state changed since the capsule was enabled, capsule `Speak Latest` opens/focuses the Operator Console privacy context instead of speaking immediately. Local heuristic stored summaries can be replayed directly.
3. **Dependency policy:** choose Svelte 5 explicitly and use Svelte 5 `mount` syntax. Use the lockfile as the exact version source after `bun install`; avoid open-ended Svelte syntax assumptions. Add `svelte-check` validation for `.svelte` files because root `tsc` does not validate Svelte templates.

---

## Milestone 0: CLI/Mac Compatibility Inventory

### Task 0: Create compatibility inventory before refactors

**Files:**
- Create: `docs/superpowers/plans/2026-06-21-linux-electron-compatibility-inventory.md`
- No source files modified.

- [ ] **Step 1: Write the inventory document**

Create `docs/superpowers/plans/2026-06-21-linux-electron-compatibility-inventory.md` with this structure:

```markdown
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

## Compatibility rule

Every refactor task must run its focused tests plus any affected authoritative tests. Full `bun test` remains the final compatibility gate.

## Exit-code/stdout-stderr surfaces to preserve

Document the commands from the approved spec’s CLI Compatibility Contract and the expected stdout/stderr/exit-code style before modifying CLI internals.
```

- [ ] **Step 2: Verify no source changes**

Run: `git diff --name-only -- src package.json tsconfig.json linux/electron tests`

Expected: no output for source/test/tooling files from this task.

- [ ] **Step 3: Commit**

```bash
git add -f docs/superpowers/plans/2026-06-21-linux-electron-compatibility-inventory.md
git commit -m "docs: inventory cli compatibility surfaces"
```

---
## Milestone 1: Tooling and Skeleton

### Task 1: Add Electron/Svelte/Vite dev tooling

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `linux/electron/vite.config.ts`
- Create: `linux/electron/index.html`
- Create: `linux/electron/dev-runner.ts`
- Create: `linux/electron/renderer/src/main.ts`
- Create: `linux/electron/renderer/src/App.svelte`
- Create: `linux/electron/renderer/src/app.css`
- Test: `tests/electron/package-scripts.test.ts`

- [ ] **Step 1: Write the failing package/scripts test**

Create `tests/electron/package-scripts.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const tsconfig = JSON.parse(readFileSync("tsconfig.json", "utf8"));

describe("linux electron tooling", () => {
  test("package exposes linux electron dev/test scripts", () => {
    expect(pkg.scripts["dev:linux"]).toContain("linux/electron/dev-runner.ts");
    expect(pkg.scripts["dev:linux"]).toContain("electron");
    expect(pkg.scripts["build:linux-renderer"]).toContain("vite");
    expect(pkg.scripts["test:renderer"]).toContain("vitest");
    expect(pkg.scripts["check:renderer"]).toContain("svelte-check");
  });

  test("typecheck includes linux electron TypeScript files", () => {
    expect(tsconfig.include).toContain("linux/electron/**/*.ts");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `bun test tests/electron/package-scripts.test.ts`

Expected: FAIL because scripts/includes do not exist.

- [ ] **Step 3: Add dev dependencies and scripts**

Update `package.json` dev dependencies:

```json
{
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "latest",
    "@testing-library/svelte": "latest",
    "@testing-library/jest-dom": "latest",
    "@types/node": "latest",
    "bun-types": "latest",
    "electron": "latest",
    "jsdom": "latest",
    "svelte": "^5.0.0",
    "svelte-check": "latest",
    "typescript": "latest",
    "vite": "latest",
    "vitest": "latest"
  }
}
```

Add scripts:

```json
{
  "scripts": {
    "dev:linux": "bun linux/electron/dev-runner.ts",
    "build:linux-renderer": "vite build --config linux/electron/vite.config.ts",
    "test:renderer": "vitest run --config linux/electron/vite.config.ts",
    "check:renderer": "svelte-check --tsconfig linux/electron/tsconfig.json"
  }
}
```

Task 1 must add a minimal dev runner that starts Vite and Electron, even if Electron only loads the placeholder shell. Later tasks expand IPC and app-service wiring.

- [ ] **Step 4: Update TypeScript include**

Add to `tsconfig.json`:

```json
"include": ["src/**/*.ts", "tests/**/*.ts", "linux/electron/**/*.ts"]
```

- [ ] **Step 5: Add minimal Svelte/Vite skeleton**

`linux/electron/vite.config.ts`:

```ts
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  root: "linux/electron",
  plugins: [svelte()],
  test: {
    environment: "jsdom",
    include: ["renderer/src/**/*.test.ts"],
    setupFiles: ["renderer/src/test-setup.ts"],
  },
  build: {
    outDir: "../../dist/linux-renderer",
    emptyOutDir: true,
  },
});
```

`linux/electron/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agent Voice</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/renderer/src/main.ts"></script>
  </body>
</html>
```

`linux/electron/renderer/src/main.ts`:

```ts
import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";

const app = mount(App, { target: document.getElementById("app")! });

export default app;
```

`linux/electron/renderer/src/App.svelte`:

```svelte
<script lang="ts">
  const title = "Agent Voice Operator Console";
</script>

<main class="app-shell">
  <h1>{title}</h1>
  <p>Linux Electron sibling dev shell.</p>
</main>
```

`linux/electron/renderer/src/test-setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

`linux/electron/dev-runner.ts` minimal initial runner:

```ts
import { spawn } from "node:child_process";

const vite = spawn("bun", ["x", "vite", "--config", "linux/electron/vite.config.ts", "--host", "127.0.0.1"], { stdio: "inherit" });
const electron = spawn("bun", ["x", "electron", "linux/electron/main.ts"], { stdio: "inherit", env: { ...process.env, AGENT_VOICE_RENDERER_URL: "http://127.0.0.1:5173" } });

function shutdown() {
  vite.kill();
  electron.kill();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

This runner may be refined once `main.ts` exists, but the `dev:linux` script must remain an Electron launch path, not renderer-only.

- [ ] **Step 6: Run focused tests**

Run:

```bash
bun install
bun test tests/electron/package-scripts.test.ts
bun run build:linux-renderer
bun run check:renderer
bun run typecheck
```

Expected: scripts test PASS, renderer build PASS, typecheck PASS.

- [ ] **Step 10: Commit**

```bash
git add package.json bun.lock tsconfig.json linux/electron tests/electron/package-scripts.test.ts
git commit -m "build: scaffold linux electron renderer"
```

---

## Milestone 2: Linux Playback Foundation

### Task 2: Extract playback backend detection and preserve macOS playback behavior

**Files:**
- Create: `src/platform/playback.ts`
- Modify: `src/tts.ts`
- Modify: `tests/tts.test.ts`
- Test: `tests/playback.test.ts`

- [ ] **Step 1: Write failing playback detection tests**

Create `tests/playback.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  detectPlaybackBackend,
  playbackCommandForPlatform,
  limitPlaybackDiagnostic,
  type CommandExists,
} from "../src/platform/playback";

function exists(names: string[]): CommandExists {
  return async (name) => names.includes(name);
}

describe("playback backend detection", () => {
  test("linux prefers paplay before aplay", async () => {
    const backend = await detectPlaybackBackend({ platform: "linux", commandExists: exists(["aplay", "paplay"]) });
    expect(backend).toEqual({ kind: "tool", name: "paplay", command: "paplay" });
  });

  test("linux falls back to aplay", async () => {
    const backend = await detectPlaybackBackend({ platform: "linux", commandExists: exists(["aplay"]) });
    expect(backend).toEqual({ kind: "tool", name: "aplay", command: "aplay" });
  });

  test("linux reports missing backend", async () => {
    const backend = await detectPlaybackBackend({ platform: "linux", commandExists: exists([]) });
    expect(backend.kind).toBe("missing");
    if (backend.kind === "missing") expect(backend.checked).toEqual(["paplay", "aplay"]);
  });

  test("darwin preserves afplay", async () => {
    const backend = await detectPlaybackBackend({ platform: "darwin", commandExists: exists(["afplay"]) });
    expect(backend).toEqual({ kind: "tool", name: "afplay", command: "afplay" });
  });

  test("bounds diagnostic output", () => {
    const text = "x".repeat(5000);
    expect(limitPlaybackDiagnostic(text, 100)).toHaveLength(103);
  });

  test("builds command args without shell", () => {
    expect(playbackCommandForPlatform("paplay", "/tmp/a.wav")).toEqual({ cmd: "paplay", args: ["/tmp/a.wav"] });
    expect(playbackCommandForPlatform("aplay", "/tmp/a.wav")).toEqual({ cmd: "aplay", args: ["/tmp/a.wav"] });
    expect(playbackCommandForPlatform("afplay", "/tmp/a.wav")).toEqual({ cmd: "afplay", args: ["/tmp/a.wav"] });
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `bun test tests/playback.test.ts`

Expected: FAIL because `src/platform/playback.ts` does not exist.

- [ ] **Step 3: Implement platform playback module**

Create `src/platform/playback.ts`:

```ts
import { spawn } from "node:child_process";

export type PlaybackToolName = "afplay" | "paplay" | "aplay";

export type PlaybackBackend =
  | { kind: "tool"; name: PlaybackToolName; command: string }
  | { kind: "missing"; checked: PlaybackToolName[]; message: string };

export type CommandExists = (command: string) => Promise<boolean>;

export function limitPlaybackDiagnostic(text = "", max = 4000): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export interface DetectPlaybackOptions {
  platform?: NodeJS.Platform;
  commandExists?: CommandExists;
}

export async function defaultCommandExists(command: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawn("/usr/bin/env", ["which", command], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

export async function detectPlaybackBackend(
  options: DetectPlaybackOptions = {},
): Promise<PlaybackBackend> {
  const platform = options.platform ?? process.platform;
  const commandExists = options.commandExists ?? defaultCommandExists;
  const candidates: PlaybackToolName[] = platform === "linux" ? ["paplay", "aplay"] : ["afplay"];

  for (const name of candidates) {
    if (await commandExists(name)) return { kind: "tool", name, command: name };
  }

  return {
    kind: "missing",
    checked: candidates,
    message: `No supported audio playback tool found (${candidates.join(", ")})`,
  };
}

export function playbackCommandForPlatform(
  tool: PlaybackToolName,
  wavPath: string,
): { cmd: string; args: string[] } {
  return { cmd: tool, args: [wavPath] };
}
```

- [ ] **Step 4: Modify `playWav` to use detection**

Update `src/tts.ts`:

```ts
import {
  detectPlaybackBackend,
  playbackCommandForPlatform,
  type CommandExists,
} from "./platform/playback";
```

Extend `PlayWavOptions`:

```ts
export interface PlayWavOptions {
  timeoutMs?: number;
  platform?: NodeJS.Platform;
  commandExists?: CommandExists;
}
```

Replace hardcoded `afplay` request with:

```ts
const backend = await detectPlaybackBackend({
  platform: options.platform,
  commandExists: options.commandExists,
});
if (backend.kind === "missing") throw new Error(backend.message);
const command = playbackCommandForPlatform(backend.name, wavPath);
const result = await runner({
  ...command,
  timeoutMs: options.timeoutMs ?? DEFAULT_PLAYBACK_TIMEOUT_MS,
});
if (!result.ok) {
  throw new Error(
    `${backend.name} failed${result.stderr ? `: ${result.stderr}` : ""}`,
  );
}
```

Also update timeout text in `defaultPlaybackRunner` so it does not hardcode `afplay timed out`; use `${request.cmd} timed out`. Apply `limitPlaybackDiagnostic` to stdout/stderr returned by the runner so diagnostics are bounded.

- [ ] **Step 5: Update existing TTS tests**

In `tests/tts.test.ts`, update tests to pass macOS commandExists/platform for old `afplay` expectations:

```ts
await playWav(buffer, paths, runner, {
  platform: "darwin",
  commandExists: async (command) => command === "afplay",
});
```

Add Linux and cleanup tests:

```ts
test("playWav uses paplay on Linux when available", async () => {
  const calls: unknown[] = [];
  await playWav(Buffer.from("wav"), paths, async (request) => {
    calls.push(request);
    return { ok: true };
  }, { platform: "linux", commandExists: async (command) => command === "paplay" });
  expect(calls).toEqual([expect.objectContaining({ cmd: "paplay" })]);
});

test("playWav deletes temp wav after Linux playback failure", async () => {
  await expect(playWav(Buffer.from("wav"), paths, async () => ({ ok: false, stderr: "no device" }), {
    platform: "linux",
    commandExists: async (command) => command === "paplay",
  })).rejects.toThrow("paplay failed");
  expect(readdirSync(join(paths.run, "audio"))).toHaveLength(0);
});
```

Import `readdirSync`/`join` in `tests/tts.test.ts` if not already available.

- [ ] **Step 6: Run focused tests**

Run:

```bash
bun test tests/playback.test.ts tests/tts.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/platform/playback.ts src/tts.ts tests/playback.test.ts tests/tts.test.ts
git commit -m "feat: add cross-platform playback detection"
```

---

## Milestone 3: Shared App-Service Core

### Task 3: Add app-service types and capsule config setting

**Files:**
- Create: `src/app-service/types.ts`
- Create: `src/app-service/config-service.ts`
- Create: `src/app-service/index.ts`
- Modify: `src/config.ts`
- Test: `tests/app-service/config-service.test.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Write failing config-service tests**

Create `tests/app-service/config-service.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolvePaths } from "../../src/paths";
import {
  getAppConfig,
  setCapsuleEnabled,
  updateSummarizerSettings,
} from "../../src/app-service/config-service";

function tempPaths() {
  const home = mkdtempSync(join(tmpdir(), "agent-voice-app-service-"));
  return { home, paths: resolvePaths({ AGENT_VOICE_HOME: home }) };
}

describe("app-service config", () => {
  test("capsule defaults disabled and persists enabled", () => {
    const { home, paths } = tempPaths();
    try {
      expect(getAppConfig(paths).ui.desktopCapsule.enabled).toBe(false);
      setCapsuleEnabled(paths, true);
      expect(getAppConfig(paths).ui.desktopCapsule.enabled).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("summarizer patch updates safe keys only", () => {
    const { home, paths } = tempPaths();
    try {
      updateSummarizerSettings(paths, { thinking: "low", mode: "heuristic" });
      const config = getAppConfig(paths);
      expect(config.summarizer.thinking).toBe("low");
      expect(config.summarizer.priority).toEqual(["heuristic"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `bun test tests/app-service/config-service.test.ts`

Expected: FAIL because app-service modules and config field do not exist.

- [ ] **Step 3: Extend config schema without breaking old configs**

Modify `src/config.ts`:

```ts
export interface AgentVoiceConfig {
  // existing fields...
  ui: {
    desktopCapsule: {
      enabled: boolean;
    };
  };
}
```

Add default:

```ts
ui: {
  desktopCapsule: { enabled: false },
},
```

Validate:

```ts
if (!isRecord(config.ui)) invalidConfig("ui", "object");
if (!isRecord(config.ui.desktopCapsule)) invalidConfig("ui.desktopCapsule", "object");
assertBoolean(config.ui.desktopCapsule.enabled, "ui.desktopCapsule.enabled");
```

Ensure `loadConfig` merge continues to fill missing `ui` for older config files.

- [ ] **Step 4: Add app-service types**

`src/app-service/types.ts`:

```ts
export interface AppServiceError {
  code: string;
  message: string;
  details?: unknown;
  recoverable: boolean;
}

export type AppResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppServiceError };

export function appError(
  code: string,
  message: string,
  options: { details?: unknown; recoverable?: boolean } = {},
): AppServiceError {
  return {
    code,
    message,
    ...(options.details === undefined ? {} : { details: options.details }),
    recoverable: options.recoverable ?? true,
  };
}
```

- [ ] **Step 5: Add config service**

`src/app-service/config-service.ts`:

```ts
import { loadConfig, saveConfig, setConfigValue, type AgentVoiceConfig, type SummarizerThinking } from "../config";
import { setSummarizerMode, type SummarizerMode } from "../summarizer-mode";
import type { AgentVoicePaths } from "../paths";

export type AppConfig = AgentVoiceConfig;

export function getAppConfig(paths: AgentVoicePaths): AppConfig {
  return loadConfig(paths, { createIfMissing: false });
}

export function setCapsuleEnabled(paths: AgentVoicePaths, enabled: boolean): AppConfig {
  const config = loadConfig(paths);
  config.ui.desktopCapsule.enabled = enabled;
  saveConfig(paths, config);
  return config;
}

export function updateSummarizerSettings(
  paths: AgentVoicePaths,
  patch: { mode?: SummarizerMode; thinking?: SummarizerThinking; model?: string },
): AppConfig {
  let config = loadConfig(paths);
  if (patch.mode) config = setSummarizerMode(config, patch.mode);
  if (patch.thinking) config = setConfigValue(config, "summarizer.thinking", patch.thinking);
  if (patch.model) config = setConfigValue(config, "summarizer.piModel", patch.model);
  saveConfig(paths, config);
  return loadConfig(paths, { createIfMissing: false });
}
```

If `SummarizerMode` is not exported from `summarizer-mode.ts`, export it or inline a local union matching existing implementation.

- [ ] **Step 6: Export app-service**

`src/app-service/index.ts`:

```ts
export * from "./types";
export * from "./config-service";
```

- [ ] **Step 7: Run tests**

Run:

```bash
bun test tests/app-service/config-service.test.ts tests/config.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/config.ts src/app-service tests/app-service/config-service.test.ts tests/config.test.ts
git commit -m "feat: add app service config foundation"
```

---

### Task 4: Add daemon app service before IPC

**Files:**
- Create: `src/app-service/daemon-service.ts`
- Modify: `src/app-service/index.ts`
- Test: `tests/app-service/daemon-service.test.ts`

- [ ] **Step 1: Write failing daemon-service tests**

Create `tests/app-service/daemon-service.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolvePaths } from "../../src/paths";
import { startDaemonService, stopDaemonService } from "../../src/app-service/daemon-service";

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "agent-voice-daemon-service-"));
  return { home, paths: resolvePaths({ AGENT_VOICE_HOME: home }) };
}

describe("daemon service", () => {
  test("returns typed start failure", async () => {
    const { home, paths } = fixture();
    try {
      const result = await startDaemonService(paths, {
        startBackground: () => { throw new Error("boom"); },
        isPidAlive: () => false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("daemon_start_failed");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("returns stop result without exposing process primitives", async () => {
    const { home, paths } = fixture();
    try {
      const result = await stopDaemonService(paths, { stopProcess: async () => undefined, isPidAlive: () => false });
      expect(result.ok).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `bun test tests/app-service/daemon-service.test.ts`

Expected: FAIL because `daemon-service.ts` does not exist.

- [ ] **Step 3: Implement daemon service**

`src/app-service/daemon-service.ts`:

```ts
import { startDaemon, stopDaemon, getDaemonStatus, type DaemonCliDeps } from "../daemon";
import type { AgentVoicePaths } from "../paths";
import { appError, type AppResult } from "./types";

export interface DaemonActionResult {
  running: boolean;
  pid: number | null;
}

export async function startDaemonService(
  paths: AgentVoicePaths,
  deps: DaemonCliDeps = {},
): Promise<AppResult<DaemonActionResult>> {
  try {
    await startDaemon(paths, deps);
    const status = getDaemonStatus(paths, deps, { readOnly: true });
    return { ok: true, value: { running: status.running, pid: status.pid } };
  } catch (error) {
    return { ok: false, error: appError("daemon_start_failed", error instanceof Error ? error.message : String(error)) };
  }
}

export async function stopDaemonService(
  paths: AgentVoicePaths,
  deps: DaemonCliDeps = {},
): Promise<AppResult<DaemonActionResult>> {
  try {
    await stopDaemon(paths, deps);
    const status = getDaemonStatus(paths, deps, { readOnly: true });
    return { ok: true, value: { running: status.running, pid: status.pid } };
  } catch (error) {
    return { ok: false, error: appError("daemon_stop_failed", error instanceof Error ? error.message : String(error)) };
  }
}
```

Adjust to current `startDaemon`/`stopDaemon` return signatures if needed; tests are authoritative.

- [ ] **Step 4: Export and run focused tests**

```bash
bun test tests/app-service/daemon-service.test.ts tests/daemon-cli.test.ts tests/integration-daemon.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app-service/daemon-service.ts src/app-service/index.ts tests/app-service/daemon-service.test.ts
git commit -m "feat: add daemon app service"
```

---

### Task 5: Add status, history, queue, and degraded-state app services

**Files:**
- Create: `src/app-service/status-service.ts`
- Create: `src/app-service/history-service.ts`
- Modify: `src/app-service/index.ts`
- Test: `tests/app-service/status-service.test.ts`
- Test: `tests/app-service/history-service.test.ts`

- [ ] **Step 1: Write failing status-service tests**

Create `tests/app-service/status-service.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { composeStatusSnapshot } from "../../src/status";
import { deriveFirstRunActions } from "../../src/app-service/status-service";

const install = { claude: "not_installed", codex: "not_installed", pi: "not_installed", opencode: "not_installed" } as const;
const paths = { home: "/tmp/av", config: "/tmp/av/config.json", db: "/tmp/av/queue.db" };

describe("status service", () => {
  test("prioritizes missing playback before setup and daemon", () => {
    const status = composeStatusSnapshot({
      buildId: null,
      daemon: { running: false, pid: null },
      queues: { pending: 0, processing: 0, done: 0, failed: 0, skipped: 0 },
      config: { enabled: true, agents: { claude: { enabled: true, mode: "native" }, codex: { enabled: true, mode: "native" }, pi: { enabled: true, mode: "native" }, opencode: { enabled: true, mode: "native" } } },
      install,
      paths,
    });
    const actions = deriveFirstRunActions(status, { playbackReady: false, kokoroReady: false });
    expect(actions[0].id).toBe("install-playback-tool");
  });
});
```

- [ ] **Step 2: Write failing history-service tests**

Create `tests/app-service/history-service.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolvePaths } from "../../src/paths";
import { openDb } from "../../src/db";
import { enqueue, markFailed } from "../../src/store";
import { listHistory, clearActive, clearFailed } from "../../src/app-service/history-service";
import { createEvent } from "../../src/events";

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "agent-voice-history-service-"));
  const paths = resolvePaths({ AGENT_VOICE_HOME: home });
  const db = openDb(paths.db);
  return { home, paths, db };
}

describe("history service", () => {
  test("lists terminal jobs and clears failed separately", () => {
    const { home, paths, db } = fixture();
    try {
      const failed = createEvent({ agent: "pi", text: "bad" });
      enqueue(db, failed);
      markFailed(db, failed.id, new Date(), "boom");
      expect(listHistory(paths, { limit: 10 }).jobs[0].lastError).toBe("boom");
      expect(clearFailed(paths).cleared).toBe(1);
      expect(listHistory(paths, { limit: 10 }).jobs).toHaveLength(0);
    } finally {
      db.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run failing tests**

Run: `bun test tests/app-service/status-service.test.ts tests/app-service/history-service.test.ts`

Expected: FAIL because service modules do not exist.

- [ ] **Step 4: Implement status service**

`src/app-service/status-service.ts`:

```ts
import { buildAppStatusSnapshot, type AppStatusSnapshot } from "../status";
import type { AgentVoicePaths } from "../paths";

export interface FirstRunProbeState {
  playbackReady: boolean;
  kokoroReady: boolean;
}

export interface FirstRunAction {
  id: string;
  title: string;
  detail: string;
  cta: string;
}

export function getAppStatus(paths: AgentVoicePaths): AppStatusSnapshot {
  return buildAppStatusSnapshot(paths);
}

export function deriveFirstRunActions(
  status: AppStatusSnapshot,
  probes: FirstRunProbeState,
): FirstRunAction[] {
  const actions: FirstRunAction[] = [];
  if (!probes.playbackReady) actions.push({ id: "install-playback-tool", title: "Install a Linux audio playback tool", detail: "Agent Voice needs paplay or aplay for voice output.", cta: "Open diagnostics" });
  if (!probes.kokoroReady) actions.push({ id: "setup-kokoro", title: "Set up Kokoro voice", detail: "Local voice requires managed Kokoro setup.", cta: "Open setup" });
  if (status.daemon.state !== "running") actions.push({ id: "start-daemon", title: "Start the daemon", detail: "The daemon processes queued agent summaries.", cta: "Start daemon" });
  if (Object.values(status.install).some((state) => state !== "installed")) actions.push({ id: "install-hooks", title: "Install agent hooks", detail: "Hooks enqueue agent summaries automatically.", cta: "Open hooks" });
  actions.push({ id: "review-privacy", title: "Review summarizer privacy", detail: "Provider-backed summaries may call external CLIs.", cta: "Open Voice Bench" });
  return actions;
}
```

- [ ] **Step 5: Implement history service**

`src/app-service/history-service.ts`:

```ts
import { buildHistorySnapshot, decodeHistoryCursor, type AppHistorySnapshot } from "../history";
import { openDb } from "../db";
import { clearActiveQueue, clearFailedJobs } from "../store";
import type { AgentVoicePaths } from "../paths";

export function listHistory(
  paths: AgentVoicePaths,
  options: { limit?: number; cursor?: string } = {},
): AppHistorySnapshot {
  const cursor = options.cursor ? decodeHistoryCursor(options.cursor) : undefined;
  if (options.cursor && !cursor) throw new Error("Invalid history cursor");
  return buildHistorySnapshot(paths, options.limit ?? 50, cursor ?? undefined);
}

export function clearActive(paths: AgentVoicePaths): { cleared: number } {
  const db = openDb(paths.db);
  try {
    return { cleared: clearActiveQueue(db) };
  } finally {
    db.close();
  }
}

export function clearFailed(paths: AgentVoicePaths): { cleared: number } {
  const db = openDb(paths.db);
  try {
    return { cleared: clearFailedJobs(db) };
  } finally {
    db.close();
  }
}
```

- [ ] **Step 6: Export services and run tests**

Update `src/app-service/index.ts`:

```ts
export * from "./status-service";
export * from "./history-service";
```

Run:

```bash
bun test tests/app-service/status-service.test.ts tests/app-service/history-service.test.ts tests/status-json.test.ts tests/history-json.test.ts tests/store.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/app-service tests/app-service
git commit -m "feat: add status and history app services"
```

---

### Task 6: Add Voice Test and Speak Latest app service

**Files:**
- Create: `src/app-service/voice-service.ts`
- Modify: `src/app-service/index.ts`
- Test: `tests/app-service/voice-service.test.ts`

- [ ] **Step 1: Write failing voice-service tests**

Create `tests/app-service/voice-service.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolvePaths } from "../../src/paths";
import { openDb } from "../../src/db";
import { createEvent } from "../../src/events";
import { claimNextDue, enqueue, markDone, markFailed, markSkipped, markSpoken } from "../../src/store";
import { defaultConfig } from "../../src/config";
import { findLatestSpeakableSummary, speakLatest } from "../../src/app-service/voice-service";

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "agent-voice-voice-service-"));
  const paths = resolvePaths({ AGENT_VOICE_HOME: home });
  const db = openDb(paths.db);
  return { home, paths, db };
}

describe("voice service", () => {
  test("selects newest done summary and ignores failed jobs", () => {
    const { home, paths, db } = fixture();
    try {
      const failed = createEvent({ agent: "pi", text: "failed" });
      enqueue(db, failed);
      markFailed(db, failed.id, new Date(), "boom");
      const done = createEvent({ agent: "pi", text: "done" });
      enqueue(db, done);
      markSpoken(db, done.id, "Finished auth refactor.", "heuristic");
      markDone(db, done.id);
      expect(findLatestSpeakableSummary(paths)?.summary).toBe("Finished auth refactor.");
    } finally {
      db.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("ignores skipped pending and processing rows", () => {
    const { home, paths, db } = fixture();
    try {
      const processing = createEvent({ agent: "pi", text: "processing" });
      enqueue(db, processing);
      const claimed = claimNextDue(db, defaultConfig);
      expect(claimed?.id).toBe(processing.id);
      markSpoken(db, processing.id, "Processing summary should not replay.", "heuristic");

      const pending = createEvent({ agent: "pi", text: "pending" });
      enqueue(db, pending);
      markSpoken(db, pending.id, "Pending summary should not replay.", "heuristic");

      const skipped = createEvent({ agent: "pi", text: "skipped" });
      enqueue(db, skipped);
      markSpoken(db, skipped.id, "Skipped summary should not replay.", "heuristic");
      markSkipped(db, skipped.id, "disabled_system");

      expect(findLatestSpeakableSummary(paths)).toBe(null);
    } finally {
      db.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("speakLatest does not invoke summarizer providers", async () => {
    const { home, paths, db } = fixture();
    try {
      const done = createEvent({ agent: "pi", text: "raw provider text" });
      enqueue(db, done);
      markSpoken(db, done.id, "Stored summary only.", "pi-fast");
      markDone(db, done.id);
      let played = "";
      const result = await speakLatest(paths, { synthesizeAndPlay: async (text) => { played = text; } });
      expect(result.ok).toBe(true);
      expect(played).toBe("Stored summary only.");
    } finally {
      db.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("speakLatest preserves missing playback backend diagnostic", async () => {
    const { home, paths, db } = fixture();
    try {
      const done = createEvent({ agent: "pi", text: "done" });
      enqueue(db, done);
      markSpoken(db, done.id, "Stored summary.", "heuristic");
      markDone(db, done.id);
      const result = await speakLatest(paths, { synthesizeAndPlay: async () => { throw Object.assign(new Error("No supported audio playback tool found (paplay, aplay)"), { code: "playback_backend_missing" }); } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("playback_backend_missing");
    } finally {
      db.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("speakLatest returns typed empty error when no summary exists", async () => {
    const { home, paths, db } = fixture();
    try {
      const result = await speakLatest(paths, {
        synthesizeAndPlay: async () => { throw new Error("should not play"); },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("no_latest_summary");
    } finally {
      db.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `bun test tests/app-service/voice-service.test.ts`

Expected: FAIL because `voice-service.ts` does not exist.

- [ ] **Step 3: Implement voice service**

`src/app-service/voice-service.ts`:

```ts
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { loadConfig } from "../config";
import { KokoroClient, playWav } from "../tts";
import type { AgentVoicePaths } from "../paths";
import { appError, type AppResult } from "./types";

export interface SpeakableSummary {
  jobId: string;
  summary: string;
  summarizerUsed?: string;
  finishedAt?: string;
}

export interface VoiceServiceDeps {
  synthesizeAndPlay?: (text: string) => Promise<void>;
}

export function findLatestSpeakableSummary(paths: AgentVoicePaths): SpeakableSummary | null {
  if (!existsSync(paths.db)) return null;
  const db = new Database(paths.db, { readonly: true });
  try {
    const row = db.query(`SELECT id, summary, summarizer_used, finished_at
      FROM jobs
      WHERE status = 'done' AND summary IS NOT NULL AND TRIM(summary) != ''
      ORDER BY COALESCE(finished_at, created_at) DESC, created_at DESC, id DESC
      LIMIT 1`).get() as { id: string; summary: string; summarizer_used: string | null; finished_at: string | null } | null;
    if (!row) return null;
    return {
      jobId: row.id,
      summary: row.summary,
      ...(row.summarizer_used ? { summarizerUsed: row.summarizer_used } : {}),
      ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    };
  } finally {
    db.close();
  }
}

async function defaultSynthesizeAndPlay(paths: AgentVoicePaths, text: string): Promise<void> {
  const config = loadConfig(paths, { createIfMissing: false });
  const client = new KokoroClient(config);
  try {
    const audio = await client.speak(text, config.tts.voice);
    await playWav(audio, paths, undefined, { timeoutMs: config.tts.timeoutSeconds * 1000 });
  } finally {
    client.dispose();
  }
}

export async function speakLatest(
  paths: AgentVoicePaths,
  deps: VoiceServiceDeps = {},
): Promise<AppResult<SpeakableSummary>> {
  const latest = findLatestSpeakableSummary(paths);
  if (!latest) {
    return { ok: false, error: appError("no_latest_summary", "No spoken summary is available yet.") };
  }
  try {
    await (deps.synthesizeAndPlay ?? ((text) => defaultSynthesizeAndPlay(paths, text)))(latest.summary);
    return { ok: true, value: latest };
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "speak_latest_failed";
    return {
      ok: false,
      error: appError(code, error instanceof Error ? error.message : String(error)),
    };
  }
}
```

Add a `runVoiceTest(paths, text?)` helper in the same file if implementation needs one before IPC:

```ts
export async function runVoiceTest(paths: AgentVoicePaths, text = "Agent Voice test."): Promise<AppResult<{ text: string }>> { /* use KokoroClient + playWav */ }
```

- [ ] **Step 4: Export and run tests**

Update `src/app-service/index.ts`:

```ts
export * from "./voice-service";
```

Run:

```bash
bun test tests/app-service/voice-service.test.ts tests/history-json.test.ts tests/tts.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app-service/voice-service.ts src/app-service/index.ts tests/app-service/voice-service.test.ts
git commit -m "feat: add voice replay app service"
```

---

### Task 7: Add diagnostics, hooks, and Kokoro app-service adapters

**Files:**
- Create: `src/app-service/diagnostics-service.ts`
- Create: `src/app-service/hook-service.ts`
- Create: `src/app-service/kokoro-service.ts`
- Modify: `src/app-service/index.ts`
- Test: `tests/app-service/diagnostics-service.test.ts`
- Test: `tests/app-service/hook-service.test.ts`
- Test: `tests/app-service/kokoro-service.test.ts`

- [ ] **Step 1: Write failing diagnostics-service tests**

`tests/app-service/diagnostics-service.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { previewDiagnosticsSnapshot, truncateSensitiveText } from "../../src/app-service/diagnostics-service";

describe("diagnostics service", () => {
  test("truncates long sensitive text", () => {
    expect(truncateSensitiveText("x".repeat(5000), 100)).toHaveLength(103);
  });

  test("preview labels local paths job text provider model and playback diagnostics as sensitive", () => {
    const preview = previewDiagnosticsSnapshot({
      status: { paths: { home: "/home/me/.agent-voice" } },
      failedJobs: [{ text: "secret token maybe" }],
    });
    expect(preview.sensitivity.some((item) => item.id === "local-paths")).toBe(true);
    expect(preview.sensitivity.some((item) => item.id === "job-text")).toBe(true);
  });
});
```

- [ ] **Step 2: Write failing hook-service tests**

`tests/app-service/hook-service.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { hookTargetLabel, assertSupportedAgent } from "../../src/app-service/hook-service";

describe("hook service", () => {
  test("labels supported hook targets", () => {
    expect(hookTargetLabel("pi")).toContain(".pi");
    expect(hookTargetLabel("codex")).toContain("codex");
  });

  test("rejects unsupported agent", () => {
    expect(() => assertSupportedAgent("bad")).toThrow("Unsupported agent");
  });
});
```

- [ ] **Step 3: Write failing Kokoro service tests**

`tests/app-service/kokoro-service.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createSetupConsentToken, normalizeKokoroSetupEvent } from "../../src/app-service/kokoro-service";

describe("kokoro service", () => {
  test("requires consent token shape", () => {
    const token = createSetupConsentToken();
    expect(token.id).toMatch(/^kokoro-consent-/);
  });

  test("normalizes setup step event for UI", () => {
    expect(normalizeKokoroSetupEvent({ type: "step", id: "deps", status: "running", title: "Installing Python dependencies" })).toEqual({
      type: "step",
      id: "deps",
      status: "running",
      title: "Installing Python dependencies",
    });
  });
});
```

- [ ] **Step 4: Run failing tests**

Run: `bun test tests/app-service/diagnostics-service.test.ts tests/app-service/hook-service.test.ts tests/app-service/kokoro-service.test.ts`

Expected: FAIL because service modules do not exist.

- [ ] **Step 5: Implement diagnostics service**

`src/app-service/diagnostics-service.ts` should include:

```ts
export interface SensitivityItem { id: string; label: string; detail: string }

export function truncateSensitiveText(text: string, max = 2000): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function previewDiagnosticsSnapshot(snapshot: unknown): { snapshot: unknown; sensitivity: SensitivityItem[] } {
  return {
    snapshot,
    sensitivity: [
      { id: "local-paths", label: "Local filesystem paths", detail: "Snapshot may include Agent Voice Home and hook target paths." },
      { id: "job-text", label: "Job text", detail: "Failed/skipped job text may contain sensitive project context." },
      { id: "provider-model", label: "Provider/model names", detail: "Snapshot may include summarizer provider and model names, never credentials." },
    ],
  };
}
```

Then add `getDiagnosticsPreview(paths)` that calls `buildDoctorReport`, `buildAppStatusSnapshot`, failed/skipped history rows, hook state/targets, config summary, build/runtime info, and playback detection. This task must satisfy the spec-required diagnostic sections now; do not defer core snapshot composition to renderer tasks. It must exclude environment variables, truncate long logs/job text, and include sensitivity labels before copy/export.

- [ ] **Step 6: Implement hook service**

`src/app-service/hook-service.ts` should wrap existing install functions:

```ts
import { AGENT_NAMES, isAgentName, type AgentName } from "../config";
import { detectAgentInstallStates, installPi, installClaude, installCodex, installOpencode, uninstallPi, uninstallClaude, uninstallCodex, uninstallOpencode, piExtensionPath, claudeSettingsPath, codexHooksPath, opencodePluginPath, type InstallEnv } from "../install";

export function assertSupportedAgent(agent: string): asserts agent is AgentName {
  if (!isAgentName(agent)) throw new Error(`Unsupported agent: ${agent}`);
}

export function hookTargetLabel(agent: AgentName, env: InstallEnv = process.env as InstallEnv): string {
  if (agent === "pi") return piExtensionPath(env);
  if (agent === "claude") return claudeSettingsPath(env);
  if (agent === "codex") return codexHooksPath(env);
  return opencodePluginPath(env);
}
```

Add `getHookStates`, `installHook`, `uninstallHook` with typed result/error and copyable target/message.

- [ ] **Step 7: Implement Kokoro service**

`src/app-service/kokoro-service.ts` should wrap existing `buildKokoroStatus` and `runKokoroSetup`:

```ts
import { randomUUID } from "node:crypto";
import { buildKokoroStatus, runKokoroSetup, type KokoroSetupEvent } from "../kokoro-setup";
import type { AgentVoicePaths } from "../paths";

export interface SetupConsentToken { id: string; createdAt: string }

export function createSetupConsentToken(): SetupConsentToken {
  return { id: `kokoro-consent-${randomUUID()}`, createdAt: new Date().toISOString() };
}

export function normalizeKokoroSetupEvent(event: KokoroSetupEvent): KokoroSetupEvent {
  return event;
}
```

Add an async generator or callback-based `runKokoroSetupStream(paths, token, emit)` that rejects when token id is missing/invalid. If true cancellation needs deeper command support, implement `requestCancel()` as a typed best-effort state and document in service result that active subprocess cancellation is limited until the underlying setup deps accept an abort signal.

- [ ] **Step 8: Export and run tests**

Run:

```bash
bun test tests/app-service/diagnostics-service.test.ts tests/app-service/hook-service.test.ts tests/app-service/kokoro-service.test.ts tests/doctor.test.ts tests/install-detect.test.ts tests/kokoro-setup.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app-service tests/app-service
git commit -m "feat: add setup hooks and diagnostics services"
```

---

## Milestone 4: Electron Main / Preload Contract

### Task 8: Add typed IPC/preload contract and main-process handlers

**Files:**
- Create: `linux/electron/ipc-contract.ts`
- Create: `linux/electron/preload.ts`
- Create: `linux/electron/main.ts`
- Create: `tests/electron/preload-contract.test.ts`
- Create: `tests/electron/main-security.test.ts`
- Create: `tests/electron/setup-session-ipc.test.ts`
- Create: `tests/electron/capsule-lifecycle.test.ts`
- Modify: `package.json` scripts as needed.

- [ ] **Step 1: Write failing preload contract test**

`tests/electron/preload-contract.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { AGENT_VOICE_CHANNELS, AGENT_VOICE_PRELOAD_METHODS } from "../../linux/electron/ipc-contract";

describe("electron preload contract", () => {
  test("exposes only allowlisted methods", () => {
    expect(AGENT_VOICE_PRELOAD_METHODS).toEqual([
      "status.get",
      "daemon.start",
      "daemon.stop",
      "voice.test",
      "voice.speakLatest",
      "kokoro.status",
      "kokoro.setup.start",
      "kokoro.setup.cancel",
      "history.list",
      "queue.clearActive",
      "queue.clearFailed",
      "diagnostics.snapshot",
      "hooks.install",
      "hooks.uninstall",
      "config.get",
      "config.update",
      "capsule.setEnabled",
      "capsule.openConsole",
      "events.subscribe",
    ]);
  });

  test("does not define generic shell or filesystem channels", () => {
    expect(Object.values(AGENT_VOICE_CHANNELS).join(" ")).not.toMatch(/shell|exec|spawn|fs|sql/i);
  });

  test("setup start and cancel channels are session scoped", () => {
    expect(AGENT_VOICE_CHANNELS.kokoroSetupStart).toContain("setup:start");
    expect(AGENT_VOICE_CHANNELS.kokoroSetupCancel).toContain("setup:cancel");
  });
});
```

- [ ] **Step 2: Write failing BrowserWindow security tests**

Create `tests/electron/main-security.test.ts` with assertions against exported pure helpers from `linux/electron/main.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createMainWindowOptions, validateIpcPayload } from "../../linux/electron/main";

describe("electron main security", () => {
  test("main window uses sandboxed isolated renderer options", () => {
    const options = createMainWindowOptions("/tmp/preload.js");
    expect(options.webPreferences?.contextIsolation).toBe(true);
    expect(options.webPreferences?.nodeIntegration).toBe(false);
    expect(options.webPreferences?.sandbox).toBe(true);
    expect(options.webPreferences?.preload).toBe("/tmp/preload.js");
  });

  test("rejects invalid primitive payloads before service calls", () => {
    expect(() => validateIpcPayload("voice.test", { text: 123 })).toThrow("Invalid voice.test payload");
    expect(() => validateIpcPayload("hooks.install", { agent: "bad" })).toThrow("Unsupported agent");
  });
});
```

- [ ] **Step 3: Write failing setup session IPC tests**

Create `tests/electron/setup-session-ipc.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createSetupSessionRegistry } from "../../linux/electron/main";

describe("setup session IPC", () => {
  test("rejects setup start without consent token", () => {
    const registry = createSetupSessionRegistry();
    expect(() => registry.start({ consentToken: "" })).toThrow("consent");
  });

  test("rejects cancel for unknown setup session", () => {
    const registry = createSetupSessionRegistry();
    expect(() => registry.cancel("missing-session")).toThrow("Unknown setup session");
  });

  test("event subscriptions are allowlisted and unsubscribe cleans up", () => {
    const registry = createSetupSessionRegistry();
    const unsubscribe = registry.subscribe("kokoro.setup", () => undefined);
    expect(() => registry.subscribe("raw-process-output", () => undefined)).toThrow("Unsupported event");
    expect(unsubscribe()).toBeUndefined();
  });
});
```

- [ ] **Step 4: Write failing capsule lifecycle tests**

Create `tests/electron/capsule-lifecycle.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createCapsuleController } from "../../linux/electron/main";

describe("capsule lifecycle", () => {
  test("setting gates capsule creation and destruction", () => {
    const events: string[] = [];
    const controller = createCapsuleController({
      create: () => events.push("create"),
      destroy: () => events.push("destroy"),
      focusConsole: () => events.push("focus"),
    });
    controller.setEnabled(true);
    controller.setEnabled(false);
    expect(events).toEqual(["create", "destroy"]);
  });

  test("capsule action surface excludes destructive actions", () => {
    const controller = createCapsuleController({ create() {}, destroy() {}, focusConsole() {} });
    expect(controller.allowedActions()).toEqual(["openConsole", "speakLatest", "viewQueue"]);
    expect(controller.allowedActions()).not.toContain("clearFailed");
    expect(controller.allowedActions()).not.toContain("installHook");
  });
});
```

- [ ] **Step 5: Run failing tests**

Run: `bun test tests/electron/preload-contract.test.ts tests/electron/main-security.test.ts tests/electron/setup-session-ipc.test.ts tests/electron/capsule-lifecycle.test.ts`

Expected: FAIL because contract/main helpers/session registry/capsule controller do not exist.

- [ ] **Step 6: Implement channel constants and types**

`linux/electron/ipc-contract.ts`:

```ts
export const AGENT_VOICE_PRELOAD_METHODS = [
  "status.get",
  "daemon.start",
  "daemon.stop",
  "voice.test",
  "voice.speakLatest",
  "kokoro.status",
  "kokoro.setup.start",
  "kokoro.setup.cancel",
  "history.list",
  "queue.clearActive",
  "queue.clearFailed",
  "diagnostics.snapshot",
  "hooks.install",
  "hooks.uninstall",
  "config.get",
  "config.update",
  "capsule.setEnabled",
  "capsule.openConsole",
  "events.subscribe",
] as const;

export const AGENT_VOICE_CHANNELS = {
  statusGet: "agent-voice:status:get",
  daemonStart: "agent-voice:daemon:start",
  daemonStop: "agent-voice:daemon:stop",
  voiceTest: "agent-voice:voice:test",
  voiceSpeakLatest: "agent-voice:voice:speak-latest",
  kokoroStatus: "agent-voice:kokoro:status",
  kokoroSetupStart: "agent-voice:kokoro:setup:start",
  kokoroSetupCancel: "agent-voice:kokoro:setup:cancel",
  historyList: "agent-voice:history:list",
  queueClearActive: "agent-voice:queue:clear-active",
  queueClearFailed: "agent-voice:queue:clear-failed",
  diagnosticsSnapshot: "agent-voice:diagnostics:snapshot",
  hooksInstall: "agent-voice:hooks:install",
  hooksUninstall: "agent-voice:hooks:uninstall",
  configGet: "agent-voice:config:get",
  configUpdate: "agent-voice:config:update",
  capsuleSetEnabled: "agent-voice:capsule:set-enabled",
  capsuleOpenConsole: "agent-voice:capsule:open-console",
  eventsSubscribe: "agent-voice:events:subscribe",
} as const;
```

- [ ] **Step 7: Implement preload**

`linux/electron/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";
import { AGENT_VOICE_CHANNELS } from "./ipc-contract";

const api = {
  status: { get: () => ipcRenderer.invoke(AGENT_VOICE_CHANNELS.statusGet) },
  daemon: {
    start: () => ipcRenderer.invoke(AGENT_VOICE_CHANNELS.daemonStart),
    stop: () => ipcRenderer.invoke(AGENT_VOICE_CHANNELS.daemonStop),
  },
  voice: {
    test: (text?: string) => ipcRenderer.invoke(AGENT_VOICE_CHANNELS.voiceTest, { text }),
    speakLatest: () => ipcRenderer.invoke(AGENT_VOICE_CHANNELS.voiceSpeakLatest),
  },
  // Continue explicit nested groups for kokoro/history/queue/diagnostics/hooks/config/capsule/events.
};

contextBridge.exposeInMainWorld("agentVoice", api);
```

Complete all groups explicitly. Do not expose `ipcRenderer`, generic `invoke`, or arbitrary channel access.

- [ ] **Step 8: Implement main handlers**

`linux/electron/main.ts` should:

- create the main BrowserWindow with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and explicit `preload` path;
- resolve Agent Voice paths using `resolvePaths(process.env)`;
- register handlers for each channel;
- call app-service methods only;
- validate primitive input shapes before calling services;
- reject setup start without a consent token/session id;
- reject setup cancel with the wrong/missing session id;
- expose only event allowlist subscriptions and return unsubscribe cleanup functions in preload;
- create/destroy capsule BrowserWindow based on setting;
- keep capsule IPC to Open Console, Speak Latest, View Queue, and no destructive actions.

Minimal handler example:

```ts
ipcMain.handle(AGENT_VOICE_CHANNELS.statusGet, async () => getAppStatus(paths));
ipcMain.handle(AGENT_VOICE_CHANNELS.voiceSpeakLatest, async () => speakLatest(paths));
```

- [ ] **Step 9: Run tests/typecheck**

Run:

```bash
bun test tests/electron/preload-contract.test.ts tests/electron/main-security.test.ts tests/electron/setup-session-ipc.test.ts tests/electron/capsule-lifecycle.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add linux/electron tests/electron/preload-contract.test.ts tests/electron/main-security.test.ts tests/electron/setup-session-ipc.test.ts tests/electron/capsule-lifecycle.test.ts package.json bun.lock
git commit -m "feat: add electron ipc contract"
```

---

## Milestone 5: Svelte Operator Console

### Task 9: Build Operator Rail shell and renderer API layer

**Files:**
- Create/modify: `linux/electron/renderer/src/lib/api.ts`
- Create/modify: `linux/electron/renderer/src/lib/types.ts`
- Create/modify: `linux/electron/renderer/src/lib/stores.ts`
- Create: `linux/electron/renderer/src/components/OperatorRail.svelte`
- Modify: `linux/electron/renderer/src/App.svelte`
- Test: `linux/electron/renderer/src/App.test.ts`

- [ ] **Step 1: Write failing renderer shell test**

`linux/electron/renderer/src/App.test.ts`:

```ts
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import App from "./App.svelte";

describe("Operator Console shell", () => {
  test("renders Operator Rail sections and hides pause/resume", () => {
    render(App);
    expect(screen.getByRole("navigation", { name: /operator rail/i })).toBeInTheDocument();
    for (const name of ["Home", "Voice Bench", "Queue & History", "Setup & Repair", "Hooks", "Diagnostics", "Settings"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.queryByText(/pause/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/resume/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `bun run test:renderer -- App.test.ts`

Expected: FAIL because shell/components do not exist.

- [ ] **Step 3: Implement API facade**

`linux/electron/renderer/src/lib/api.ts`:

```ts
export const agentVoice = window.agentVoice;
```

`linux/electron/renderer/src/lib/test-api-mock.ts`:

```ts
import type { AgentVoiceRendererApi } from "./types";

export function installMockAgentVoice(overrides: Partial<AgentVoiceRendererApi> = {}): AgentVoiceRendererApi {
  const api = {
    status: { get: async () => ({}) },
    // Fill every preload group with safe defaults as routes are implemented.
    ...overrides,
  } as AgentVoiceRendererApi;
  Object.defineProperty(window, "agentVoice", { value: api, configurable: true });
  return api;
}
```

All route tests must install this mock before rendering so tests do not depend on Electron globals.

Add a global type declaration in `linux/electron/renderer/src/lib/types.ts` or `global.d.ts` for `window.agentVoice` matching preload contract.

- [ ] **Step 4: Implement OperatorRail and App route state**

`OperatorRail.svelte` should render buttons, not links, for local route state. Include `aria-label="Operator Rail"`, `aria-current` for active route, and visible focus styles.

`App.svelte` should render selected route component with a page heading. Initially use placeholder components if route files are not implemented yet.

- [ ] **Step 5: Run renderer tests/build**

Run:

```bash
bun run test:renderer -- App.test.ts
bun run build:linux-renderer
bun run check:renderer
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add linux/electron/renderer/src
git commit -m "feat: add operator console shell"
```

---

### Task 10: Implement Home Signal Feed and Settings/Capsule UI

**Files:**
- Create: `linux/electron/renderer/src/routes/HomeSignalFeed.svelte`
- Create: `linux/electron/renderer/src/routes/SettingsPanel.svelte`
- Create: `linux/electron/renderer/src/components/StatusBadge.svelte`
- Create: `linux/electron/renderer/src/capsule/CapsuleApp.svelte`
- Modify: `linux/electron/main.ts`
- Test: `linux/electron/renderer/src/routes/HomeSignalFeed.test.ts`
- Test: `linux/electron/renderer/src/routes/SettingsPanel.test.ts`

- [ ] **Step 1: Write failing Home tests**

Test that Home renders status, first-run action, Speak Latest, Voice Test, Open Diagnostics, and no pause/resume.

- [ ] **Step 2: Write failing Settings tests**

Test that Settings renders Desktop Capsule toggle and calls `capsule.setEnabled(true/false)`.

- [ ] **Step 3: Implement Home**

Home should load `status.get()`, display degraded priority cards from service payload, and call `voice.speakLatest()` for replay.

- [ ] **Step 4: Implement Settings and capsule toggle**

Settings should load `config.get()`, render `ui.desktopCapsule.enabled`, and update via `capsule.setEnabled(boolean)`.

- [ ] **Step 5: Implement capsule renderer and main lifecycle**

`CapsuleApp.svelte` should expose only:

- Open Console;
- Speak Latest;
- View Queue.

No destructive actions. No setup. No hooks. No snooze.

- [ ] **Step 6: Run tests**

Run:

```bash
bun run test:renderer -- HomeSignalFeed.test.ts SettingsPanel.test.ts
bun test tests/electron/preload-contract.test.ts
bun run build:linux-renderer
bun run check:renderer
bun run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add linux/electron
git commit -m "feat: add signal feed and capsule settings"
```

---

### Task 11: Implement Voice Bench route

**Files:**
- Create: `linux/electron/renderer/src/routes/VoiceBench.svelte`
- Create/modify: `linux/electron/renderer/src/components/PrivacyLabel.svelte`
- Test: `linux/electron/renderer/src/routes/VoiceBench.test.ts`

- [ ] **Step 1: Write failing Voice Bench tests**

Assert voice test button calls `voice.test`, voice selection and summarizer mode/thinking/model controls render from config, provider/local privacy labels render from the privacy matrix, reduced-motion CSS disables waveform motion, and pause/resume text is absent.

- [ ] **Step 2: Run failing test**

Run: `bun run test:renderer -- VoiceBench.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement Voice Bench minimally**

Use `config.get`, `config.update`, and `voice.test`. Use text privacy labels. Waveform is CSS-only and decorative.

- [ ] **Step 4: Validate and commit**

```bash
bun run test:renderer -- VoiceBench.test.ts
bun run check:renderer
bun run build:linux-renderer
git add linux/electron/renderer/src
git commit -m "feat: add voice bench route"
```

### Task 12: Implement Queue & History route

**Files:**
- Create: `linux/electron/renderer/src/routes/QueueHistory.svelte`
- Create/modify: `linux/electron/renderer/src/components/ConfirmDialog.svelte`
- Test: `linux/electron/renderer/src/routes/QueueHistory.test.ts`
- Test: `linux/electron/renderer/src/components/ConfirmDialog.test.ts`

- [ ] **Step 1: Write failing tests**

Assert rows render, failed details expose raw error/summary/source, load-more uses cursor, invalid/error states render, clear active and clear failed require confirmation text naming irreversible removal, Escape closes dialog, and focus returns to the triggering button.

- [ ] **Step 2: Run failing tests**

Run: `bun run test:renderer -- QueueHistory.test.ts ConfirmDialog.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement route and dialog**

Use `history.list`, `queue.clearActive`, and `queue.clearFailed`. Keep processing-job clear semantics aligned with service/CLI.

- [ ] **Step 4: Validate and commit**

```bash
bun run test:renderer -- QueueHistory.test.ts ConfirmDialog.test.ts
bun run check:renderer
bun run build:linux-renderer
git add linux/electron/renderer/src
git commit -m "feat: add queue and history route"
```

### Task 13: Implement Setup & Repair route

**Files:**
- Create: `linux/electron/renderer/src/routes/SetupRepair.svelte`
- Test: `linux/electron/renderer/src/routes/SetupRepair.test.ts`

- [ ] **Step 1: Write failing Setup tests**

Assert consent copy mentions managed `uv`, Python dependencies, model files, network/disk use, and Agent Voice Home; setup cannot start without consent; progress logs render in an aria-live region; cancel sends session id; wrong/missing session errors render; retry preserves failed diagnostics; focus moves to status heading after error/cancel/done.

- [ ] **Step 2: Run failing test**

Run: `bun run test:renderer -- SetupRepair.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement Setup & Repair**

Use `kokoro.status`, `kokoro.setup.start`, `kokoro.setup.cancel`, and the event subscription/session model from IPC. Cancellation is best-effort in v1 and must say so when applicable.

- [ ] **Step 4: Validate and commit**

```bash
bun run test:renderer -- SetupRepair.test.ts
bun run check:renderer
bun run build:linux-renderer
git add linux/electron/renderer/src
git commit -m "feat: add setup repair route"
```

### Task 14: Implement Hooks route

**Files:**
- Create: `linux/electron/renderer/src/routes/HooksPanel.svelte`
- Test: `linux/electron/renderer/src/routes/HooksPanel.test.ts`

- [ ] **Step 1: Write failing Hooks tests**

Assert four agents render with installed/not installed/unknown/unsupported states, target paths, conflict messages, copyable diagnostics, and install/uninstall confirmations naming the agent and target path. Assert unsupported/unknown states disable unsafe install/uninstall actions with explanatory text.

- [ ] **Step 2: Run failing Hooks tests**

Run: `bun run test:renderer -- HooksPanel.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement Hooks route**

Use `hooks.install` and `hooks.uninstall`. Do not add generic filesystem access. Keep mutation actions behind confirmations.

- [ ] **Step 4: Validate and commit**

```bash
bun run test:renderer -- HooksPanel.test.ts
bun run check:renderer
bun run build:linux-renderer
git add linux/electron/renderer/src
git commit -m "feat: add hooks route"
```

### Task 15: Implement Diagnostics route

**Files:**
- Create: `linux/electron/renderer/src/routes/DiagnosticsPanel.svelte`
- Test: `linux/electron/renderer/src/routes/DiagnosticsPanel.test.ts`

- [ ] **Step 1: Write failing Diagnostics tests**

Assert doctor summary, local paths, runtime/build info, playback backend/last error, hook targets, failed/skipped job text, sensitivity labels, preview-before-copy, no environment-variable section, truncation, copy success message, and focus restoration after copy.

- [ ] **Step 2: Run failing Diagnostics tests**

Run: `bun run test:renderer -- DiagnosticsPanel.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement Diagnostics route**

Use `diagnostics.snapshot`. Do not add generic filesystem access. Snapshot preview must appear before copy.

- [ ] **Step 4: Validate and commit**

```bash
bun run test:renderer -- DiagnosticsPanel.test.ts
bun run check:renderer
bun run build:linux-renderer
git add linux/electron/renderer/src
git commit -m "feat: add diagnostics route"
```

### Task 16: Accessibility and route integration pass

**Files:**
- Modify: route/component files as needed.
- Test: `linux/electron/renderer/src/accessibility.test.ts`

- [ ] **Step 1: Write failing accessibility smoke tests**

Assert route changes focus page heading, Operator Rail exposes landmarks/current route, confirmations trap focus and close on Escape, setup live region exists, reduced-motion CSS disables waveform/capsule transitions, and critical status cards include text labels independent of color.

- [ ] **Step 2: Run failing test**

Run: `bun run test:renderer -- accessibility.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement accessibility fixes**

Apply focused fixes only.

- [ ] **Step 4: Manual accessibility checklist**

Record in final summary whether these were manually checked: keyboard-only first-run flow, 200% zoom, forced colors/high contrast, capsule keyboard operation. If not checked, report residual risk.

- [ ] **Step 5: Validate and commit**

```bash
bun run test:renderer -- accessibility.test.ts
bun run check:renderer
bun run build:linux-renderer
git add linux/electron/renderer/src
git commit -m "test: add linux renderer accessibility checks"
```

## Milestone 6: Integration, Compatibility, and Quality Gate

### Task 17: Finalize Electron dev launch and service integration end-to-end

**Files:**
- Modify: `package.json`
- Modify: `linux/electron/main.ts`
- Create/modify: `linux/electron/dev-runner.ts` if needed.
- Test: `tests/electron/dev-launch-contract.test.ts`

- [ ] **Step 1: Write failing dev launch contract test**

Test that `dev:linux` still launches the dev runner that runs both Vite renderer and Electron main, and that main/preload can load the built or dev renderer URL.

- [ ] **Step 2: Implement dev runner**

Refine the Bun dev runner from Task 1 if needed. Keep production packaging out of scope.

- [ ] **Step 3: Run focused checks**

Run:

```bash
bun test tests/electron/dev-launch-contract.test.ts
bun run build:linux-renderer
bun run check:renderer
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Manual launch**

Run: `bun run dev:linux`

Expected: Electron app opens Operator Console in dev mode. If running on non-Linux/macOS during development, launch may open but playback diagnostics should honestly report platform backend status.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock linux/electron tests/electron/dev-launch-contract.test.ts
git commit -m "feat: wire linux electron dev launch"
```

---

### Task 18: Full compatibility and no-Swift-touch validation

**Files:**
- No production source changes unless tests reveal a compatibility fix needed.
- Create: `tests/electron/no-swift-touch.test.ts` if useful.

- [ ] **Step 1: Write/verify no-Swift-touch check**

Before finalizing, run:

```bash
git diff --name-only master...HEAD | grep '^macos/AgentVoiceApp/' && echo "Unexpected macOS change" && exit 1 || true
```

Expected: no macOS Swift source files listed.

- [ ] **Step 2: Run full TS/renderer validation**

Run:

```bash
bun test
bun run test:renderer
bun run build:linux-renderer
bun run check:renderer
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run macOS Swift tests only if TS refactor touched CLI contracts likely consumed by Swift**

Run if time/toolchain allows:

```bash
swift test --package-path macos/AgentVoiceApp
```

Expected: PASS. If skipped due environment/time, report explicitly as residual risk.

- [ ] **Step 4: Manual Linux dev smoke**

On Linux or Linux-like environment, run:

```bash
bun run dev:linux
```

Manual checks:

- Operator Rail opens.
- Pause/resume absent.
- Voice Bench shows playback backend or missing-tool diagnostic.
- Settings toggles Desktop Capsule on/off.
- Capsule offers only Open Console, Speak Latest, View Queue.
- Diagnostics snapshot preview appears before copy.
- Setup & Repair consent appears before setup starts.

- [ ] **Step 5: Commit final fixes**

Commit any test/compatibility fixes:

```bash
git status --short
git add <changed files>
git commit -m "test: validate linux electron sibling"
```

---

## Final Review Plan

After implementation:

1. Run focused validation listed in Task 18.
2. Run Dynamax final review with lenses:
   - correctness/regression;
   - tests/validation;
   - Electron IPC/security;
   - accessibility/UI;
   - feature parity/CLI compatibility.
3. Adversarially verify candidate findings.
4. Fix only adjudicated `blocker` or approved `fix-now` items within one repair loop.
5. Run final fresh verification before claiming completion.

## Implementation Notes and Gotchas

- Keep the renderer UI-only. If a route needs data, add a preload method and app-service method rather than importing Node modules into Svelte.
- Do not add a generic `ipc.invoke(channel, payload)` escape hatch.
- Keep Linux playback errors honest: missing `paplay`/`aplay` is a diagnostic state, not a silent no-op.
- Do not turn `config.enabled` into pause/resume language in Linux UI. Use “Agent Voice enabled” only if needed.
- Do not weaken existing CLI tests. Existing public CLI/bin tests are compatibility contract.
- If setup cancellation requires deeper abort support than available, implement honest best-effort cancel state and document the limitation in UI until a deeper abortable command runner is approved.
- If Svelte 5 syntax differs from examples, follow installed Svelte version conventions and keep tests authoritative.
