# Pi Agent Install Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real Pi-only hook install/uninstall support to the CLI and expose it as Pi Install Hook / Uninstall Hook buttons in the macOS app.

**Architecture:** Keep all global filesystem mutation inside a focused TypeScript installer module. The Swift app shells out to the CLI, just like start/stop/test, and never writes `~/.pi` directly. The generated Pi extension uses Pi's public TypeScript extension API and the `turn_end` event to enqueue completed turns through the installed `agent-voice` CLI.

**Tech Stack:** Bun/TypeScript CLI, Pi TypeScript extensions, SwiftUI macOS app, XCTest, Bun tests.

---

## File Structure

- Create `src/install.ts`
  - Owns Pi install/uninstall filesystem operations.
  - Generates the owned `agent-voice.ts` Pi extension.
  - Contains path resolution helpers for fake-home tests.
- Modify `src/cli.ts`
  - Dispatches `install --agents pi` and `uninstall --agents pi`.
  - Rejects unsupported agents for this slice.
- Create `tests/install-pi.test.ts`
  - Covers idempotency, ownership marker safety, unsupported agents, and uninstall behavior.
- Modify `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift`
  - Adds `installAgentHook(_:)` and `uninstallAgentHook(_:)`.
- Modify `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift`
  - Adds `installAgentHook(_:)` and `uninstallAgentHook(_:)` wrappers using existing `perform` refresh flow.
- Modify `macos/AgentVoiceApp/Sources/AgentVoiceApp/DashboardView.swift`
  - Adds Pi install/uninstall buttons in the Agents card.
  - Shows disabled coming-later controls for other agents.
- Modify `macos/AgentVoiceApp/Sources/AgentVoiceApp/SetupAssistantView.swift`
  - Adds the same Pi install/uninstall actions in the Agents step.
- Modify `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceCLITests.swift`
  - Verifies CLI argument construction.
- Modify `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`
  - Verifies model delegation and refresh after install/uninstall.
- Modify `README.md`
  - Documents Pi-only install/uninstall status.

## Constants

Use these in `src/install.ts`:

```ts
const AGENT_VOICE_EXTENSION_MARKER = "agent-voice pi extension managed by agent-voice";
const PI_EXTENSION_RELATIVE_PATH = [".pi", "agent", "extensions", "agent-voice.ts"];
```

Generated extension should contain the marker as a comment. Uninstall must only delete a file containing the marker.

---

### Task 1: CLI Pi Installer Module

**Files:**
- Create: `src/install.ts`
- Modify: `src/cli.ts`
- Test: `tests/install-pi.test.ts`

- [ ] **Step 1: Write failing install tests**

Create `tests/install-pi.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";
import { runCli } from "../src/cli";

async function withTempHome<T>(fn: (home: string) => T | Promise<T>): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), "agent-voice-install-pi-test-"));
  try {
    return await fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function piExtensionPath(home: string): string {
  return join(home, ".pi", "agent", "extensions", "agent-voice.ts");
}

describe("agent-voice Pi installer", () => {
  test("install --agents pi writes an owned Pi extension", async () => {
    await withTempHome(async (home) => {
      const result = await runCli(["install", "--agents", "pi"], {
        env: { HOME: home, AGENT_VOICE_HOME: join(home, ".agent-voice") },
      });

      expect(result.exitCode).toBe(0);
      const extension = readFileSync(piExtensionPath(home), "utf8");
      expect(extension).toContain("agent-voice pi extension managed by agent-voice");
      expect(extension).toContain("pi.on(\"turn_end\"");
      expect(extension).toContain("enqueue");
      expect(extension).toContain("--agent");
      expect(extension).toContain("pi");
    });
  });

  test("install --agents pi is idempotent for owned extension", async () => {
    await withTempHome(async (home) => {
      const env = { HOME: home, AGENT_VOICE_HOME: join(home, ".agent-voice") };
      expect((await runCli(["install", "--agents", "pi"], { env })).exitCode).toBe(0);
      const first = readFileSync(piExtensionPath(home), "utf8");
      expect((await runCli(["install", "--agents", "pi"], { env })).exitCode).toBe(0);
      const second = readFileSync(piExtensionPath(home), "utf8");
      expect(second).toBe(first);
    });
  });

  test("install refuses to overwrite unowned Pi extension", async () => {
    await withTempHome(async (home) => {
      const target = piExtensionPath(home);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "// user's extension\n", "utf8");

      const result = await runCli(["install", "--agents", "pi"], {
        env: { HOME: home, AGENT_VOICE_HOME: join(home, ".agent-voice") },
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("refusing to overwrite");
      expect(readFileSync(target, "utf8")).toBe("// user's extension\n");
    });
  });

  test("uninstall --agents pi removes owned extension", async () => {
    await withTempHome(async (home) => {
      const env = { HOME: home, AGENT_VOICE_HOME: join(home, ".agent-voice") };
      expect((await runCli(["install", "--agents", "pi"], { env })).exitCode).toBe(0);

      const result = await runCli(["uninstall", "--agents", "pi"], { env });

      expect(result.exitCode).toBe(0);
      expect(existsSync(piExtensionPath(home))).toBe(false);
    });
  });

  test("uninstall --agents pi is no-op when extension is absent", async () => {
    await withTempHome(async (home) => {
      const result = await runCli(["uninstall", "--agents", "pi"], {
        env: { HOME: home, AGENT_VOICE_HOME: join(home, ".agent-voice") },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("not installed");
    });
  });

  test("uninstall refuses to remove unowned extension", async () => {
    await withTempHome(async (home) => {
      const target = piExtensionPath(home);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "// user's extension\n", "utf8");

      const result = await runCli(["uninstall", "--agents", "pi"], {
        env: { HOME: home, AGENT_VOICE_HOME: join(home, ".agent-voice") },
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not owned by agent-voice");
      expect(existsSync(target)).toBe(true);
    });
  });

  test("install and uninstall reject unsupported agents in this slice", async () => {
    await withTempHome(async (home) => {
      const env = { HOME: home, AGENT_VOICE_HOME: join(home, ".agent-voice") };
      const install = await runCli(["install", "--agents", "claude"], { env });
      const uninstall = await runCli(["uninstall", "--agents", "codex"], { env });

      expect(install.exitCode).toBe(2);
      expect(install.stderr).toContain("currently supports only pi");
      expect(uninstall.exitCode).toBe(2);
      expect(uninstall.stderr).toContain("currently supports only pi");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/install-pi.test.ts
```

Expected: FAIL because `install` / `uninstall` are not implemented.

- [ ] **Step 3: Implement `src/install.ts`**

Create `src/install.ts` with:

```ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const AGENT_VOICE_EXTENSION_MARKER = "agent-voice pi extension managed by agent-voice";

export interface InstallEnv {
  HOME?: string;
  AGENT_VOICE_EXECUTABLE?: string;
}

export interface InstallResult {
  ok: boolean;
  message: string;
}

function homeDir(env: InstallEnv): string {
  if (!env.HOME) throw new Error("HOME is required for Pi install");
  return env.HOME;
}

export function piExtensionPath(env: InstallEnv): string {
  return join(homeDir(env), ".pi", "agent", "extensions", "agent-voice.ts");
}

function currentAgentVoiceExecutable(env: InstallEnv): string {
  if (env.AGENT_VOICE_EXECUTABLE) return resolve(env.AGENT_VOICE_EXECUTABLE);
  const entry = process.argv[1] ? resolve(process.argv[1]) : resolve("src/index.ts");
  const root = entry.endsWith("/src/index.ts") ? dirname(dirname(entry)) : process.cwd();
  return join(root, "bin", "agent-voice");
}

function eventTextExpression(): string {
  return `function textFromTurnEnd(event) {
  const content = event?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part === "string" ? part : part?.text)
      .filter((part) => typeof part === "string" && part.trim().length > 0)
      .join("\\n");
  }
  if (typeof event?.message?.text === "string") return event.message.text;
  return "Pi finished responding.";
}`;
}

export function buildPiExtensionSource(env: InstallEnv): string {
  const executable = JSON.stringify(currentAgentVoiceExecutable(env));
  return `// ${AGENT_VOICE_EXTENSION_MARKER}
import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const AGENT_VOICE = ${executable};

${eventTextExpression()}

function enqueue(text: string, cwd: string): void {
  const child = spawn(AGENT_VOICE, ["enqueue", "--format", "text", "--agent", "pi", "--cwd", cwd], {
    stdio: ["pipe", "ignore", "ignore"],
    detached: true,
    env: process.env,
  });
  child.stdin.end(text);
  child.unref();
}

export default function (pi: ExtensionAPI) {
  pi.on("turn_end", async (event, ctx) => {
    if (process.env.AGENT_VOICE_DISABLE === "1") return;
    enqueue(textFromTurnEnd(event), ctx.cwd);
  });
}
`;
}

function assertOwnedIfPresent(path: string, action: "overwrite" | "remove"): void {
  if (!existsSync(path)) return;
  const existing = readFileSync(path, "utf8");
  if (!existing.includes(AGENT_VOICE_EXTENSION_MARKER)) {
    const verb = action === "overwrite" ? "overwrite" : "remove";
    throw new Error(`refusing to ${verb} ${path}; file is not owned by agent-voice`);
  }
}

export function installPi(env: InstallEnv): InstallResult {
  const target = piExtensionPath(env);
  assertOwnedIfPresent(target, "overwrite");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buildPiExtensionSource(env), "utf8");
  return { ok: true, message: `installed Pi hook at ${target}` };
}

export function uninstallPi(env: InstallEnv): InstallResult {
  const target = piExtensionPath(env);
  if (!existsSync(target)) return { ok: true, message: "Pi hook not installed" };
  assertOwnedIfPresent(target, "remove");
  rmSync(target, { force: true });
  return { ok: true, message: `uninstalled Pi hook from ${target}` };
}
```

Adjust exact implementation as needed, but keep these behaviors and marker safety.

- [ ] **Step 4: Wire `src/cli.ts`**

Add imports:

```ts
import { installPi, uninstallPi } from "./install";
```

Add helper:

```ts
function parseAgentsOption(args: string[]): string[] {
  const value = getOption(args, "--agents") ?? "";
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
```

Before other unimplemented command fallback, add:

```ts
if (command === "install" || command === "uninstall") {
  const agents = parseAgentsOption(args);
  if (agents.length !== 1 || agents[0] !== "pi") {
    return result(2, "", `${command} currently supports only pi\n`);
  }

  try {
    const outcome = command === "install"
      ? installPi(io.env ?? process.env)
      : uninstallPi(io.env ?? process.env);
    return result(0, `${outcome.message}\n`);
  } catch (error) {
    return result(1, "", `${error instanceof Error ? error.message : String(error)}\n`);
  }
}
```

- [ ] **Step 5: Run installer tests**

Run:

```bash
bun test tests/install-pi.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run related CLI tests**

Run:

```bash
bun test tests/install-pi.test.ts tests/cli.test.ts tests/config.test.ts
```

Expected: PASS.

---

### Task 2: Swift CLI Bridge and AppModel Actions

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift`
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift`
- Test: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceCLITests.swift`
- Test: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`

- [ ] **Step 1: Write failing Swift CLI tests**

Append to `AgentVoiceCLITests`:

```swift
func testInstallAndUninstallAgentHookCommands() async throws {
    let runner = RecordingRunner(results: [
        ProcessResult(exitCode: 0, stdout: "installed\n", stderr: ""),
        ProcessResult(exitCode: 0, stdout: "uninstalled\n", stderr: "")
    ])
    let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

    try await cli.installAgentHook("pi")
    try await cli.uninstallAgentHook("pi")

    let requests = await runner.capturedRequests()
    XCTAssertEqual(requests.map(\.arguments), [
        ["install", "--agents", "pi"],
        ["uninstall", "--agents", "pi"]
    ])
}
```

- [ ] **Step 2: Write failing AppModel test**

Append to `AppModelTests`:

```swift
func testInstallAgentHookDelegatesToCLIAndRefreshes() async throws {
    let statusJSON = """
    {
      "version": 1,
      "daemon": { "state": "stopped", "running": false, "pid": null },
      "queues": { "pending": 0, "processing": 0, "done": 0, "failed": 0, "skipped": 0 },
      "config": { "enabled": true, "agents": { "pi": { "enabled": true, "mode": "native" } } },
      "paths": { "home": "/tmp/av", "config": "/tmp/av/config.json", "db": "/tmp/av/queue.db" },
      "ui": { "state": "daemon_stopped", "attention": [] }
    }
    """
    let historyJSON = """{ "version": 1, "jobs": [] }"""
    let doctorJSON = """{ "version": 1, "checks": [] }"""
    let runner = RecordingRunner(results: [
        ProcessResult(exitCode: 0, stdout: "installed\n", stderr: ""),
        ProcessResult(exitCode: 0, stdout: statusJSON, stderr: ""),
        ProcessResult(exitCode: 0, stdout: historyJSON, stderr: ""),
        ProcessResult(exitCode: 0, stdout: doctorJSON, stderr: "")
    ])
    let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
    let model = AppModel(cli: cli)

    await model.installAgentHook("pi")

    XCTAssertNil(model.lastError)
    let requests = await runner.capturedRequests()
    XCTAssertEqual(requests.map(\.arguments), [
        ["install", "--agents", "pi"],
        ["status", "--json"],
        ["history", "--json", "--limit", "50"],
        ["doctor", "--json"]
    ])
}
```

Add a parallel uninstall AppModel test if time allows; otherwise CLI bridge plus install model test is the minimum.

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AgentVoiceCLITests/testInstallAndUninstallAgentHookCommands
swift test --package-path macos/AgentVoiceApp --filter AppModelTests/testInstallAgentHookDelegatesToCLIAndRefreshes
```

Expected: FAIL because methods do not exist.

- [ ] **Step 4: Implement Swift bridge methods**

In `AgentVoiceCLI.swift`, add:

```swift
public func installAgentHook(_ agent: String) async throws {
    _ = try await run(["install", "--agents", agent])
}

public func uninstallAgentHook(_ agent: String) async throws {
    _ = try await run(["uninstall", "--agents", agent])
}
```

In `AppModel.swift`, add:

```swift
public func installAgentHook(_ agent: String) async {
    await perform { try await cli.installAgentHook(agent) }
}

public func uninstallAgentHook(_ agent: String) async {
    await perform { try await cli.uninstallAgentHook(agent) }
}
```

- [ ] **Step 5: Run Swift model tests**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AgentVoiceCLITests
swift test --package-path macos/AgentVoiceApp --filter AppModelTests
```

Expected: PASS.

---

### Task 3: App UI Buttons

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/DashboardView.swift`
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/SetupAssistantView.swift`

- [ ] **Step 1: Update Dashboard agent card**

In `DashboardView.agentGridSection`, inside each agent cell after mode text, add:

```swift
if name == "pi" {
    HStack {
        Button("Install Hook") {
            Task { await model.installAgentHook("pi") }
        }
        Button("Uninstall Hook") {
            Task { await model.uninstallAgentHook("pi") }
        }
    }
    .font(.caption)
} else {
    Text("Hook install coming later")
        .font(.caption)
        .foregroundStyle(.secondary)
}
```

Keep styling consistent with the current card.

- [ ] **Step 2: Update Setup Assistant agent rows**

In `SetupAssistantView.agentRows`, replace or augment the disabled enable/disable button area:

```swift
if item.name == "pi" {
    VStack(alignment: .trailing, spacing: 4) {
        Button("Install Hook") {
            Task { await model.installAgentHook("pi") }
        }
        Button("Uninstall Hook") {
            Task { await model.uninstallAgentHook("pi") }
        }
    }
} else {
    Text("Hook install coming later")
        .font(.caption)
        .foregroundStyle(.secondary)
}
```

Do not remove the existing agent enabled/mode summary.

- [ ] **Step 3: Build Swift package**

Run:

```bash
swift build --package-path macos/AgentVoiceApp
```

Expected: PASS.

---

### Task 4: Documentation and Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Replace current preview limitation text that says install is not implemented with Pi-only status. Add a small section:

```md
### Pi hook install

The current installer slice supports Pi only:

```bash
./bin/agent-voice install --agents pi
./bin/agent-voice uninstall --agents pi
```

Install writes an owned Pi extension to `~/.pi/agent/extensions/agent-voice.ts`. Uninstall removes only that owned extension. Claude, Codex, OpenCode, LaunchAgent, and wrapper installation are not implemented yet.
```

- [ ] **Step 2: Run full TypeScript checks**

Run:

```bash
bun test
bun run typecheck
```

Expected: all tests pass and typecheck exits 0.

- [ ] **Step 3: Run full Swift checks**

Run:

```bash
swift test --package-path macos/AgentVoiceApp
swift build --package-path macos/AgentVoiceApp
```

Expected: all Swift tests pass and build exits 0.

- [ ] **Step 4: Rebuild app bundle**

Run:

```bash
bash scripts/build-macos-app.sh
```

Expected: outputs `dist/Agent Voice.app`.

- [ ] **Step 5: Manual fake-home smoke test**

Run:

```bash
TMP_HOME="$(mktemp -d)"
HOME="$TMP_HOME" AGENT_VOICE_HOME="$TMP_HOME/.agent-voice" ./bin/agent-voice install --agents pi
ls "$TMP_HOME/.pi/agent/extensions/agent-voice.ts"
HOME="$TMP_HOME" AGENT_VOICE_HOME="$TMP_HOME/.agent-voice" ./bin/agent-voice uninstall --agents pi
test ! -e "$TMP_HOME/.pi/agent/extensions/agent-voice.ts"
rm -rf "$TMP_HOME"
```

Expected: install creates the file; uninstall removes it.

- [ ] **Step 6: Optional real install smoke, only with user confirmation**

Do not mutate real `~/.pi` silently. Ask the user before running:

```bash
./bin/agent-voice install --agents pi
./bin/agent-voice uninstall --agents pi
```

Expected: real Pi extension can be installed/uninstalled safely.

---

## Notes and Risks

- The exact `turn_end` event message shape may vary. Generated extension should be defensive and fall back to `Pi finished responding.` if needed.
- The first implementation should avoid complex backups because it owns a single standalone generated extension file and refuses unowned overwrite/delete.
- Future agent support should reuse `install --agents <name>` but must get its own spec because Claude/Codex/OpenCode mutation surfaces differ.
- The previously approved Kokoro voice picker is a separate feature and should be implemented in a separate plan to avoid mixing UI configuration work with global hook installation.
