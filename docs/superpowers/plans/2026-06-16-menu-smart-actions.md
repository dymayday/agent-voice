# Menu Smart Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a context-aware Smart Actions icon/menu to the bottom of the Agent Voice menu-bar popover without replacing existing footer actions.

**Architecture:** Implement the feature in the SwiftUI menu-bar surface, backed by existing `AppModel` and `AgentVoiceCLI` capabilities. Keep menu state derivation and AppKit side effects local to `MenuBarSentinelView`; keep diagnostic snapshot JSON generation in `AppModel` so it can be unit-tested without AppKit. Add one small `AppModel` voice-test enhancement so replaying the latest spoken summary can reuse the existing CLI path.

**Tech Stack:** SwiftUI menu-bar app, AppKit `NSPasteboard` and `NSWorkspace`, XCTest source-level tests, existing Bun/TypeScript CLI invoked through `AgentVoiceCLI`.

---

## Scope and file map

**Spec:** `docs/superpowers/specs/2026-06-16-menu-smart-actions-design.md`

**Modify:**

- `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift`
  - Add source-level tests for the menu footer, Smart Actions state entries, existing action routing, and guarded utility side effects.
- `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`
  - Add a unit test proving `AppModel.testVoice(_:)` can speak a custom summary and refresh afterward.
  - Add a functional unit test proving diagnostic snapshot JSON contains the required top-level fields and `paths.queueDatabase`.
- `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift`
  - Change `testVoice()` to `testVoice(_ text: String = "Agent Voice test.")` so existing callers keep working and replay can pass a latest summary.
  - Add `diagnosticSnapshotJSON()` plus private encodable snapshot structs.
- `macos/AgentVoiceApp/Sources/AgentVoiceApp/MenuBarSentinelView.swift`
  - Add the Smart Actions menu in the footer area.
  - Add deterministic menu mode derivation: needs attention > daemon stopped > unavailable > daily.
  - Add local helpers for setup opening, diagnostic snapshot copying, Finder reveal, latest summary replay, doctor issue filtering, and failed job filtering.

**Do not modify:**

- CLI TypeScript commands. The spec says no new CLI command for this slice.
- Destructive queue/hook actions under Smart Actions. Existing destructive controls stay where they are.
- Dashboard or setup UI, except if compiler errors require call-site compatibility after the `testVoice` signature change.

**Safety note:** The current worktree already contains unrelated modified files, including at least one file this feature will edit. Before implementation, inspect the existing diff for every planned file and preserve unrelated hunks. Use hunk-only staging (`git add -p`) for any planned file that had pre-existing modifications.

---

### Task 0: Preflight existing diffs and protect unrelated work

**Files:**
- Inspect only: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift`
- Inspect only: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`
- Inspect only: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift`
- Inspect only: `macos/AgentVoiceApp/Sources/AgentVoiceApp/MenuBarSentinelView.swift`

- [ ] **Step 1: Record current worktree state**

Run:

```bash
git status --short
```

Expected: The worktree may contain unrelated existing changes. Do not reset, overwrite, or stage unrelated files.

- [ ] **Step 2: Inspect existing diffs for planned files**

Run:

```bash
git diff -- macos/AgentVoiceApp

git diff -- macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift \
  macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift \
  macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift \
  macos/AgentVoiceApp/Sources/AgentVoiceApp/MenuBarSentinelView.swift
```

Expected: Note any pre-existing Swift/app hunks before editing, including unrelated changes outside planned files such as `AgentVoiceApp.swift`. Later commits must stage only Smart Actions hunks.

- [ ] **Step 3: Confirm implementation scope**

If a required change appears outside the four planned files, stop and report why before editing it.

---

### Task 1: Add failing source and model tests

**Files:**
- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift`
- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`

- [ ] **Step 1: Add source-level Smart Actions tests**

Append these tests inside `AgentVoiceAppSourceTests` before `sourceSlice(...)`:

```swift
    func testMenuFooterKeepsExistingActionsAndAddsSmartActionsMenu() throws {
        let source = try appSource("MenuBarSentinelView.swift")
        let footer = try sourceSlice(in: source, from: "private var footer", to: "private var smartActionsMenu")

        XCTAssertTrue(footer.contains("smartActionsMenu"))
        XCTAssertTrue(footer.contains("actionButton(\"Dashboard\", systemImage: \"gauge\")"))
        XCTAssertTrue(footer.contains("actionButton(\"Setup\", systemImage: \"wrench.and.screwdriver\")"))
        XCTAssertTrue(footer.contains("actionButton(\"Quit Agent Voice\", systemImage: \"power\", role: .destructive)"))
    }

    func testSmartActionsExposeStateAwareEntries() throws {
        let source = try appSource("MenuBarSentinelView.swift")
        let smartActions = try sourceSlice(
            in: source,
            from: "private var smartActionsMenu",
            to: "private func openAttentionDetails"
        )

        XCTAssertTrue(smartActions.contains("Menu {"))
        XCTAssertTrue(smartActions.contains("Label(\"Smart Actions\", systemImage: \"sparkles\")"))
        XCTAssertTrue(source.contains("SmartActionMenuMode"))
        XCTAssertTrue(source.contains("case needsAttention"))
        XCTAssertTrue(source.contains("case daemonStopped"))
        XCTAssertTrue(source.contains("case unavailable"))
        XCTAssertTrue(source.contains("case daily"))
        XCTAssertTrue(smartActions.contains("Button(\"Open Attention Details\")"))
        XCTAssertTrue(smartActions.contains("Button(\"Refresh Diagnostics\")"))
        XCTAssertTrue(smartActions.contains("Button(\"Copy Diagnostic Snapshot\")"))
        XCTAssertTrue(smartActions.contains("Button(\"Reveal Agent Voice Home\")"))
        XCTAssertTrue(smartActions.contains("Button(\"Start Daemon\")"))
        XCTAssertTrue(smartActions.contains("Button(\"Open Setup\")"))
        XCTAssertTrue(smartActions.contains("Button(\"Replay Last Summary\")"))
        XCTAssertTrue(smartActions.contains("Button(\"Run Voice Test\")"))
    }

    func testSmartActionModePrioritizesAttentionBeforeDaemonStoppedAndUnknownStatus() throws {
        let source = try appSource("MenuBarSentinelView.swift")
        let mode = try sourceSlice(
            in: source,
            from: "private var smartActionMenuMode",
            to: "private var hasAttentionWork"
        )

        XCTAssertLessThan(
            try offset(of: "if hasAttentionWork", in: mode),
            try offset(of: "if model.status?.daemon.running == false", in: mode)
        )
        XCTAssertLessThan(
            try offset(of: "if model.status?.daemon.running == false", in: mode),
            try offset(of: "if model.status == nil", in: mode)
        )
        XCTAssertTrue(mode.contains("return .unavailable"))
    }

    func testSmartActionsRouteToExistingSafeActions() throws {
        let source = try appSource("MenuBarSentinelView.swift")
        let smartActions = try sourceSlice(
            in: source,
            from: "private var smartActionsMenu",
            to: "private func openAttentionDetails"
        )

        XCTAssertTrue(smartActions.contains("openAttentionDetails()"))
        XCTAssertTrue(smartActions.contains("Task { await model.refresh() }"))
        XCTAssertTrue(smartActions.contains("copyDiagnosticSnapshot()"))
        XCTAssertTrue(smartActions.contains("revealAgentVoiceHome()"))
        XCTAssertTrue(smartActions.contains("Task { await model.startDaemon() }"))
        XCTAssertTrue(smartActions.contains("openSetup()"))
        XCTAssertTrue(smartActions.contains("Task { await model.testVoice(summary) }"))
        XCTAssertTrue(smartActions.contains("Task { await model.testVoice() }"))
    }

    func testSmartActionsSnapshotAndRevealAreGuardedByAvailableData() throws {
        let source = try appSource("MenuBarSentinelView.swift")

        XCTAssertTrue(source.contains("private func diagnosticSnapshotJSON() -> String"))
        XCTAssertTrue(source.contains("model.diagnosticSnapshotJSON()"))
        XCTAssertTrue(source.contains("NSPasteboard.general"))
        XCTAssertTrue(source.contains("NSWorkspace.shared.open"))
        XCTAssertTrue(source.contains("guard let homePath = model.status?.paths.home"))
        XCTAssertTrue(source.contains("localActionError"))
        XCTAssertTrue(source.contains("FileManager.default.fileExists"))
    }
```

Update the existing `testMenuDashboardActionUsesSharedWindowIDAndActivatesApp` so it does not fail after setup routing moves behind `openSetup()`:

```swift
        XCTAssertTrue(footer.contains("openSetup()"))
        XCTAssertTrue(source.contains("private func openSetup()"))
        XCTAssertTrue(source.contains("openWindow(id: AgentVoiceWindowID.setup)"))
```

If this replaces the old assertion, remove or update:

```swift
        XCTAssertTrue(footer.contains("openWindow(id: AgentVoiceWindowID.setup)"))
```

Add this helper near `sourceSlice(...)`:

```swift
    private func offset(of marker: String, in source: String) throws -> String.Index {
        guard let range = source.range(of: marker) else {
            XCTFail("Missing marker: \(marker)")
            throw XCTSkip("Cannot verify source order without \(marker).")
        }
        return range.lowerBound
    }
```

- [ ] **Step 2: Add the custom voice-test model test**

Append this test inside `AppModelTests` near the existing mutating-action tests:

```swift
    func testTestVoiceCanSpeakCustomTextAndRefreshes() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "ok\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.testVoice("Claude finished the refactor.")

        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["test", "Claude finished the refactor."],
            ["status", "--json"],
            ["history", "--json", "--limit", "50"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }
```

- [ ] **Step 3: Add the functional diagnostic snapshot model test**

Append this test inside `AppModelTests` near the custom voice-test test:

```swift
    func testDiagnosticSnapshotJSONIncludesRequiredFields() async throws {
        let failedHistoryJSON = """
        {
          "version": 1,
          "jobs": [
            {
              "id": "failed-1",
              "agent": "pi",
              "status": "failed",
              "text": "raw",
              "createdAt": "2026-06-15T00:00:00.000Z",
              "finishedAt": "2026-06-15T00:01:00.000Z",
              "lastError": "boom",
              "attempts": 2
            }
          ]
        }
        """
        let warningDoctorJSON = """
        {
          "version": 1,
          "checks": [
            {
              "id": "tts.script",
              "ok": false,
              "severity": "error",
              "message": "Kokoro script missing",
              "action": "Set tts.kokoroScript"
            }
          ]
        }
        """
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(uiState: "needs_attention"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: failedHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: warningDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()
        let data = try XCTUnwrap(model.diagnosticSnapshotJSON().data(using: .utf8))
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let paths = try XCTUnwrap(root["paths"] as? [String: Any])
        let doctorIssues = try XCTUnwrap(root["doctorIssues"] as? [[String: Any]])
        let failedJobs = try XCTUnwrap(root["failedJobs"] as? [[String: Any]])

        XCTAssertEqual(root["statusState"] as? String, "needs_attention")
        XCTAssertNotNil(root["daemon"])
        XCTAssertNotNil(root["queues"])
        XCTAssertNotNil(root["attention"])
        XCTAssertEqual(paths["queueDatabase"] as? String, "/tmp/av/queue.db")
        XCTAssertEqual(doctorIssues.first?["id"] as? String, "tts.script")
        XCTAssertEqual(failedJobs.first?["lastError"] as? String, "boom")
    }
```

- [ ] **Step 4: Run the focused tests and verify they fail**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AgentVoiceAppSourceTests
swift test --package-path macos/AgentVoiceApp --filter AppModelTests/testTestVoiceCanSpeakCustomTextAndRefreshes
swift test --package-path macos/AgentVoiceApp --filter AppModelTests/testDiagnosticSnapshotJSONIncludesRequiredFields
```

Expected:

- `AgentVoiceAppSourceTests` fails because `smartActionsMenu`, snapshot helpers, and routing do not exist yet.
- The custom voice AppModel test fails to compile or fails because `testVoice(_:)` does not accept custom text yet.
- The diagnostic snapshot AppModel test fails because `diagnosticSnapshotJSON()` does not exist yet.

---

### Task 2: Add AppModel voice replay and diagnostic snapshot support

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift`
- Test: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`

- [ ] **Step 1: Update `testVoice` signature**

Replace:

```swift
    public func testVoice() async {
        await perform { try await cli.runVoiceTest("Agent Voice test.") }
    }
```

with:

```swift
    public func testVoice(_ text: String = "Agent Voice test.") async {
        await perform { try await cli.runVoiceTest(text) }
    }
```

This keeps existing `model.testVoice()` call sites compiling while enabling replay with `model.testVoice(summary)`.

- [ ] **Step 2: Add AppModel diagnostic snapshot JSON support**

Add this public method inside `AppModel`:

```swift
    public func diagnosticSnapshotJSON() -> String {
        let snapshot = AgentVoiceDiagnosticSnapshot(
            statusState: status?.ui.state.rawValue,
            daemon: status.map {
                AgentVoiceDiagnosticSnapshot.Daemon(
                    state: $0.daemon.state.rawValue,
                    running: $0.daemon.running,
                    pid: $0.daemon.pid
                )
            },
            queues: status?.queues,
            attention: status?.ui.attention ?? [],
            doctorIssues: diagnosticDoctorIssues.map {
                AgentVoiceDiagnosticSnapshot.DoctorIssue(
                    id: $0.id,
                    severity: $0.severity.rawValue,
                    message: $0.message,
                    action: $0.action
                )
            },
            failedJobs: diagnosticFailedJobs.prefix(5).map {
                AgentVoiceDiagnosticSnapshot.FailedJob(
                    id: $0.id,
                    agent: $0.agent,
                    attempts: $0.attempts,
                    timestamp: $0.finishedAt ?? $0.createdAt,
                    lastError: $0.lastError
                )
            },
            paths: status.map {
                AgentVoiceDiagnosticSnapshot.Paths(
                    home: $0.paths.home,
                    config: $0.paths.config,
                    queueDatabase: $0.paths.db
                )
            }
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard
            let data = try? encoder.encode(snapshot),
            let json = String(data: data, encoding: .utf8)
        else {
            return "{}"
        }
        return json
    }

    private var diagnosticDoctorIssues: [DoctorCheck] {
        doctorReport?.checks.filter {
            !$0.ok || $0.severity == .warning || $0.severity == .error
        } ?? []
    }

    private var diagnosticFailedJobs: [AgentVoiceHistoryJob] {
        history?.jobs.filter { $0.status == .failed } ?? []
    }
```

Add these private encodable structs at file scope in `AppModel.swift`:

```swift
private struct AgentVoiceDiagnosticSnapshot: Encodable {
    let statusState: String?
    let daemon: Daemon?
    let queues: QueueCounts?
    let attention: [String]
    let doctorIssues: [DoctorIssue]
    let failedJobs: [FailedJob]
    let paths: Paths?

    struct Daemon: Encodable {
        let state: String
        let running: Bool
        let pid: Int?
    }

    struct DoctorIssue: Encodable {
        let id: String
        let severity: String
        let message: String
        let action: String?
    }

    struct FailedJob: Encodable {
        let id: String
        let agent: String
        let attempts: Int
        let timestamp: String
        let lastError: String?
    }

    struct Paths: Encodable {
        let home: String
        let config: String
        let queueDatabase: String
    }
}
```

- [ ] **Step 3: Run the AppModel tests**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AppModelTests/testTestVoiceCanSpeakCustomTextAndRefreshes
swift test --package-path macos/AgentVoiceApp --filter AppModelTests/testDiagnosticSnapshotJSONIncludesRequiredFields
```

Expected: PASS.

- [ ] **Step 4: Commit the model slice**

```bash
git add -p macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift \
  macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift
git commit -m "feat: add menu diagnostics support"
```

---

### Task 3: Add Smart Actions menu structure and deterministic state routing

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/MenuBarSentinelView.swift`
- Test: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift`

- [ ] **Step 1: Add local state for UI-side action errors**

Near the top of `MenuBarSentinelView`, after the environment property, add:

```swift
    @State private var localActionError: String?
```

Update `errorBanner` to read from a combined error:

```swift
        if let lastError = surfacedError {
```

Add this computed property near the other private computed properties:

```swift
    private var surfacedError: String? {
        model.lastError ?? localActionError
    }
```

- [ ] **Step 2: Insert `smartActionsMenu` into the footer without removing existing actions**

At the start of `footer`'s `VStack`, before the `LazyVGrid`, add:

```swift
            smartActionsMenu
```

Keep the existing Dashboard, Setup, and Quit controls present.

- [ ] **Step 3: Route Setup through a helper**

Replace the inline setup action:

```swift
                    openWindow(id: AgentVoiceWindowID.setup)
                    NSApplication.shared.activate(ignoringOtherApps: true)
```

with:

```swift
                    openSetup()
```

Add:

```swift
    private func openSetup() {
        openWindow(id: AgentVoiceWindowID.setup)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }
```

- [ ] **Step 4: Add the Smart Actions menu and state enum**

Add this block between `footer` and `openAttentionDetails()`:

```swift
    private var smartActionsMenu: some View {
        Menu {
            switch smartActionMenuMode {
            case .needsAttention:
                Button("Open Attention Details") {
                    openAttentionDetails()
                }
                if model.status?.daemon.running == false {
                    Button("Start Daemon") {
                        Task { await model.startDaemon() }
                    }
                }
            case .daemonStopped:
                Button("Start Daemon") {
                    Task { await model.startDaemon() }
                }
            case .unavailable:
                Button("Run Voice Test") {
                    Task { await model.testVoice() }
                }
            case .daily:
                if let summary = latestSummaryText {
                    Button("Replay Last Summary") {
                        Task { await model.testVoice(summary) }
                    }
                } else {
                    Button("No Summary to Replay") {}
                        .disabled(true)
                }
                Button(model.status?.ui.state == .paused ? "Resume" : "Pause") {
                    Task {
                        if model.status?.ui.state == .paused {
                            await model.resume()
                        } else {
                            await model.pause()
                        }
                    }
                }
                Button("Run Voice Test") {
                    Task { await model.testVoice() }
                }
            }

            Divider()

            Button("Refresh Diagnostics") {
                Task { await model.refresh() }
            }

            Button("Open Setup") {
                openSetup()
            }

            Button("Copy Diagnostic Snapshot") {
                copyDiagnosticSnapshot()
            }

            if canRevealAgentVoiceHome {
                Button("Reveal Agent Voice Home") {
                    revealAgentVoiceHome()
                }
            } else {
                Button("Agent Voice Home Unavailable") {}
                    .disabled(true)
            }
        } label: {
            Label("Smart Actions", systemImage: "sparkles")
                .font(.caption.weight(.medium))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 8)
                .padding(.horizontal, 9)
                .background(Color.accentColor.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .menuStyle(.borderlessButton)
        .accessibilityLabel("Smart Actions")
        .accessibilityValue("Best next steps for current Agent Voice state")
    }
```

Add this enum near the bottom of the file, outside the view:

```swift
private enum SmartActionMenuMode {
    case needsAttention
    case daemonStopped
    case unavailable
    case daily
}
```

- [ ] **Step 5: Add mode derivation helpers**

Near the existing computed properties, add:

```swift
    private var smartActionMenuMode: SmartActionMenuMode {
        if hasAttentionWork {
            return .needsAttention
        }
        if model.status?.daemon.running == false {
            return .daemonStopped
        }
        if model.status == nil {
            return .unavailable
        }
        return .daily
    }

    private var hasAttentionWork: Bool {
        !(model.status?.ui.attention ?? []).isEmpty || !doctorIssues.isEmpty || !failedJobs.isEmpty
    }

    private var doctorIssues: [DoctorCheck] {
        model.doctorReport?.checks.filter {
            !$0.ok || $0.severity == .warning || $0.severity == .error
        } ?? []
    }

    private var failedJobs: [AgentVoiceHistoryJob] {
        model.history?.jobs.filter { $0.status == .failed } ?? []
    }

    private var latestSummaryText: String? {
        latestDoneJob?.summary?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
    }

    private var canRevealAgentVoiceHome: Bool {
        model.status?.paths.home.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }
```

Because `nilIfEmpty` does not exist, either add the small private extension below or inline the check. Preferred extension at file bottom:

```swift
private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
```

- [ ] **Step 6: Run the source tests and verify remaining failures are only utility helpers**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AgentVoiceAppSourceTests
```

Expected: Smart Actions structure and precedence assertions pass except assertions requiring `diagnosticSnapshotJSON`, `NSPasteboard`, `NSWorkspace`, and guarded home reveal, which are implemented in Task 4.

---

### Task 4: Add diagnostic snapshot copying and Finder reveal helpers

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/MenuBarSentinelView.swift`
- Test: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift`

- [ ] **Step 1: Add the menu snapshot wrapper**

Inside `MenuBarSentinelView`, add this wrapper so the menu uses the unit-tested `AppModel` snapshot builder:

```swift
    private func diagnosticSnapshotJSON() -> String {
        model.diagnosticSnapshotJSON()
    }
```

- [ ] **Step 2: Add safer clipboard and Finder side-effect helpers**

Inside `MenuBarSentinelView`, add:

```swift
    private func copyDiagnosticSnapshot() {
        let pasteboard = NSPasteboard.general
        let previousString = pasteboard.string(forType: .string)
        pasteboard.clearContents()
        if pasteboard.setString(diagnosticSnapshotJSON(), forType: .string) {
            localActionError = nil
        } else {
            if let previousString {
                pasteboard.setString(previousString, forType: .string)
            }
            localActionError = "Could not copy diagnostic snapshot"
        }
    }

    private func revealAgentVoiceHome() {
        guard let homePath = model.status?.paths.home.trimmingCharacters(in: .whitespacesAndNewlines),
              !homePath.isEmpty
        else {
            localActionError = "Agent Voice home path unavailable"
            return
        }

        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: homePath, isDirectory: &isDirectory), isDirectory.boolValue else {
            localActionError = "Agent Voice home path does not exist: \(homePath)"
            return
        }

        let url = URL(fileURLWithPath: homePath, isDirectory: true)
        if NSWorkspace.shared.open(url) {
            localActionError = nil
        } else {
            localActionError = "Could not reveal Agent Voice home: \(homePath)"
        }
    }
```

- [ ] **Step 3: Run source tests**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AgentVoiceAppSourceTests
```

Expected: PASS.

- [ ] **Step 4: Commit the menu UI slice**

```bash
git add -p macos/AgentVoiceApp/Sources/AgentVoiceApp/MenuBarSentinelView.swift \
  macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift
git commit -m "feat: add menu smart actions"
```

---

### Task 5: Full validation and cleanup

**Files:**
- Verify all modified Swift files.
- Do not commit unrelated TypeScript or test changes already present in the worktree.

- [ ] **Step 1: Run full Swift package tests**

Run:

```bash
swift test --package-path macos/AgentVoiceApp
```

Expected: PASS.

- [ ] **Step 2: Run Swift build**

Run:

```bash
swift build --package-path macos/AgentVoiceApp
```

Expected: PASS.

- [ ] **Step 3: Check edited-file diagnostics**

Run:

```bash
# Via pi-lens tool, not shell:
# lens_diagnostics mode=all
```

Expected: no blocking errors in files edited by this implementation.

- [ ] **Step 4: Manually validate local UI side effects when possible**

If a GUI session is available, launch the app and exercise the menu:

```bash
swift run --package-path macos/AgentVoiceApp AgentVoiceApp
```

Manual checks:

- Open the menu-bar popover and choose Smart Actions → Copy Diagnostic Snapshot.
- Paste the clipboard into a temporary file and validate it is JSON:

```bash
pbpaste | python3 -m json.tool >/tmp/agent-voice-smart-actions-snapshot.json
```

- Confirm the JSON contains top-level `statusState`, `daemon`, `queues`, `attention`, `doctorIssues`, `failedJobs`, and `paths.queueDatabase` fields when data is available.
- Choose Smart Actions → Reveal Agent Voice Home and confirm Finder opens the configured home directory.

Expected: Side effects work. If a GUI session is unavailable, skip this manual check and report the skip reason in the final summary.

- [ ] **Step 5: Review git status for unrelated files**

Run:

```bash
git status --short
```

Expected:

- Only planned Swift files are changed by this feature after the two implementation commits.
- Pre-existing unrelated TypeScript/test changes may still appear; do not stage or commit them for this feature.

- [ ] **Step 6: Final implementation summary**

Report:

- Changed files.
- Commits created.
- Test/build commands and outcomes.
- Mandatory skipped-check section: explicitly state whether clipboard and Finder side-effect checks were exercised. If either was skipped, include the reason and residual risk.
