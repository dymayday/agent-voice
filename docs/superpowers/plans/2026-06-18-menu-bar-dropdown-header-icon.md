# Menu-Bar Dropdown Header Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the awkward menu dropdown header icon with an approved status-colored halo ring containing a centered `waveform` SF Symbol.

**Architecture:** Keep the change local to `MenuBarSentinelView`. Add a small private `menuHeaderStatusIcon` view so the header remains readable and the visual treatment has one clear owner. Preserve the existing `statusTint` state mapping and right-side status badge.

**Tech Stack:** Swift 6, SwiftUI, SF Symbols, XCTest source-contract tests, Swift Package Manager.

---

## File Structure

- Modify `macos/AgentVoiceApp/Sources/AgentVoiceApp/MenuBarSentinelView.swift`
  - Replace the current header `ZStack` that combines a centered status dot with an offset waveform.
  - Add `private var menuHeaderStatusIcon: some View` in the existing `extension MenuBarSentinelView` (the current source extension is not declared `private`; the property remains private).
  - The helper owns the circular background, halo stroke, ring stroke, centered `Image(systemName: "waveform")`, and decorative accessibility hiding.
- Modify `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift`
  - Add one source-contract test that fails on the current offset/dot composition and passes only when the header uses the halo-ring helper.
- No new files.
- No custom assets.
- No changes to `StatusBarIconLabel`; the menu-bar glyph stays unchanged.

## Task 1: Add a failing source-contract test

**Files:**

- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift`
- Test: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift`

- [ ] **Step 1: Insert the failing test**

Add this test after `testMenuBarUsesNativeTemplateWaveformIcon()`:

```swift
    func testMenuHeaderUsesStatusHaloWaveformIcon() throws {
        let source = try appSource("MenuBarSentinelView.swift")
        let header = try propertyBody(named: "header", in: source)
        let icon = try propertyBody(named: "menuHeaderStatusIcon", in: source)

        XCTAssertTrue(header.contains("menuHeaderStatusIcon"))
        XCTAssertTrue(icon.contains("Image(systemName: \"waveform\")"))
        XCTAssertTrue(icon.contains(".foregroundStyle(statusTint)"))
        XCTAssertTrue(icon.contains(".stroke(statusTint.opacity(0.12), lineWidth: 6)"))
        XCTAssertTrue(icon.contains(".stroke(statusTint.opacity(0.78), lineWidth: 2)"))
        XCTAssertTrue(icon.contains(".frame(width: 40, height: 40)"))
        XCTAssertTrue(icon.contains(".accessibilityHidden(true)"))
        XCTAssertFalse(
            icon.contains(".offset("),
            "The dropdown header waveform should stay centered inside the halo helper."
        )
        XCTAssertFalse(
            icon.contains(".frame(width: 10, height: 10)"),
            "The halo helper should not reintroduce a separate status dot."
        )
        XCTAssertFalse(
            header.contains(".offset(y: 11)"),
            "The dropdown header waveform should be centered, not visually offset."
        )
        XCTAssertFalse(
            header.contains(".frame(width: 10, height: 10)"),
            "The dropdown header should not use a separate centered status dot."
        )
    }
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd macos/AgentVoiceApp
swift test --filter AgentVoiceAppSourceTests/testMenuHeaderUsesStatusHaloWaveformIcon
```

Expected: FAIL because `menuHeaderStatusIcon` does not exist yet, or because the old header still contains `.offset(y: 11)` and the 10×10 status dot.

## Task 2: Implement the halo-ring header icon

**Files:**

- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/MenuBarSentinelView.swift`
- Test: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift`

- [ ] **Step 1: Replace the old header icon composition**

In `private var header`, replace the current leading `ZStack`:

```swift
            ZStack {
                Circle()
                    .fill(statusTint.opacity(0.16))
                    .frame(width: 36, height: 36)
                Circle()
                    .fill(statusTint)
                    .frame(width: 10, height: 10)
                Image(systemName: "waveform")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(statusTint)
                    .offset(y: 11)
            }
```

with:

```swift
            menuHeaderStatusIcon
```

- [ ] **Step 2: Add the reusable private icon view**

Add this computed view inside the existing `extension MenuBarSentinelView` (the source extension is not declared `private`; the property itself is `private`), near the other small view helpers, for example before `private func sectionTitle(_:)`:

```swift
    private var menuHeaderStatusIcon: some View {
        ZStack {
            Circle()
                .fill(statusTint.opacity(0.10))
            Circle()
                .stroke(statusTint.opacity(0.12), lineWidth: 6)
            Circle()
                .stroke(statusTint.opacity(0.78), lineWidth: 2)
            Image(systemName: "waveform")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(statusTint)
        }
        .frame(width: 40, height: 40)
        .accessibilityHidden(true)
    }
```

Notes:

- Keep `statusTint` as the single source of truth for ready/processing/paused/attention/stopped colors.
- Do not add a status dot.
- Do not offset the waveform.
- Do not change the right-side status badge.

- [ ] **Step 3: Run the focused test and verify it passes**

Run:

```bash
cd macos/AgentVoiceApp
swift test --filter AgentVoiceAppSourceTests/testMenuHeaderUsesStatusHaloWaveformIcon
```

Expected: PASS.

- [ ] **Step 4: Run related app source tests**

Run:

```bash
cd macos/AgentVoiceApp
swift test --filter AgentVoiceAppSourceTests
```

Expected: PASS.

- [ ] **Step 5: Run the full macOS package test suite**

Run:

```bash
cd macos/AgentVoiceApp
swift test
```

Expected: PASS.

- [ ] **Step 6: Inspect the source for old composition remnants**

Run:

```bash
rg -n "offset\(y: 11\)|frame\(width: 10, height: 10\)|menuHeaderStatusIcon|Image\(systemName: \"waveform\"\)" macos/AgentVoiceApp/Sources/AgentVoiceApp/MenuBarSentinelView.swift
```

Expected:

- `menuHeaderStatusIcon` appears.
- `Image(systemName: "waveform")` appears inside the helper.
- No `.offset(y: 11)` remains.
- No `.frame(width: 10, height: 10)` remains in the header icon.

- [ ] **Step 7: Optional visual smoke check**

If local macOS GUI access is available, run:

```bash
bash scripts/build-macos-app.sh
open "dist/Agent Voice.app"
```

Expected: opening the menu-bar dropdown shows a centered waveform inside a status-colored halo ring. The right-side status badge remains present.

If GUI access is not available, record that this visual smoke check was not run and rely on source tests plus build/test results.

- [ ] **Step 8: Commit the implementation**

Run:

```bash
git add macos/AgentVoiceApp/Sources/AgentVoiceApp/MenuBarSentinelView.swift \
  macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift
git commit -m "fix: refresh dropdown header status icon"
```
