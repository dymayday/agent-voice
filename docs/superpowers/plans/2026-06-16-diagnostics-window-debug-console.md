# Diagnostics Window Debug Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the macOS diagnostics/attention window into a useful debug console with readable summary sections, runtime/config/activity details, and a complete copyable diagnostic snapshot.

**Architecture:** Keep daemon/CLI contracts unchanged and expand only the macOS app layer. `AppModel` becomes best-effort when refreshing independent data sources and builds a richer JSON diagnostic snapshot from already-decoded status, history, doctor, config, and CLI runtime fields. `AttentionDetailView` becomes the structured diagnostics console using small SwiftUI section helpers over the same shared `AppModel`.

**Tech Stack:** Swift 6 / SwiftUI / AppKit pasteboard, Swift Package Manager XCTest source tests, existing TypeScript/Bun CLI tests for regression validation.

---

## Spec

Approved spec: `docs/superpowers/specs/2026-06-16-diagnostics-window-debug-console-design.md`

Key decisions already approved:

- Combined human troubleshooting + developer debugging console.
- Missing info should be grouped cleanly.
- Full raw job input text is allowed in the diagnostics UI and copied snapshot.
- Refresh must be best-effort per source: status, history, doctor, and config failures must not blank unrelated diagnostics.
- Doctor details include all checks plus a derived issues subset.
- Recent job debug data uses the existing `history(limit: 50)` app fetch and keeps full untruncated text for included jobs.

## File structure / responsibilities

- Modify `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift`
  - Keep public model state fields as-is.
  - Change `refresh()` to fetch status/history/doctor/config independently.
  - Expand private `AgentVoiceDiagnosticSnapshot` to encode runtime/config/recent job/doctor details while preserving existing keys.
- Modify `macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift`
  - Replace the current sparse attention detail layout with a structured diagnostics console.
  - Keep the same `AttentionDetailView` type and auto-refresh hooks so existing window/menu/dashboard routes continue to work.
  - Add local copy-to-pasteboard UI for raw snapshot JSON.
- Modify `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`
  - Add focused tests for best-effort refresh and expanded snapshot JSON.
  - Update existing snapshot-key tests for the new additive keys.
- Modify `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AttentionDetailViewSourceTests.swift`
  - Update source assertions for the new diagnostic sections and data sources.
- Optionally modify `macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift`
  - Only if the diagnostics window needs a slightly larger default size; keep `AgentVoiceWindowID.attention` unchanged.

Do not modify CLI behavior or SQLite schema. Do not stage unrelated untracked files such as `.superpowers/`.

---

### Task 1: Add failing core tests for best-effort refresh and expanded diagnostic snapshot

**Files:**
- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`

- [ ] **Step 1: Add fixture JSON for mixed recent jobs and all doctor checks**

Add these private fixtures near the existing `doneHistoryJSON` / `runningDoctorJSON` fixtures:

```swift
private let diagnosticHistoryJSON = """
{
  "version": 1,
  "jobs": [
    {
      "id": "failed-1",
      "agent": "pi",
      "status": "failed",
      "text": "full raw failed input with enough detail for debugging",
      "cwd": "/repo/project",
      "createdAt": "2026-06-15T00:00:00.000Z",
      "finishedAt": "2026-06-15T00:01:00.000Z",
      "summary": "Failure summary",
      "summarizerUsed": "codex",
      "lastError": "tts exploded",
      "attempts": 3
    },
    {
      "id": "skipped-1",
      "agent": "claude",
      "status": "skipped",
      "text": "full raw skipped input",
      "cwd": "/repo/other",
      "createdAt": "2026-06-15T00:02:00.000Z",
      "finishedAt": "2026-06-15T00:02:10.000Z",
      "summary": "Skipped summary",
      "summarizerUsed": "local",
      "skipReason": "empty_summary",
      "attempts": 1
    }
  ]
}
"""

private let diagnosticDoctorJSON = """
{
  "version": 1,
  "checks": [
    {
      "id": "daemon.running",
      "ok": true,
      "severity": "info",
      "message": "Daemon running"
    },
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
```

- [ ] **Step 2: Update the before-refresh snapshot test to require additive keys**

In `testDiagnosticSnapshotJSONBeforeRefreshIncludesRequiredFieldsWithNullUnavailableValues`, expand `requiredKeys` to include:

```swift
let requiredKeys = [
    "statusState",
    "daemon",
    "queues",
    "attention",
    "doctorChecks",
    "doctorIssues",
    "recentJobs",
    "failedJobs",
    "paths",
    "config",
    "executablePath",
    "agentVoiceHome",
    "lastError"
]
```

Add assertions:

```swift
XCTAssertTrue(root["config"] is NSNull)
XCTAssertEqual(root["executablePath"] as? String, "/repo/bin/agent-voice")
XCTTrue(root["agentVoiceHome"] is NSNull)
XCTTrue(root["lastError"] is NSNull)
XCTEqual((root["doctorChecks"] as? [Any])?.count, 0)
XCTEqual((root["recentJobs"] as? [Any])?.count, 0)
```

- [ ] **Step 3: Add a failing expanded snapshot test**

Add this test in `AppModelTests` near the existing diagnostic snapshot tests:

```swift
func testDiagnosticSnapshotJSONIncludesExpandedDebugContext() async throws {
    let runner = RecordingRunner(results: [
        ProcessResult(exitCode: 0, stdout: statusJSON(uiState: "needs_attention"), stderr: ""),
        ProcessResult(exitCode: 0, stdout: diagnosticHistoryJSON, stderr: ""),
        ProcessResult(exitCode: 0, stdout: diagnosticDoctorJSON, stderr: ""),
        ProcessResult(exitCode: 0, stdout: fullConfigJSON(voice: "af_sky", thinking: "medium"), stderr: "")
    ])
    let cli = AgentVoiceCLI(
        executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
        agentVoiceHome: URL(fileURLWithPath: "/tmp/custom-av"),
        runner: runner
    )
    let model = AppModel(cli: cli)

    await model.refresh()

    let data = try XCTUnwrap(model.diagnosticSnapshotJSON().data(using: .utf8))
    let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let config = try XCTUnwrap(root["config"] as? [String: Any])
    let tts = try XCTUnwrap(config["tts"] as? [String: Any])
    let summarizer = try XCTUnwrap(config["summarizer"] as? [String: Any])
    let doctorChecks = try XCTUnwrap(root["doctorChecks"] as? [[String: Any]])
    let doctorIssues = try XCTUnwrap(root["doctorIssues"] as? [[String: Any]])
    let recentJobs = try XCTUnwrap(root["recentJobs"] as? [[String: Any]])
    let failedJobs = try XCTUnwrap(root["failedJobs"] as? [[String: Any]])

    XCTAssertEqual(root["statusState"] as? String, "needs_attention")
    XCTAssertEqual(root["executablePath"] as? String, "/repo/bin/agent-voice")
    XCTAssertEqual(root["agentVoiceHome"] as? String, "/tmp/custom-av")
    XCTAssertEqual(tts["voice"] as? String, "af_sky")
    XCTAssertEqual(tts["kokoroScript"] as? String, "/tmp/kokoro.py")
    XCTAssertEqual(tts["timeoutSeconds"] as? Int, 30)
    XCTAssertEqual(summarizer["thinking"] as? String, "medium")
    XCTAssertEqual(doctorChecks.count, 2)
    XCTAssertEqual(doctorChecks.first?["id"] as? String, "daemon.running")
    XCTAssertEqual(doctorIssues.count, 1)
    XCTAssertEqual(doctorIssues.first?["id"] as? String, "tts.script")
    XCTAssertEqual(recentJobs.count, 2)
    XCTAssertEqual(recentJobs.first?["text"] as? String, "full raw failed input with enough detail for debugging")
    XCTAssertEqual(recentJobs.first?["cwd"] as? String, "/repo/project")
    XCTAssertEqual(recentJobs.first?["summarizerUsed"] as? String, "codex")
    XCTAssertEqual(recentJobs.first?["lastError"] as? String, "tts exploded")
    XCTAssertEqual(recentJobs[1]["skipReason"] as? String, "empty_summary")
    XCTAssertEqual(failedJobs.count, 1)
    XCTAssertEqual(failedJobs.first?["text"] as? String, "full raw failed input with enough detail for debugging")
}
```

- [ ] **Step 4: Add a failing best-effort refresh test**

Add this test in `AppModelTests`:

```swift
func testRefreshIsBestEffortWhenStatusFailsButOtherSourcesSucceed() async throws {
    let runner = RecordingRunner(results: [
        ProcessResult(exitCode: 2, stdout: "", stderr: "status boom\n"),
        ProcessResult(exitCode: 0, stdout: diagnosticHistoryJSON, stderr: ""),
        ProcessResult(exitCode: 0, stdout: diagnosticDoctorJSON, stderr: ""),
        ProcessResult(exitCode: 0, stdout: fullConfigJSON(voice: "bf_emma", thinking: "high"), stderr: "")
    ])
    let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
    let model = AppModel(cli: cli)

    await model.refresh()

    XCTAssertNil(model.status)
    XCTAssertEqual(model.history?.jobs.count, 2)
    XCTAssertEqual(model.doctorReport?.checks.count, 2)
    XCTAssertEqual(model.config?.tts.voice, "bf_emma")
    XCTAssertEqual(model.draftVoice, "bf_emma")
    XCTAssertEqual(model.draftThinking, "high")
    XCTAssertTrue(model.lastError?.contains("status") == true)
    XCTAssertTrue(model.lastError?.contains("status boom") == true)

    let requests = await runner.capturedRequests()
    XCTAssertEqual(requests.map(\.arguments), [
        ["status", "--json"],
        ["history", "--json", "--limit", "50"],
        ["doctor", "--json"],
        ["config", "get"]
    ])
}
```

- [ ] **Step 5: Run the new tests and verify they fail**

Run:

```bash
cd macos/AgentVoiceApp && swift test --filter AppModelTests/testDiagnosticSnapshotJSONIncludesExpandedDebugContext
cd macos/AgentVoiceApp && swift test --filter AppModelTests/testRefreshIsBestEffortWhenStatusFailsButOtherSourcesSucceed
```

Expected: both fail because `refresh()` is still all-or-nothing and the snapshot lacks new keys.

---

### Task 2: Implement best-effort refresh and expanded diagnostic snapshot

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift`

- [ ] **Step 1: Replace `refresh()` with independent source fetching**

Replace the current `public func refresh() async` body with:

```swift
public func refresh() async {
    var errors: [String] = []

    do {
        status = try await cli.status()
    } catch {
        errors.append("status: \(String(describing: error))")
    }

    do {
        history = try await cli.history(limit: 50)
    } catch {
        errors.append("history: \(String(describing: error))")
    }

    do {
        doctorReport = try await cli.doctor()
    } catch {
        errors.append("doctor: \(String(describing: error))")
    }

    do {
        let refreshedConfig = try await cli.config()
        config = refreshedConfig
        draftVoice = refreshedConfig.tts.voice
        draftThinking = refreshedConfig.summarizer.thinking
    } catch {
        errors.append("config: \(String(describing: error))")
    }

    lastError = errors.isEmpty ? nil : errors.joined(separator: "\n")
}
```

Decision: failed sources leave previous cached model values untouched. This satisfies the spec’s “successfully fetched or previously cached data” requirement.

- [ ] **Step 2: Pass expanded data into `AgentVoiceDiagnosticSnapshot`**

Change `diagnosticSnapshotJSON()` snapshot construction from:

```swift
let snapshot = AgentVoiceDiagnosticSnapshot(
    status: status,
    doctorIssues: diagnosticDoctorIssues,
    failedJobs: diagnosticFailedJobs
)
```

to:

```swift
let snapshot = AgentVoiceDiagnosticSnapshot(
    status: status,
    history: history,
    doctorReport: doctorReport,
    config: config,
    lastError: lastError,
    executablePath: cli.executableURL.path,
    agentVoiceHome: cli.agentVoiceHome?.path
)
```

- [ ] **Step 3: Replace the private snapshot struct implementation**

Replace `private struct AgentVoiceDiagnosticSnapshot: Encodable` and its nested structs with an additive version that preserves existing keys:

```swift
private struct AgentVoiceDiagnosticSnapshot: Encodable {
    private let statusState: String?
    private let daemon: Daemon?
    private let queues: QueueCounts?
    private let attention: [String]
    private let doctorChecks: [DoctorCheckSnapshot]
    private let doctorIssues: [DoctorCheckSnapshot]
    private let recentJobs: [DiagnosticJob]
    private let failedJobs: [DiagnosticJob]
    private let paths: Paths?
    private let config: Config?
    private let executablePath: String
    private let agentVoiceHome: String?
    private let lastError: String?

    init(
        status: AgentVoiceStatusSnapshot?,
        history: AgentVoiceHistorySnapshot?,
        doctorReport: DoctorReport?,
        config: AgentVoiceFullConfig?,
        lastError: String?,
        executablePath: String,
        agentVoiceHome: String?
    ) {
        statusState = status?.ui.state.rawValue
        daemon = status.map {
            Daemon(
                state: $0.daemon.state.rawValue,
                running: $0.daemon.running,
                pid: $0.daemon.pid
            )
        }
        queues = status?.queues
        attention = status?.ui.attention ?? []
        doctorChecks = doctorReport?.checks.map(DoctorCheckSnapshot.init) ?? []
        doctorIssues = doctorChecks.filter { !$0.ok || $0.severity == DoctorCheck.Severity.warning.rawValue || $0.severity == DoctorCheck.Severity.error.rawValue }
        recentJobs = history?.jobs.map(DiagnosticJob.init) ?? []
        failedJobs = history?.jobs.filter { $0.status == .failed }.map(DiagnosticJob.init) ?? []
        paths = status.map {
            Paths(
                home: $0.paths.home,
                config: $0.paths.config,
                queueDatabase: $0.paths.db
            )
        }
        if status == nil && config == nil {
            self.config = nil
        } else {
            self.config = Config(
                enabled: status?.config.enabled,
                agents: status?.config.agents,
                tts: config?.tts,
                summarizer: config?.summarizer
            )
        }
        self.executablePath = executablePath
        self.agentVoiceHome = agentVoiceHome
        self.lastError = lastError
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(statusState, forKey: .statusState)
        try container.encode(daemon, forKey: .daemon)
        try container.encode(queues, forKey: .queues)
        try container.encode(attention, forKey: .attention)
        try container.encode(doctorChecks, forKey: .doctorChecks)
        try container.encode(doctorIssues, forKey: .doctorIssues)
        try container.encode(recentJobs, forKey: .recentJobs)
        try container.encode(failedJobs, forKey: .failedJobs)
        try container.encode(paths, forKey: .paths)
        try container.encode(config, forKey: .config)
        try container.encode(executablePath, forKey: .executablePath)
        try container.encode(agentVoiceHome, forKey: .agentVoiceHome)
        try container.encode(lastError, forKey: .lastError)
    }

    private enum CodingKeys: String, CodingKey {
        case statusState
        case daemon
        case queues
        case attention
        case doctorChecks
        case doctorIssues
        case recentJobs
        case failedJobs
        case paths
        case config
        case executablePath
        case agentVoiceHome
        case lastError
    }

    private struct Daemon: Encodable {
        let state: String
        let running: Bool
        let pid: Int?
    }

    private struct DoctorCheckSnapshot: Encodable {
        let id: String
        let ok: Bool
        let severity: String
        let message: String
        let action: String?

        init(_ check: DoctorCheck) {
            id = check.id
            ok = check.ok
            severity = check.severity.rawValue
            message = check.message
            action = check.action
        }
    }

    private struct DiagnosticJob: Encodable {
        let id: String
        let agent: String
        let status: String
        let text: String
        let cwd: String?
        let createdAt: String
        let finishedAt: String?
        let summary: String?
        let summarizerUsed: String?
        let skipReason: String?
        let lastError: String?
        let attempts: Int

        init(_ job: AgentVoiceHistoryJob) {
            id = job.id
            agent = job.agent
            status = job.status.rawValue
            text = job.text
            cwd = job.cwd
            createdAt = job.createdAt
            finishedAt = job.finishedAt
            summary = job.summary
            summarizerUsed = job.summarizerUsed
            skipReason = job.skipReason
            lastError = job.lastError
            attempts = job.attempts
        }
    }

    private struct Paths: Encodable {
        let home: String
        let config: String
        let queueDatabase: String
    }

    private struct Config: Encodable {
        let enabled: Bool?
        let agents: [String: AgentSummary]?
        let tts: TTSConfig?
        let summarizer: SummarizerConfig?
    }
}
```

- [ ] **Step 4: Run focused AppModel tests**

Run:

```bash
cd macos/AgentVoiceApp && swift test --filter AppModelTests
```

Expected: all `AppModelTests` pass.

- [ ] **Step 5: Commit Task 1-2 changes**

```bash
git add macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift
git commit -m "feat: expand diagnostics snapshot context"
```

---

### Task 3: Add failing source tests for the diagnostics console sections

**Files:**
- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AttentionDetailViewSourceTests.swift`

- [ ] **Step 1: Replace section/source assertions**

Update `testAttentionDetailViewIncludesRequiredSectionsAndDataSources` so it checks for the new console sections and data sources:

```swift
func testAttentionDetailViewIncludesRequiredSectionsAndDataSources() throws {
    let source = try appSource("AttentionDetailView.swift")

    XCTAssertTrue(source.contains("struct AttentionDetailView: View"))
    XCTAssertTrue(source.contains("@ObservedObject var model: AppModel"))
    XCTAssertTrue(source.contains("Diagnostics"))
    XCTAssertTrue(source.contains("Health summary"))
    XCTAssertTrue(source.contains("Runtime and paths"))
    XCTAssertTrue(source.contains("Queue and activity"))
    XCTAssertTrue(source.contains("Configuration context"))
    XCTAssertTrue(source.contains("Doctor checks"))
    XCTAssertTrue(source.contains("Raw diagnostic snapshot"))
    XCTAssertTrue(source.contains("model.status?.ui.attention"))
    XCTAssertTrue(source.contains("model.status?.queues"))
    XCTAssertTrue(source.contains("model.config"))
    XCTAssertTrue(source.contains("model.doctorReport?.checks"))
    XCTAssertTrue(source.contains("model.history?.jobs"))
    XCTAssertTrue(source.contains("job.text"))
    XCTAssertTrue(source.contains("job.summarizerUsed"))
    XCTAssertTrue(source.contains("model.diagnosticSnapshotJSON()"))
    XCTAssertTrue(source.contains("NSPasteboard.general"))
    XCTAssertTrue(source.contains("model.startAutoRefresh()"))
    XCTAssertTrue(source.contains("model.stopAutoRefresh()"))
    XCTAssertTrue(source.contains("textSelection(.enabled)"))
}
```

Keep `testAttentionDetailViewUsesOnePrimaryScrollRegion` unchanged.

- [ ] **Step 2: Run the source test and verify it fails**

Run:

```bash
cd macos/AgentVoiceApp && swift test --filter AttentionDetailViewSourceTests/testAttentionDetailViewIncludesRequiredSectionsAndDataSources
```

Expected: FAIL because the current view still has only sparse attention/doctor/failed job sections.

---

### Task 4: Implement the structured diagnostics console view

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift`
- Optionally modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift`

- [ ] **Step 1: Add AppKit import and local copy feedback state**

At the top of `AttentionDetailView.swift`, add AppKit:

```swift
import AgentVoiceCore
import AppKit
import SwiftUI
```

Inside `struct AttentionDetailView`, add:

```swift
@State private var copyFeedback: String?
```

- [ ] **Step 2: Change the primary body section list**

Update the `VStack` inside `body` to use the new sections in this order:

```swift
VStack(alignment: .leading, spacing: 20) {
    Text("Diagnostics")
        .font(.largeTitle.bold())
        .accessibilityAddTraits(.isHeader)

    healthSummarySection
    runtimeSection
    queueActivitySection
    configurationSection
    doctorChecksSection
    rawSnapshotSection
}
```

Keep the existing `.frame`, `.padding`, `.onAppear`, and `.onDisappear` behavior. Increase the outer frame to roughly `minWidth: 760, minHeight: 620` if needed.

- [ ] **Step 3: Add computed data helpers**

In `private extension AttentionDetailView`, keep `attentionMessages`, replace `doctorIssues` / `failedJobs` with these helpers:

```swift
var attentionMessages: [String] {
    model.status?.ui.attention ?? []
}

var allDoctorChecks: [DoctorCheck] {
    model.doctorReport?.checks ?? []
}

var doctorIssues: [DoctorCheck] {
    allDoctorChecks.filter {
        !$0.ok || $0.severity == .warning || $0.severity == .error
    }
}

var recentJobs: [AgentVoiceHistoryJob] {
    model.history?.jobs ?? []
}

var failedJobs: [AgentVoiceHistoryJob] {
    recentJobs.filter { $0.status == .failed }
}
```

- [ ] **Step 4: Implement `healthSummarySection`**

Add:

```swift
@ViewBuilder
var healthSummarySection: some View {
    detailCard("Health summary", systemImage: "heart.text.square", tint: healthTint) {
        VStack(alignment: .leading, spacing: 10) {
            labeledRow("UI state", model.status?.ui.state.displayName ?? "Status unavailable")
            labeledRow("Daemon", daemonSummary)
            if let queues = model.status?.queues {
                labeledRow("Queue pressure", "pending \(queues.pending) · processing \(queues.processing) · failed \(queues.failed)")
            } else {
                labeledRow("Queue pressure", "Queue counts unavailable")
            }
            if attentionMessages.isEmpty {
                Label("No active attention flags", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            } else {
                ForEach(attentionMessages, id: \.self) { message in
                    Label(message, systemImage: "bell.badge.fill")
                        .foregroundStyle(.orange)
                        .textSelection(.enabled)
                }
            }
            if let lastError = model.lastError, !lastError.isEmpty {
                Text(lastError)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }
        }
    }
}
```

Add helper values:

```swift
var daemonSummary: String {
    guard let daemon = model.status?.daemon else { return "Daemon status unavailable" }
    let pid = daemon.pid.map { " pid=\($0)" } ?? ""
    return "\(daemon.state.rawValue) · running \(daemon.running ? "yes" : "no")\(pid)"
}

var healthTint: Color {
    if model.status?.ui.state == .needsAttention || !failedJobs.isEmpty { return .red }
    if model.status?.ui.state == .processing { return .blue }
    if model.status?.ui.state == .ready { return .green }
    if model.status?.ui.state == .paused { return .orange }
    return .secondary
}
```

- [ ] **Step 5: Implement `runtimeSection`**

Add:

```swift
@ViewBuilder
var runtimeSection: some View {
    detailCard("Runtime and paths", systemImage: "terminal", tint: .blue) {
        VStack(alignment: .leading, spacing: 8) {
            labeledRow("Daemon state", model.status?.daemon.state.rawValue ?? "Unknown")
            labeledRow("Running", model.status?.daemon.running == true ? "Yes" : model.status == nil ? "Unknown" : "No")
            labeledRow("PID", model.status?.daemon.pid.map(String.init) ?? "None")
            labeledRow("CLI executable", model.cli.executableURL.path)
            labeledRow("Agent Voice home", model.status?.paths.home ?? model.cli.agentVoiceHome?.path ?? "Unknown")
            labeledRow("Config", model.status?.paths.config ?? "Unknown")
            labeledRow("Queue database", model.status?.paths.db ?? "Unknown")
        }
    }
}
```

- [ ] **Step 6: Implement `queueActivitySection` and job cards**

Add:

```swift
@ViewBuilder
var queueActivitySection: some View {
    detailCard("Queue and activity", systemImage: "tray.full", tint: failedJobs.isEmpty ? .green : .red) {
        VStack(alignment: .leading, spacing: 12) {
            if let queues = model.status?.queues {
                labeledRow("Pending", String(queues.pending))
                labeledRow("Processing", String(queues.processing))
                labeledRow("Done", String(queues.done))
                labeledRow("Failed", String(queues.failed))
                labeledRow("Skipped", String(queues.skipped))
            } else {
                emptyState("Queue counts unavailable.")
            }

            Divider()

            if model.history == nil {
                emptyState("History unavailable. Refresh the dashboard and try again.")
            } else if recentJobs.isEmpty {
                emptyState("No recent terminal jobs in history.")
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(recentJobs) { job in
                        jobCard(job)
                    }
                }
            }
        }
    }
}

func jobCard(_ job: AgentVoiceHistoryJob) -> some View {
    VStack(alignment: .leading, spacing: 6) {
        Text("\(job.agent.capitalized) · \(job.status.rawValue)")
            .font(.headline)
        labeledRow("ID", job.id)
        labeledRow("Created", job.createdAt)
        labeledRow("Finished", job.finishedAt ?? "None")
        labeledRow("Attempts", String(job.attempts))
        labeledRow("CWD", job.cwd ?? "None")
        labeledRow("Summarizer", job.summarizerUsed ?? "None")
        labeledRow("Skip reason", job.skipReason ?? "None")
        if let summary = job.summary, !summary.isEmpty {
            diagnosticTextBlock("Summary", summary)
        }
        if let lastError = job.lastError, !lastError.isEmpty {
            diagnosticTextBlock("Last error", lastError, tint: .red)
        }
        diagnosticTextBlock("Raw job text", job.text)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(12)
    .background(Color.secondary.opacity(0.08))
    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
}
```

- [ ] **Step 7: Implement `configurationSection`**

Add:

```swift
@ViewBuilder
var configurationSection: some View {
    detailCard("Configuration context", systemImage: "slider.horizontal.3", tint: .teal) {
        VStack(alignment: .leading, spacing: 10) {
            labeledRow("Global enabled", model.status?.config.enabled == true ? "Yes" : model.status == nil ? "Unknown" : "No")
            labeledRow("Voice", model.config?.tts.voice ?? "Unknown")
            labeledRow("Kokoro script", model.config?.tts.kokoroScript ?? "Unknown")
            labeledRow("Python", model.config?.tts.python ?? "Unknown")
            let timeout = model.config.map { String($0.tts.timeoutSeconds) } ?? "Unknown"
            labeledRow("TTS timeout", timeout)
            labeledRow("Summarizer thinking", model.config?.summarizer.thinking ?? "Unknown")

            let agents = model.status?.config.agents ?? [:]
            if agents.isEmpty {
                emptyState("Agent config unavailable.")
            } else {
                ForEach(agents.keys.sorted(), id: \.self) { name in
                    let agent = agents[name]
                    labeledRow("Agent \(name)", "\(agent?.enabled == true ? "enabled" : "disabled") · \(agent?.mode ?? "unknown")")
                }
            }
        }
    }
}
```

- [ ] **Step 8: Implement `doctorChecksSection` using all checks**

Replace the old `doctorIssuesSection` with:

```swift
@ViewBuilder
var doctorChecksSection: some View {
    detailCard("Doctor checks", systemImage: "stethoscope", tint: doctorIssues.isEmpty ? .green : .orange) {
        if model.doctorReport == nil {
            emptyState("Diagnostics unavailable. Run doctor or refresh the dashboard.")
        } else if allDoctorChecks.isEmpty {
            emptyState("No doctor checks returned.")
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(allDoctorChecks.sorted { lhs, rhs in
                    if lhs.ok == rhs.ok { return lhs.id < rhs.id }
                    return !lhs.ok && rhs.ok
                }) { check in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Image(systemName: check.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                            Text(check.message)
                                .textSelection(.enabled)
                        }
                        .foregroundStyle(severityTint(check.severity))
                        labeledRow("ID", check.id)
                        labeledRow("Status", check.ok ? "OK" : "Needs review")
                        labeledRow("Severity", check.severity.rawValue)
                        if let action = check.action, !action.isEmpty {
                            diagnosticTextBlock("Action", action)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}
```

- [ ] **Step 9: Implement raw snapshot copy section**

Add:

```swift
@ViewBuilder
var rawSnapshotSection: some View {
    detailCard("Raw diagnostic snapshot", systemImage: "doc.on.clipboard", tint: .purple) {
        VStack(alignment: .leading, spacing: 10) {
            Text("Includes full raw job text for the recent history entries shown above. Copy only when you intend to share that debugging context.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)

            Button("Copy Raw Snapshot") {
                copyRawSnapshot()
            }

            if let copyFeedback {
                Text(copyFeedback)
                    .font(.caption)
                    .foregroundStyle(copyFeedback.contains("Could not") ? .red : .secondary)
                    .textSelection(.enabled)
            }

            Text(model.diagnosticSnapshotJSON())
                .font(.system(.caption, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

func copyRawSnapshot() {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    if pasteboard.setString(model.diagnosticSnapshotJSON(), forType: .string) {
        copyFeedback = "Copied diagnostic snapshot"
    } else {
        copyFeedback = "Could not copy diagnostic snapshot"
    }
}
```

- [ ] **Step 10: Add reusable row/text helpers**

Add these helpers near `emptyState`:

```swift
func labeledRow(_ title: String, _ value: String) -> some View {
    HStack(alignment: .firstTextBaseline) {
        Text(title)
            .foregroundStyle(.secondary)
        Spacer(minLength: 12)
        Text(value)
            .multilineTextAlignment(.trailing)
            .textSelection(.enabled)
    }
    .font(.subheadline)
    .accessibilityElement(children: .combine)
}

func diagnosticTextBlock(_ title: String, _ value: String, tint: Color = .secondary) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
        Text(value)
            .foregroundStyle(tint)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
```

Keep `detailCard`, `emptyState`, and `severityTint`, updating only as needed for section names and new helpers.

- [ ] **Step 11: Optionally enlarge the attention window default size**

If the new view feels cramped, update `macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift`:

```swift
Window("Attention", id: AgentVoiceWindowID.attention) {
    AttentionDetailView(model: model)
}
.defaultSize(width: 900, height: 760)
```

Do not rename the window ID.

- [ ] **Step 12: Run focused source tests**

Run:

```bash
cd macos/AgentVoiceApp && swift test --filter AttentionDetailViewSourceTests
```

Expected: PASS.

- [ ] **Step 13: Run Swift formatting-by-compiler check**

Run:

```bash
cd macos/AgentVoiceApp && swift test
```

Expected: PASS. If Swift compilation fails, fix the specific type-checking issue before proceeding.

- [ ] **Step 14: Commit diagnostics view changes**

```bash
git add macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AttentionDetailViewSourceTests.swift
git commit -m "feat: add diagnostics debug console"
```

If `AgentVoiceApp.swift` was not modified, omit it from `git add`.

---

### Task 5: Regression validation and cleanup

**Files:**
- Read/verify only unless fixes are needed.

- [ ] **Step 1: Run full Swift package tests**

Run:

```bash
cd macos/AgentVoiceApp && swift test
```

Expected: PASS.

- [ ] **Step 2: Run Bun tests**

Run from repository root:

```bash
bun test
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript typecheck**

Run from repository root:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run LSP diagnostics when available**

Use pi-lens if available:

```text
lsp_diagnostics({ filePaths: [
  "macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift",
  "macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift",
  "macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift",
  "macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AttentionDetailViewSourceTests.swift"
], severity: "all" })
```

Expected: no blocking diagnostics. If no Swift language service is available, record that as a validation limitation and rely on `swift test`.

- [ ] **Step 5: Inspect the final diff**

Run:

```bash
git diff --stat HEAD~2..HEAD
git diff HEAD~2..HEAD -- macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AttentionDetailViewSourceTests.swift
```

Expected: changes are limited to approved diagnostics behavior and tests.

- [ ] **Step 6: Confirm working tree state**

Run:

```bash
git status --short
```

Expected: no unexpected modified files. Unrelated pre-existing untracked `.superpowers/` may remain uncommitted; do not include it unless explicitly requested.

---

## Implementation notes and gotchas

- `AgentVoiceCLI.executableURL` and `agentVoiceHome` are already public, so no CLI model change is needed to include runtime paths in the snapshot/UI.
- `AgentVoiceFullConfig` only decodes `tts` and `summarizer`; global enabled/agent mode comes from `status.config`.
- Preserve the old diagnostic snapshot keys (`statusState`, `daemon`, `queues`, `attention`, `doctorIssues`, `failedJobs`, `paths`) so menu copy actions and tests depending on stable keys keep working.
- The expanded `failedJobs` should be derived from the same recent history fetch as `recentJobs`, not by making a new CLI call.
- Full job text is intentionally untruncated for included history jobs per user approval. Do not add redaction or truncation.
- `AppModel.refresh()` should record failures in `lastError` but should not clear successful or cached data for other sources.
