# Dashboard Summarizer Thinking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit dashboard control that lets users save the Pi summarizer thinking effort through `agent-voice config set summarizer.thinking <value>`.

**Architecture:** Extend the Swift config model and CLI bridge first, then add AppModel draft/save state, then render the control inside the existing Dashboard **Voice and local config** card. The TypeScript CLI already supports scalar config writes and the summarizer already reads `summarizer.thinking`, so this is a macOS app bridge/UI change only.

**Tech Stack:** Swift, SwiftUI, XCTest, existing Bun/TypeScript `agent-voice config set` command.

---

## File Structure

- `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceConfig.swift`
  - Extend full config decoding with a `summarizer.thinking` field.
  - Keep the existing TTS config model intact.
- `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift`
  - Add `setSummarizerThinking(_:)` using the existing `config set` command.
- `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift`
  - Add `draftThinking`, allowed thinking options, refresh sync, and `saveThinking()`.
- `macos/AgentVoiceApp/Sources/AgentVoiceApp/DashboardView.swift`
  - Add controls to the existing `kokoroCard` and a focused `thinkingControls` helper.
- `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceCLITests.swift`
  - Verify config decoding and CLI command construction.
- `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`
  - Verify refresh sync, save behavior, and invalid-value rejection.
- `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/DashboardViewSourceTests.swift`
  - Verify the dashboard source contains the thinking control in the existing local config card.

No TypeScript source changes are required.

---

## Tasks

### Task 1: Swift config model and CLI bridge

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceConfig.swift`
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift`
- Test: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceCLITests.swift`

- [ ] **Step 1: Write failing config decoding test**

In `AgentVoiceCLITests.swift`, update `testConfigCommandDecodesVoice` so the fixture includes `summarizer.thinking`, and assert the decoded value:

```swift
func testConfigCommandDecodesVoiceAndSummarizerThinking() async throws {
    let configJSON = """
    {
      "enabled": true,
      "agents": {},
      "summarizer": {
        "priority": ["pi-fast", "heuristic"],
        "codexModel": "gpt-5.3-codex",
        "piModel": "openai-codex/gpt-5.5",
        "opencodeModel": null,
        "thinking": "high",
        "timeoutSeconds": 12,
        "maxInputChars": 12000,
        "maxSummaryChars": 180
      },
      "tts": {
        "kokoroScript": "/tmp/kokoro.py",
        "python": "python3",
        "voice": "af_sky",
        "timeoutSeconds": 30
      }
    }
    """
    let runner = RecordingRunner(stdout: configJSON)
    let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

    let config = try await cli.config()

    XCTAssertEqual(config.tts.voice, "af_sky")
    XCTAssertEqual(config.summarizer.thinking, "high")
    let requests = await runner.capturedRequests()
    XCTAssertEqual(requests.first?.arguments, ["config", "get"])
}
```

- [ ] **Step 2: Write failing CLI command test**

Add this test near `testSetVoiceCommand`:

```swift
func testSetSummarizerThinkingCommand() async throws {
    let runner = RecordingRunner(stdout: "ok\n")
    let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

    try await cli.setSummarizerThinking("xhigh")

    let requests = await runner.capturedRequests()
    XCTAssertEqual(requests.first?.arguments, ["config", "set", "summarizer.thinking", "xhigh"])
}
```

- [ ] **Step 3: Run tests and confirm they fail for the expected reasons**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AgentVoiceCLITests
```

Expected: FAIL because `AgentVoiceFullConfig` has no `summarizer` property and `AgentVoiceCLI` has no `setSummarizerThinking(_:)` method.

- [ ] **Step 4: Add the config model**

In `AgentVoiceConfig.swift`, extend `AgentVoiceFullConfig` and add `SummarizerConfig`:

```swift
public struct AgentVoiceFullConfig: Codable, Equatable, Sendable {
    public let tts: TTSConfig
    public let summarizer: SummarizerConfig

    public init(tts: TTSConfig, summarizer: SummarizerConfig) {
        self.tts = tts
        self.summarizer = summarizer
    }
}

public struct SummarizerConfig: Codable, Equatable, Sendable {
    public let thinking: String

    public init(thinking: String) {
        self.thinking = thinking
    }
}
```

If preserving compatibility with older config files is desired during implementation, use a custom `init(from:)` for `AgentVoiceFullConfig` that defaults missing `summarizer.thinking` to `"off"`. Keep the public surface non-optional either way.

- [ ] **Step 5: Add the CLI bridge method**

In `AgentVoiceCLI.swift`, place this near `setVoice(_:)`:

```swift
public func setSummarizerThinking(_ thinking: String) async throws {
    _ = try await run(["config", "set", "summarizer.thinking", thinking])
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AgentVoiceCLITests
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceConfig.swift \
        macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift \
        macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceCLITests.swift
git commit -m "feat: add summarizer thinking cli bridge"
```

---

### Task 2: AppModel draft state and save action

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift`
- Test: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`

- [ ] **Step 1: Update test config fixture**

In `AppModelTests.swift`, change `fullConfigJSON` to include a configurable thinking value:

```swift
private func fullConfigJSON(voice: String = "af_heart", thinking: String = "off") -> String {
    """
    {
      "enabled": true,
      "agents": {},
      "summarizer": {
        "priority": ["pi-fast", "heuristic"],
        "codexModel": "gpt-5.3-codex",
        "piModel": "openai-codex/gpt-5.5",
        "opencodeModel": null,
        "thinking": "\(thinking)",
        "timeoutSeconds": 12,
        "maxInputChars": 12000,
        "maxSummaryChars": 180
      },
      "tts": {
        "kokoroScript": "/tmp/kokoro.py",
        "python": "python3",
        "voice": "\(voice)",
        "timeoutSeconds": 30
      }
    }
    """
}
```

- [ ] **Step 2: Write failing refresh assertion**

In `testRefreshLoadsStatusHistoryDoctorAndConfig`, use `fullConfigJSON(voice: "af_sky", thinking: "medium")` and add:

```swift
XCTAssertEqual(model.config?.summarizer.thinking, "medium")
XCTAssertEqual(model.draftThinking, "medium")
```

- [ ] **Step 3: Write failing save test**

Add:

```swift
func testSaveThinkingTrimsDelegatesAndRefreshes() async throws {
    let runner = RecordingRunner(results: [
        ProcessResult(exitCode: 0, stdout: "", stderr: ""),
        ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
        ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
        ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
        ProcessResult(exitCode: 0, stdout: fullConfigJSON(thinking: "xhigh"), stderr: "")
    ])
    let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
    let model = AppModel(cli: cli)
    model.draftThinking = "  xhigh  "

    await model.saveThinking()

    XCTAssertNil(model.lastError)
    XCTAssertEqual(model.config?.summarizer.thinking, "xhigh")
    XCTAssertEqual(model.draftThinking, "xhigh")
    let requests = await runner.capturedRequests()
    XCTAssertEqual(requests.map(\.arguments), [
        ["config", "set", "summarizer.thinking", "xhigh"],
        ["status", "--json"],
        ["history", "--json", "--limit", "50"],
        ["doctor", "--json"],
        ["config", "get"]
    ])
}
```

- [ ] **Step 4: Write failing invalid-value test**

Add:

```swift
func testSaveThinkingRejectsUnsupportedDraftWithoutCallingCLI() async throws {
    let runner = RecordingRunner(results: [])
    let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
    let model = AppModel(cli: cli)
    model.draftThinking = "maximum"

    await model.saveThinking()

    XCTAssertEqual(model.lastError, "Unsupported summarizer thinking effort")
    let requests = await runner.capturedRequests()
    XCTAssertTrue(requests.isEmpty)
}
```

- [ ] **Step 5: Run tests and confirm they fail for expected reasons**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AppModelTests
```

Expected: FAIL because `draftThinking`, `saveThinking()`, and `summarizerThinkingOptions` do not exist yet.

- [ ] **Step 6: Add AppModel state and options**

In `AppModel.swift`, add beside `draftVoice`:

```swift
@Published public var draftThinking: String = "off"
```

Add near `kokoroVoicePresets`:

```swift
public static let summarizerThinkingOptions = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh"
]
```

- [ ] **Step 7: Sync draft thinking during refresh**

In `refresh()`, after loading `config`, set:

```swift
draftThinking = config?.summarizer.thinking ?? "off"
```

Keep the existing `draftVoice` sync.

- [ ] **Step 8: Add saveThinking**

Add near `saveVoice()`:

```swift
public func saveThinking() async {
    let thinking = draftThinking.trimmingCharacters(in: .whitespacesAndNewlines)
    guard AppModel.summarizerThinkingOptions.contains(thinking) else {
        lastError = "Unsupported summarizer thinking effort"
        return
    }
    await perform { try await cli.setSummarizerThinking(thinking) }
}
```

- [ ] **Step 9: Run focused tests**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AppModelTests
```

Expected: PASS.

- [ ] **Step 10: Commit Task 2**

```bash
git add macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift \
        macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift
git commit -m "feat: add summarizer thinking app state"
```

---

### Task 3: Dashboard control inside Voice and local config

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/DashboardView.swift`
- Test: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/DashboardViewSourceTests.swift`

- [ ] **Step 1: Write failing source test**

Add this test to `DashboardViewSourceTests.swift`:

```swift
func testDashboardExposesSummarizerThinkingInLocalConfigCard() throws {
    let source = try dashboardViewSource()
    let kokoroCard = try propertyBody(named: "kokoroCard", in: source)

    XCTAssertTrue(kokoroCard.contains("labeledRow(\"Summarizer thinking\""))
    XCTAssertTrue(kokoroCard.contains("thinkingControls"))
    XCTAssertTrue(source.contains("private var thinkingControls"))
    XCTAssertTrue(source.contains("AppModel.summarizerThinkingOptions"))
    XCTAssertTrue(source.contains("Button(\"Save Thinking\")"))
    XCTAssertTrue(source.contains("model.saveThinking()"))
}
```

- [ ] **Step 2: Run source test and confirm it fails**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter DashboardViewSourceTests
```

Expected: FAIL because the dashboard has no thinking controls yet.

- [ ] **Step 3: Add the control to kokoroCard**

In `DashboardView.swift`, update `kokoroCard` so the `VStack` starts like this:

```swift
VStack(alignment: .leading, spacing: 12) {
    labeledRow("Voice", model.config?.tts.voice ?? "Unknown")
    voiceControls
    labeledRow("Summarizer thinking", model.config?.summarizer.thinking ?? "Unknown")
    thinkingControls
    labeledRow("Kokoro script", model.config?.tts.kokoroScript ?? "Unknown")
    labeledRow("Agent Voice home", model.status?.paths.home ?? "Unknown")
    labeledRow("Config", model.status?.paths.config ?? "Unknown")
    labeledRow("Queue database", model.status?.paths.db ?? "Unknown")
    Button("Run Voice Test") {
        Task { await model.testVoice() }
    }
}
```

- [ ] **Step 4: Add the thinkingControls helper**

Place this after `voiceControls`:

```swift
@ViewBuilder
private var thinkingControls: some View {
    let options = AppModel.summarizerThinkingOptions
    VStack(alignment: .leading, spacing: 8) {
        Picker("Thinking effort", selection: $model.draftThinking) {
            ForEach(options, id: \.self) { effort in
                Text(effort).tag(effort)
            }
        }
        .pickerStyle(.menu)

        Button("Save Thinking") {
            Task { await model.saveThinking() }
        }
        .disabled(!options.contains(model.draftThinking.trimmingCharacters(in: .whitespacesAndNewlines)))
    }
}
```

This intentionally uses a picker only; unlike Kokoro voices, the allowed values are fixed by the current config contract.

- [ ] **Step 5: Run source tests**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter DashboardViewSourceTests
```

Expected: PASS.

- [ ] **Step 6: Build the app**

Run:

```bash
swift build --package-path macos/AgentVoiceApp
```

Expected: PASS with no Swift compile errors.

- [ ] **Step 7: Commit Task 3**

```bash
git add macos/AgentVoiceApp/Sources/AgentVoiceApp/DashboardView.swift \
        macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/DashboardViewSourceTests.swift
git commit -m "feat: expose summarizer thinking in dashboard"
```

---

### Task 4: Full validation and completion notes

**Files:**
- No planned source modifications.

- [ ] **Step 1: Run full Swift tests**

```bash
swift test --package-path macos/AgentVoiceApp
```

Expected: PASS.

- [ ] **Step 2: Run Swift build**

```bash
swift build --package-path macos/AgentVoiceApp
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript tests**

```bash
bun test
```

Expected: PASS. These should be unaffected, but run them to catch accidental regressions.

- [ ] **Step 4: Run TypeScript typecheck**

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

```bash
git diff --stat HEAD~3..HEAD
git status --short
```

Expected: Swift app/config/test files changed by the implementation commits. Be aware the repo may already contain unrelated pre-existing changes; do not stage or commit them.

- [ ] **Step 6: Manual smoke check, if running the app locally**

Run the app, open Dashboard, confirm the **Voice and local config** card shows:

- Current `Summarizer thinking` value.
- A picker containing `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- A **Save Thinking** button.

Change the picker to `minimal`, click **Save Thinking**, then confirm:

```bash
./bin/agent-voice config get | grep -A 8 '"summarizer"'
```

Expected: the JSON contains `"thinking": "minimal"`.

- [ ] **Step 7: Final commit only if Task 4 required small fixes**

If validation required fixes, commit only those files:

```bash
git add <fixed-files>
git commit -m "fix: validate dashboard summarizer thinking"
```

If validation passed without fixes, no extra commit is needed.
