# Attention Detail Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clickable Attention detail window that opens from dashboard and menu-bar attention surfaces and shows the relevant attention messages, doctor issues, and failed jobs.

**Architecture:** Add one singleton SwiftUI window backed by the existing shared `AppModel`; no CLI or persistence changes. Add a focused `AttentionDetailView` in the app target and wire existing dashboard/menu-bar attention surfaces to `openWindow(id: AgentVoiceWindowID.attention)` plus app activation.

**Tech Stack:** Swift 6, SwiftUI, AppKit activation via `NSApplication`, XCTest source-level app tests, existing `AgentVoiceCore` models.

---

## File structure

- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift`
  - Add `AgentVoiceWindowID.attention`.
  - Register `Window("Attention", id: AgentVoiceWindowID.attention)` using shared `AppModel`.
- Create: `macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift`
  - New SwiftUI view that renders attention messages, doctor issues, and failed jobs from `AppModel`.
  - Keep all attention-specific derived data local to this view or in small private computed properties.
  - Start/stop the shared `AppModel` auto-refresh loop while the standalone window is visible so it stays fresh after the menu-bar popover closes.
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/DashboardView.swift`
  - Add `@Environment(\.openWindow)`.
  - Convert the attention messages and diagnostic review summary into click targets.
  - Open/activate the Attention window.
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/MenuBarSentinelView.swift`
  - Make `attentionBanner` clickable.
  - Reuse a private `openAttentionDetails()` helper parallel to `openDashboard()`.
- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift`
  - Add source-level assertions for the new window id and scene registration.
- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/DashboardViewSourceTests.swift`
  - Add source-level assertions that dashboard attention/diagnostic surfaces open the attention window.
- Create: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AttentionDetailViewSourceTests.swift`
  - Source-level assertions that the detail view includes the three required sections, explicit unavailable/empty states, auto-refresh lifecycle hooks, selectable diagnostic text, and a single primary scroll region.
- Optional docs update: `README.md`
  - Not required for this UI-only feature; skip unless implementation reveals a user-facing dashboard behavior worth documenting.

## Relevant existing patterns

- `MenuBarSentinelView` already uses `@Environment(\.openWindow)` and `NSApplication.shared.activate(ignoringOtherApps: true)` in `openDashboard()`.
- App source tests currently read SwiftUI app files as strings because the test target depends on `AgentVoiceCore`, not the `AgentVoiceApp` executable target.
- `DashboardView` has helper computed properties in `AgentVoiceApp.swift`:
  - `doctorIssues`: failed checks or warning/error checks.
  - `failedJobs`: history jobs with `status == .failed`.
- Preserve the existing shared auto-refresh behavior; `AttentionDetailView` should subscribe with `model.startAutoRefresh()` on appear and unsubscribe with `model.stopAutoRefresh()` on disappear, matching the dashboard/menu surfaces without creating an independent refresh loop.

---

### Task 1: Add failing source tests for the attention window and entry points

**Files:**
- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift`
- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/DashboardViewSourceTests.swift`
- Create: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AttentionDetailViewSourceTests.swift`

- [ ] **Step 1: Add App source tests for stable attention window id and scene**

Append to `AgentVoiceAppSourceTests`:

```swift
func testAttentionWindowIDAndSceneAreRegistered() throws {
    let source = try appSource("AgentVoiceApp.swift")

    XCTAssertTrue(source.contains("static let attention = \"attention\""))
    XCTAssertTrue(source.contains("Window(\"Attention\", id: AgentVoiceWindowID.attention)"))
    XCTAssertTrue(source.contains("AttentionDetailView(model: model)"))
    XCTAssertFalse(
        source.contains("WindowGroup(\"Attention"),
        "Attention should be a singleton Window so repeated clicks focus the same detail surface."
    )
}
```

Also update `testWindowIDsStayStableForMenuOpenActions()`:

```swift
XCTAssertTrue(source.contains("static let attention = \"attention\""))
```

- [ ] **Step 2: Add Dashboard source test for clickable attention entry points**

Append to `DashboardViewSourceTests`:

```swift
func testDashboardAttentionSurfacesOpenAttentionWindow() throws {
    let source = try dashboardViewSource()
    let health = try propertyBody(named: "healthCard", in: source)
    let diagnostics = try propertyBody(named: "diagnosticsCard", in: source)

    XCTAssertTrue(source.contains("@Environment(\\.openWindow) private var openWindow"))
    XCTAssertTrue(source.contains("func openAttentionDetails()"))
    XCTAssertTrue(source.contains("openWindow(id: AgentVoiceWindowID.attention)"))
    XCTAssertTrue(source.contains("NSApplication.shared.activate(ignoringOtherApps: true)"))
    XCTAssertTrue(health.contains("openAttentionDetails()"))
    XCTAssertTrue(diagnostics.contains("openAttentionDetails()"))
}
```

- [ ] **Step 3: Add Menu source test for clickable attention banner**

Append to `AgentVoiceAppSourceTests` or create a separate menu source test method in the same file:

```swift
func testMenuAttentionBannerOpensAttentionWindowAndActivatesApp() throws {
    let source = try appSource("MenuBarSentinelView.swift")
    let attentionBanner = try sourceSlice(
        in: source,
        from: "private var attentionBanner",
        to: "private var queueOverview"
    )
    let openAttention = try sourceSlice(
        in: source,
        from: "private func openAttentionDetails",
        to: "private func openDashboard"
    )

    XCTAssertTrue(attentionBanner.contains("openAttentionDetails()"))
    XCTAssertTrue(openAttention.contains("openWindow(id: AgentVoiceWindowID.attention)"))
    XCTAssertTrue(openAttention.contains("NSApplication.shared.activate(ignoringOtherApps: true)"))
}
```

If `openAttentionDetails` is placed after `openDashboard`, adjust the `sourceSlice` end marker to the next helper, for example `private func sectionTitle`.

- [ ] **Step 4: Add AttentionDetailView source tests**

Create `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AttentionDetailViewSourceTests.swift`:

```swift
import XCTest

final class AttentionDetailViewSourceTests: XCTestCase {
    func testAttentionDetailViewIncludesRequiredSectionsAndDataSources() throws {
        let source = try appSource("AttentionDetailView.swift")

        XCTAssertTrue(source.contains("struct AttentionDetailView: View"))
        XCTAssertTrue(source.contains("@ObservedObject var model: AppModel"))
        XCTAssertTrue(source.contains("Attention messages"))
        XCTAssertTrue(source.contains("Doctor checks needing review"))
        XCTAssertTrue(source.contains("Failed jobs and recent errors"))
        XCTAssertTrue(source.contains("model.status?.ui.attention"))
        XCTAssertTrue(source.contains("model.doctorReport == nil"))
        XCTAssertTrue(source.contains("model.history == nil"))
        XCTAssertTrue(source.contains("$0.status == .failed"))
        XCTAssertTrue(source.contains("model.startAutoRefresh()"))
        XCTAssertTrue(source.contains("model.stopAutoRefresh()"))
        XCTAssertTrue(source.contains("Text(check.message)"))
        XCTAssertTrue(source.contains("textSelection(.enabled)"))
    }

    func testAttentionDetailViewUsesOnePrimaryScrollRegion() throws {
        let source = try appSource("AttentionDetailView.swift")

        XCTAssertTrue(source.contains("ScrollView"))
        XCTAssertEqual(source.components(separatedBy: "ScrollView").count - 1, 1)
    }

    private func appSource(_ fileName: String) throws -> String {
        let testFile = URL(fileURLWithPath: #filePath)
        let packageRoot = testFile
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let sourceFile = packageRoot.appendingPathComponent("Sources/AgentVoiceApp/\(fileName)")
        return try String(contentsOf: sourceFile, encoding: .utf8)
    }
}
```

- [ ] **Step 5: Run tests and confirm they fail for missing implementation**

Run:

```bash
swift test --package-path macos/AgentVoiceApp
```

Expected: FAIL, and failures should be limited to the new tests added in this task:

- `AgentVoiceAppSourceTests/testAttentionWindowIDAndSceneAreRegistered`
- `DashboardViewSourceTests/testDashboardAttentionSurfacesOpenAttentionWindow`
- `AgentVoiceAppSourceTests/testMenuAttentionBannerOpensAttentionWindowAndActivatesApp`
- `AttentionDetailViewSourceTests/testAttentionDetailViewIncludesRequiredSectionsAndDataSources`
- `AttentionDetailViewSourceTests/testAttentionDetailViewUsesOnePrimaryScrollRegion`

If any pre-existing test fails, stop and report it before implementing. Do not bury unrelated failures under the expected red phase.

- [ ] **Step 6: Commit failing tests**

```bash
git add macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift \
  macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/DashboardViewSourceTests.swift \
  macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AttentionDetailViewSourceTests.swift
git commit -m "test: cover attention detail window entry points"
```

---

### Task 2: Register the Attention window and create the detail view shell

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift`
- Create: `macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift`

- [ ] **Step 1: Add the attention window id and scene**

In `AgentVoiceApp.swift`, update `AgentVoiceWindowID`:

```swift
enum AgentVoiceWindowID {
    static let dashboard = "dashboard"
    static let setup = "setup"
    static let attention = "attention"
}
```

Add the singleton window after Dashboard:

```swift
Window("Attention", id: AgentVoiceWindowID.attention) {
    AttentionDetailView(model: model)
}
.defaultSize(width: 760, height: 620)
```

- [ ] **Step 2: Create a compiling `AttentionDetailView` shell**

Create `AttentionDetailView.swift`:

```swift
import AgentVoiceCore
import SwiftUI

struct AttentionDetailView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Attention details")
                    .font(.largeTitle.bold())
                    .accessibilityAddTraits(.isHeader)

                attentionMessagesSection
                doctorIssuesSection
                failedJobsSection
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
        }
        .frame(minWidth: 620, minHeight: 480)
        .onAppear { model.startAutoRefresh() }
        .onDisappear { model.stopAutoRefresh() }
    }
}
```

- [ ] **Step 3: Add temporary section stubs so the file compiles**

Add private computed sections below `body` in the same file:

```swift
private extension AttentionDetailView {
    var attentionMessagesSection: some View {
        Text("Attention messages")
    }

    var doctorIssuesSection: some View {
        Text("Doctor checks needing review")
    }

    var failedJobsSection: some View {
        Text("Failed jobs and recent errors")
    }
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AgentVoiceAppSourceTests/testAttentionWindowIDAndSceneAreRegistered
```

Expected: PASS for window registration. Other attention tests may still fail until detail data sources and entry-point wiring are implemented.

- [ ] **Step 5: Commit window registration shell**

```bash
git add macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift \
  macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift
git commit -m "feat: register attention detail window"
```

---

### Task 3: Implement AttentionDetailView content

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift`

- [ ] **Step 1: Add local helpers and derived data**

Replace the stub private extension with focused sections and helpers:

```swift
private extension AttentionDetailView {
    var attentionMessages: [String] {
        model.status?.ui.attention ?? []
    }

    var doctorIssues: [DoctorCheck] {
        model.doctorReport?.checks.filter {
            !$0.ok || $0.severity == .warning || $0.severity == .error
        } ?? []
    }

    var failedJobs: [AgentVoiceHistoryJob] {
        model.history?.jobs.filter { $0.status == .failed } ?? []
    }
}
```

- [ ] **Step 2: Implement section card helper**

Add:

```swift
func detailCard<Content: View>(
    _ title: String,
    systemImage: String,
    tint: Color,
    @ViewBuilder content: () -> Content
) -> some View {
    VStack(alignment: .leading, spacing: 12) {
        Label(title, systemImage: systemImage)
            .font(.title3.bold())
            .foregroundStyle(tint)
            .accessibilityAddTraits(.isHeader)
        content()
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(16)
    .background(.regularMaterial)
    .overlay {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
            .stroke(tint.opacity(0.26), lineWidth: 1)
    }
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
}
```

- [ ] **Step 3: Implement Attention messages section**

```swift
@ViewBuilder
var attentionMessagesSection: some View {
    detailCard("Attention messages", systemImage: "bell.badge.fill", tint: .orange) {
        if model.status == nil {
            emptyState("Status unavailable. Refresh the dashboard and try again.")
        } else if attentionMessages.isEmpty {
            emptyState("No active attention messages.")
        } else {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(attentionMessages, id: \.self) { message in
                    Label(message, systemImage: "exclamationmark.circle.fill")
                        .foregroundStyle(.orange)
                        .textSelection(.enabled)
                }
            }
        }
    }
}
```

- [ ] **Step 4: Implement Doctor checks needing review section**

```swift
@ViewBuilder
var doctorIssuesSection: some View {
    detailCard("Doctor checks needing review", systemImage: "stethoscope", tint: doctorIssues.isEmpty ? .green : .orange) {
        if model.doctorReport == nil {
            emptyState("Diagnostics unavailable. Run doctor or refresh the dashboard.")
        } else if doctorIssues.isEmpty {
            emptyState("No doctor checks currently need review.")
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(doctorIssues) { check in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Image(systemName: check.ok ? "info.circle" : "exclamationmark.triangle.fill")
                            Text(check.message)
                                .textSelection(.enabled)
                        }
                        .foregroundStyle(severityTint(check.severity))
                        Text("Severity: \(check.severity.rawValue)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                        if let action = check.action, !action.isEmpty {
                            Text(action)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}
```

- [ ] **Step 5: Implement Failed jobs and recent errors section**

```swift
@ViewBuilder
var failedJobsSection: some View {
    detailCard("Failed jobs and recent errors", systemImage: "xmark.octagon", tint: failedJobs.isEmpty ? .green : .red) {
        if model.history == nil {
            emptyState("History unavailable. Refresh the dashboard and try again.")
        } else if failedJobs.isEmpty {
            emptyState("No failed jobs in recent history.")
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(failedJobs) { job in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(job.agent.capitalized) failed")
                            .font(.headline)
                        Text(job.lastError ?? "No error exposed by current CLI yet")
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                        Text("Attempts: \(job.attempts) · \(job.finishedAt ?? job.createdAt)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let cwd = job.cwd, !cwd.isEmpty {
                            Text(cwd)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}
```

- [ ] **Step 6: Add shared empty-state and severity helpers**

```swift
func emptyState(_ message: String) -> some View {
    Text(message)
        .foregroundStyle(.secondary)
        .textSelection(.enabled)
}

func severityTint(_ severity: DoctorCheck.Severity) -> Color {
    switch severity {
    case .info:
        .blue
    case .warning:
        .orange
    case .error:
        .red
    }
}
```

- [ ] **Step 7: Run detail view tests**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AttentionDetailViewSourceTests
```

Expected: PASS.

- [ ] **Step 8: Build to catch SwiftUI type errors**

Run:

```bash
swift build --package-path macos/AgentVoiceApp
```

Expected: PASS.

- [ ] **Step 9: Commit detail content**

```bash
git add macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift
git commit -m "feat: show attention detail content"
```

---

### Task 4: Wire dashboard attention surfaces to the Attention window

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/DashboardView.swift`

- [ ] **Step 1: Import AppKit for activation**

At the top of `DashboardView.swift`, add `AppKit`:

```swift
import AgentVoiceCore
import AppKit
import SwiftUI
```

- [ ] **Step 2: Add openWindow environment**

Inside `struct DashboardView: View`:

```swift
@ObservedObject var model: AppModel
@Environment(\.openWindow) private var openWindow
```

- [ ] **Step 3: Add dashboard helper**

Inside `private extension DashboardView`:

```swift
func openAttentionDetails() {
    openWindow(id: AgentVoiceWindowID.attention)
    NSApplication.shared.activate(ignoringOtherApps: true)
}
```

- [ ] **Step 4: Make status attention messages clickable**

In `healthCard`, replace the attention messages block body with a button-style card or row. Minimal approach:

```swift
Button {
    openAttentionDetails()
} label: {
    VStack(alignment: .leading, spacing: 6) {
        ForEach(attention, id: \.self) { item in
            Label(item, systemImage: "bell.badge.fill")
                .foregroundStyle(.orange)
        }
        Text("Open details")
            .font(.caption.weight(.medium))
            .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
}
.buttonStyle(.plain)
.accessibilityLabel("Open attention details")
.accessibilityValue("\(attention.count) attention \(attention.count == 1 ? "message" : "messages")")
```

Keep the existing `if let attention = ... !attention.isEmpty` condition.

- [ ] **Step 5: Make doctor review summary clickable**

In `healthCard`, replace the `Label("... need review", systemImage: "stethoscope")` with:

```swift
Button {
    openAttentionDetails()
} label: {
    Label("\(doctorIssues.count) diagnostic \(noun) need review", systemImage: "stethoscope")
        .foregroundStyle(.orange)
        .frame(maxWidth: .infinity, alignment: .leading)
}
.buttonStyle(.plain)
.accessibilityLabel("Open diagnostic review details")
.accessibilityValue("\(doctorIssues.count) diagnostic \(noun) need review")
```

- [ ] **Step 6: Make diagnostics card issue list clickable**

Inside the `else` branch where `doctorIssues` are shown in `diagnosticsCard`, wrap the issue list in a plain button:

```swift
Button {
    openAttentionDetails()
} label: {
    VStack(alignment: .leading, spacing: 10) {
        ForEach(doctorIssues.prefix(5)) { check in
            // keep existing check display
        }
        Text("Open all details")
            .font(.caption.weight(.medium))
            .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
}
.buttonStyle(.plain)
.accessibilityLabel("Open diagnostic details")
.accessibilityValue("\(doctorIssues.count) diagnostic \(doctorIssues.count == 1 ? "check" : "checks") need review")
```

- [ ] **Step 7: Run dashboard source test**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter DashboardViewSourceTests/testDashboardAttentionSurfacesOpenAttentionWindow
```

Expected: PASS.

- [ ] **Step 8: Run build**

Run:

```bash
swift build --package-path macos/AgentVoiceApp
```

Expected: PASS.

- [ ] **Step 9: Commit dashboard wiring**

```bash
git add macos/AgentVoiceApp/Sources/AgentVoiceApp/DashboardView.swift
git commit -m "feat: open attention details from dashboard"
```

---

### Task 5: Wire menu-bar attention banner to the Attention window

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/MenuBarSentinelView.swift`

- [ ] **Step 1: Add `openAttentionDetails()` helper**

Place near `openDashboard()`:

```swift
private func openAttentionDetails() {
    openWindow(id: AgentVoiceWindowID.attention)
    NSApplication.shared.activate(ignoringOtherApps: true)
}
```

- [ ] **Step 2: Wrap the attention banner in a button**

In `attentionBanner`, replace the plain card with:

```swift
Button {
    openAttentionDetails()
} label: {
    card(tint: .orange) {
        VStack(alignment: .leading, spacing: 6) {
            Label("Needs attention", systemImage: "bell.badge.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.orange)
            Text(attention.joined(separator: "\n"))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(3)
            Text("Open details")
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
        }
    }
}
.buttonStyle(.plain)
.accessibilityLabel("Open attention details")
.accessibilityValue("\(attention.count) attention \(attention.count == 1 ? "message" : "messages")")
```

Keep the existing condition `if let attention = model.status?.ui.attention, !attention.isEmpty`.

- [ ] **Step 3: Run menu source test**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AgentVoiceAppSourceTests/testMenuAttentionBannerOpensAttentionWindowAndActivatesApp
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
swift build --package-path macos/AgentVoiceApp
```

Expected: PASS.

- [ ] **Step 5: Commit menu wiring**

```bash
git add macos/AgentVoiceApp/Sources/AgentVoiceApp/MenuBarSentinelView.swift
git commit -m "feat: open attention details from menu bar"
```

---

### Task 6: Final verification and cleanup

**Files:**
- Inspect all changed files.
- Optional modify: `README.md` only if manual testing shows user-facing instructions need updating.

- [ ] **Step 1: Run full Swift test suite**

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

- [ ] **Step 3: Run manual UI smoke validation in a macOS GUI session**

Seed a temporary Agent Voice home that produces both a menu-bar attention message and doctor checks needing review:

```bash
export AGENT_VOICE_HOME="$(mktemp -d)"
export AGENT_VOICE_EXECUTABLE="$PWD/bin/agent-voice"
./bin/agent-voice pause
./bin/agent-voice config set tts.kokoroScript /tmp/agent-voice-missing-kokoro.py
swift run --package-path macos/AgentVoiceApp AgentVoiceApp
```

Manual checks while the app is running:

1. Open the menu-bar popover.
   - Expected: `Needs attention` banner appears because `status.ui.attention` contains `system_paused`.
   - Click the banner.
   - Expected: the `Attention` window opens and the app activates.
2. Open the Dashboard.
   - Expected: System Health and Diagnostics show review/attention states; Kokoro script missing and paused/daemon checks are visible as appropriate.
   - Click the System Health attention area and the Diagnostics review area.
   - Expected: both focus/open the same singleton `Attention` window, not multiple duplicate windows.
3. Inspect the `Attention` window.
   - Expected: attention messages, doctor checks needing review, and failed-job empty/unavailable states render clearly.
   - Expected: doctor messages/action text can be selected and copied.
   - Expected: there is one primary scroll region.
4. Verify the standalone window refreshes after the menu-bar popover closes.
   - In a second terminal with the same `AGENT_VOICE_HOME`, run `./bin/agent-voice resume`.
   - Expected: within the shared auto-refresh interval, the `system_paused` attention message disappears or the state changes without needing to reopen the menu-bar popover.

If a GUI session is unavailable, record this step as **not run** and do not claim UI interaction was verified. The final response must list that residual risk explicitly.

- [ ] **Step 4: Run broader repo tests if Swift and manual validation pass**

Run:

```bash
bun test
bun run typecheck
```

Expected: PASS. If either command fails, capture exact output. Treat dependency/setup failures separately from product regressions, but do not call the implementation complete until Swift tests/build and the edited macOS app behavior are verified.

- [ ] **Step 5: Inspect diff**

Run:

```bash
git diff --stat HEAD~5..HEAD
git diff -- macos/AgentVoiceApp/Sources/AgentVoiceApp macos/AgentVoiceApp/Tests/AgentVoiceCoreTests
```

Expected: Diff only contains attention window tests and implementation. No CLI, database, queue, or daemon behavior changes.

- [ ] **Step 6: Run pi-lens diagnostics on edited files**

Use the `lens_diagnostics` tool, not a shell placeholder:

```text
lens_diagnostics({ "mode": "all", "severity": "all" })
```

Expected: No blocking errors in edited files. If the tool is unavailable, run `lsp_diagnostics` on the edited Swift files and report the substitution explicitly.

- [ ] **Step 7: Commit final cleanup if needed**

Only if Step 5 reveals small cleanup changes:

```bash
git add <changed-files>
git commit -m "chore: polish attention detail window"
```

- [ ] **Step 8: Report completion evidence**

Final response must include:

- Changed file list.
- Verification commands and pass/fail status, including manual UI smoke validation status.
- Diagnostics tool result.
- Any residual risks, especially if manual UI launch was not performed or broader repo tests fail due to unrelated pre-existing changes.
