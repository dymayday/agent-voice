# Diagnostics Recent Jobs Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Diagnostics window recent jobs list to the bottom and make each recent-job card a fixed 300-point independently scrollable card.

**Architecture:** Split `AttentionDetailView`'s current combined queue/activity section into a queue summary section and a bottom recent jobs section. Keep the outer page `ScrollView`, and add one intentional internal `ScrollView` inside `jobCard` so individual long job cards scroll without growing the whole page.

**Tech Stack:** SwiftUI, Swift Package Manager, XCTest source-level tests.

---

## File Structure

- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift`
  - Responsibility: Diagnostics window layout, detail cards, recent-job card rendering.
  - Changes: body section order, split queue/recent jobs sections, fixed-height scrollable job cards.
- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AttentionDetailViewSourceTests.swift`
  - Responsibility: Source-level regression tests for Diagnostics UI structure.
  - Changes: assert split sections, bottom order, updated scroll-region allowance, and fixed-height job cards.

No new files are needed.

## Task 1: Add Failing Diagnostics Layout Tests

**Files:**

- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AttentionDetailViewSourceTests.swift`

- [ ] **Step 1: Update required-section assertions**

In `testAttentionDetailViewIncludesRequiredSectionsAndDataSources`, replace the old combined section expectation:

```swift
XCTAssertTrue(source.contains("Queue and activity"))
```

with split-section expectations:

```swift
XCTAssertTrue(source.contains("Queue summary"))
XCTAssertTrue(source.contains("Recent jobs"))
```

- [ ] **Step 2: Replace the one-scroll-region source test**

Replace `testAttentionDetailViewUsesOnePrimaryScrollRegion` with:

```swift
func testAttentionDetailViewUsesPageScrollPlusJobCardScroll() throws {
    let source = try appSource("AttentionDetailView.swift")
    let jobCard = try functionBody(named: "jobCard", in: source)

    XCTAssertTrue(source.contains("ScrollView"))
    XCTAssertEqual(
        source.components(separatedBy: "ScrollView").count - 1,
        2,
        "Diagnostics should keep one page ScrollView and one intentional job-card ScrollView in source."
    )
    XCTAssertTrue(jobCard.contains("ScrollView"))
}
```

- [ ] **Step 3: Add section-order and split-responsibility test**

Add this test after the scroll-region test:

```swift
func testRecentJobsSectionIsBottomSectionSeparateFromQueueSummary() throws {
    let source = try appSource("AttentionDetailView.swift")
    let body = try attentionBody(in: source)
    let queueSummary = try propertyBody(named: "queueSummarySection", in: source)
    let recentJobs = try propertyBody(named: "recentJobsSection", in: source)

    let order = try offsets(
        in: body,
        markers: [
            "healthSummarySection",
            "runtimeSection",
            "queueSummarySection",
            "configurationSection",
            "doctorChecksSection",
            "rawSnapshotSection",
            "recentJobsSection"
        ]
    )

    XCTAssertLessThan(order["healthSummarySection"]!, order["runtimeSection"]!)
    XCTAssertLessThan(order["runtimeSection"]!, order["queueSummarySection"]!)
    XCTAssertLessThan(order["queueSummarySection"]!, order["configurationSection"]!)
    XCTAssertLessThan(order["configurationSection"]!, order["doctorChecksSection"]!)
    XCTAssertLessThan(order["doctorChecksSection"]!, order["rawSnapshotSection"]!)
    XCTAssertLessThan(order["rawSnapshotSection"]!, order["recentJobsSection"]!)

    XCTAssertTrue(queueSummary.contains("Pending"))
    XCTAssertTrue(queueSummary.contains("Processing"))
    XCTAssertTrue(queueSummary.contains("Done"))
    XCTAssertTrue(queueSummary.contains("Failed"))
    XCTAssertTrue(queueSummary.contains("Skipped"))
    XCTAssertFalse(queueSummary.contains("Refresh history"))
    XCTAssertFalse(queueSummary.contains("ForEach(recentJobs)"))

    XCTAssertTrue(recentJobs.contains("Refresh history"))
    XCTAssertTrue(recentJobs.contains("ForEach(recentJobs)"))
    XCTAssertTrue(recentJobs.contains("model.loadMoreHistory()"))
}
```

- [ ] **Step 4: Add fixed-height job-card test**

Add this test after the section-order test:

```swift
func testRecentJobCardsHaveFixedBalancedHeightAndIndependentScroll() throws {
    let source = try appSource("AttentionDetailView.swift")
    let jobCard = try functionBody(named: "jobCard", in: source)

    XCTAssertTrue(jobCard.contains("ScrollView"))
    XCTAssertTrue(jobCard.contains(".frame(height: 300)"))
    XCTAssertTrue(jobCard.contains("diagnosticTextBlock(job.summary"))
    XCTAssertTrue(jobCard.contains("diagnosticTextBlock(job.lastError"))
    XCTAssertTrue(jobCard.contains("diagnosticTextBlock(job.text.isEmpty"))
}
```

- [ ] **Step 5: Add source parsing helpers**

Add these helper methods below `appSource(_:)`:

```swift
private func attentionBody(in source: String) throws -> String {
    guard
        let start = source.range(of: "    var body: some View"),
        let end = source.range(of: "private extension AttentionDetailView", range: start.upperBound..<source.endIndex)
    else {
        XCTFail("Could not isolate AttentionDetailView body")
        throw XCTSkip("Cannot verify diagnostics section order without AttentionDetailView body.")
    }
    return String(source[start.lowerBound..<end.lowerBound])
}

private func propertyBody(named propertyName: String, in source: String) throws -> String {
    let marker = "var \(propertyName): some View"
    guard let start = source.range(of: marker) else {
        XCTFail("Could not find property: \(propertyName)")
        throw XCTSkip("Cannot verify missing property.")
    }
    let remaining = source[start.upperBound..<source.endIndex]
    let nextProperty = remaining.range(of: "\n    var ")?.lowerBound ?? source.endIndex
    let nextFunction = remaining.range(of: "\n    func ")?.lowerBound ?? source.endIndex
    let end = min(nextProperty, nextFunction)
    return String(source[start.lowerBound..<end])
}

private func functionBody(named functionName: String, in source: String) throws -> String {
    let marker = "func \(functionName)"
    guard let start = source.range(of: marker) else {
        XCTFail("Could not find function: \(functionName)")
        throw XCTSkip("Cannot verify missing function.")
    }
    let remaining = source[start.upperBound..<source.endIndex]
    let nextFunction = remaining.range(of: "\n    func ")?.lowerBound ?? source.endIndex
    let nextProperty = remaining.range(of: "\n    var ")?.lowerBound ?? source.endIndex
    let end = min(nextFunction, nextProperty)
    return String(source[start.lowerBound..<end])
}

private func offset(of marker: String, in source: String) throws -> String.Index {
    guard let range = source.range(of: marker) else {
        XCTFail("Missing marker: \(marker)")
        throw XCTSkip("Cannot verify source order without \(marker).")
    }
    return range.lowerBound
}

private func offsets(in source: String, markers: [String]) throws -> [String: String.Index] {
    var offsets: [String: String.Index] = [:]

    for marker in markers {
        offsets[marker] = try offset(of: marker, in: source)
    }

    return offsets
}
```

- [ ] **Step 6: Run focused tests to verify failure**

Run:

```bash
cd macos/AgentVoiceApp && swift test --filter AttentionDetailViewSourceTests
```

Expected: FAIL because `queueSummarySection`, `recentJobsSection`, `.frame(height: 300)`, and the extra `jobCard` `ScrollView` are not implemented yet.

- [ ] **Step 7: Commit failing tests**

```bash
git add macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AttentionDetailViewSourceTests.swift
git commit -m "test: specify diagnostics recent jobs layout"
```

## Task 2: Split Diagnostics Queue and Recent Jobs Sections

**Files:**

- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift`

- [ ] **Step 1: Update Diagnostics body order**

Change the body section list from:

```swift
healthSummarySection
runtimeSection
queueActivitySection
configurationSection
doctorChecksSection
rawSnapshotSection
```

to:

```swift
healthSummarySection
runtimeSection
queueSummarySection
configurationSection
doctorChecksSection
rawSnapshotSection
recentJobsSection
```

- [ ] **Step 2: Replace `queueActivitySection` with `queueSummarySection`**

Rename `var queueActivitySection: some View` to `var queueSummarySection: some View` and reduce it to queue counts only:

```swift
@ViewBuilder
var queueSummarySection: some View {
    detailCard("Queue summary", systemImage: "tray.full", tint: queueActivityTint) {
        VStack(alignment: .leading, spacing: 12) {
            if let queues = model.status?.queues {
                labeledRow("Pending", String(queues.pending), valueTint: queues.pending > 0 ? .orange : .primary)
                labeledRow("Processing", String(queues.processing), valueTint: queues.processing > 0 ? .blue : .primary)
                labeledRow("Done", String(queues.done), valueTint: .green)
                labeledRow("Failed", String(queues.failed), valueTint: queues.failed > 0 ? .red : .primary)
                labeledRow("Skipped", String(queues.skipped), valueTint: queues.skipped > 0 ? .secondary : .primary)
            } else {
                emptyState("Queue counts unavailable. Refresh diagnostics to load queue state.")
            }
        }
    }
}
```

Do not remove `queueActivityTint`; it can still provide the queue summary tint.

- [ ] **Step 3: Add `recentJobsSection` below `rawSnapshotSection`**

Create this property after `rawSnapshotSection`:

```swift
@ViewBuilder
var recentJobsSection: some View {
    detailCard("Recent jobs", systemImage: "clock.arrow.circlepath", tint: failedJobs.isEmpty ? .blue : .red) {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text("Recent jobs")
                    .font(.headline)
                Spacer()
                Text("\(recentJobs.count) loaded jobs · \(failedJobs.count) failed")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Refresh history") {
                    Task { await model.refreshHistory() }
                }
                .disabled(model.isLoadingHistoryPage)
            }

            Text("Newest jobs refresh when terminal queue counts change. Raw snapshots include loaded jobs only.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)

            if model.history == nil {
                emptyState("History unavailable. Refresh diagnostics to load recent jobs.")
            } else if recentJobs.isEmpty {
                emptyState("No recent jobs in history.")
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(recentJobs) { job in
                        jobCard(job)
                    }

                    if model.history?.pageInfo.hasMore == true {
                        Button(model.isLoadingHistoryPage ? "Loading…" : "Load more") {
                            Task { await model.loadMoreHistory() }
                        }
                        .disabled(model.isLoadingHistoryPage)
                    } else {
                        Text("No more loaded history pages.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd macos/AgentVoiceApp && swift test --filter AttentionDetailViewSourceTests
```

Expected: still FAIL only on job-card height/scroll assertions, because section splitting is implemented but `jobCard` is not fixed-height scrollable yet.

- [ ] **Step 5: Commit section split**

```bash
git add macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift
git commit -m "feat: move diagnostics recent jobs to bottom"
```

## Task 3: Make Recent Job Cards Fixed-Height and Independently Scrollable

**Files:**

- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift`

- [ ] **Step 1: Wrap `jobCard` contents in an internal `ScrollView`**

Replace the current `jobCard(_:)` function body with this structure:

```swift
func jobCard(_ job: AgentVoiceHistoryJob) -> some View {
    ScrollView {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(job.agent.capitalized)
                    .font(.headline)
                Spacer()
                Text(job.status.rawValue.capitalized)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(jobStatusTint(job.status))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(jobStatusTint(job.status).opacity(0.12))
                    .clipShape(Capsule())
                    .textSelection(.enabled)
            }

            labeledRow("Job ID", job.id)
            labeledRow("Created", job.createdAt)
            labeledRow("Finished", job.finishedAt ?? "Not finished")
            labeledRow("Attempts", String(job.attempts))
            labeledRow("Working directory", job.cwd ?? "None")
            labeledRow("Summarizer used", job.summarizerUsed ?? "None")
            labeledRow("Skip reason", job.skipReason ?? "None")

            VStack(alignment: .leading, spacing: 6) {
                Text("Summary")
                    .font(.subheadline.bold())
                diagnosticTextBlock(job.summary ?? "No summary recorded")
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Last error")
                    .font(.subheadline.bold())
                diagnosticTextBlock(job.lastError ?? "No error recorded")
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Full raw job text")
                    .font(.subheadline.bold())
                diagnosticTextBlock(job.text.isEmpty ? "No raw job text recorded" : job.text)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .frame(height: 300)
    .background(jobStatusTint(job.status).opacity(0.08))
    .overlay {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .stroke(jobStatusTint(job.status).opacity(0.24), lineWidth: 1)
    }
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
}
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
cd macos/AgentVoiceApp && swift test --filter AttentionDetailViewSourceTests
```

Expected: PASS.

- [ ] **Step 3: Run all Swift package tests**

Run:

```bash
cd macos/AgentVoiceApp && swift test
```

Expected: PASS.

- [ ] **Step 4: Run TypeScript checks**

Run from repo root:

```bash
bun test
bun run typecheck
```

Expected: PASS. These should not be affected by Swift UI changes, but they guard the mixed repository.

- [ ] **Step 5: Commit fixed-height card behavior**

```bash
git add macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift
git commit -m "feat: bound diagnostics job cards"
```

## Task 4: Final Verification and Review Prep

**Files:**

- Verify: repository working tree and diagnostics.

- [ ] **Step 1: Check working tree**

Run:

```bash
git status --short
```

Expected: no uncommitted changes from this feature plan except any pre-existing unrelated user changes. Do not stage or commit unrelated files.

- [ ] **Step 2: Run lens diagnostics for edited files**

Run this pi tool invocation:

```json
lens_diagnostics({ "mode": "all", "severity": "all" })
```

Expected: no blocking errors in edited files. Include the diagnostic result in the
final evidence summary.

- [ ] **Step 3: Summarize evidence**

Record:

- Files changed
- Tests run and results
- Any pre-existing unrelated dirty files
- Any residual risks, especially if Swift UI visual behavior was not manually
  inspected in the running app
