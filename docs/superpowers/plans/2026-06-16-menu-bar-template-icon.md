# Menu Bar Template Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the macOS menu-bar full-color app icon with a native monochrome waveform status glyph on a transparent background.

**Architecture:** Keep the existing `MenuBarExtra` label closure and `StatusBarIconLabel` view, but simplify `StatusBarIconLabel` so it renders only a SwiftUI SF Symbol. Update the existing source-level regression test to assert the approved template-style behavior and reject the previous bundled `AppIcon.icns` status item path.

**Tech Stack:** SwiftUI, AppKit-free menu-bar label, Swift Package Manager tests, XCTest source assertions.

---

## File Structure

- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift`
  - Remove the `AppKit` import if no other code in this file needs it.
  - Keep `StatusBarIconLabel` as the menu-bar label view.
  - Replace bundled `NSImage` loading and circular clipping with `Image(systemName: "waveform")` plus `accessibilityLabel("Agent Voice")`.
- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift`
  - Rewrite `testMenuBarUsesBundledOrbIconInsteadOfGenericSystemSymbol()` into a test for native template-style SF Symbol behavior.
  - Assert the status item does not load `AppIcon.icns`, does not use `Image(nsImage:)`, and does not clip a full-color image.

## Scope Notes

- Do not change the app icon asset or `AppIcon.icns` bundle resources; this only changes the menu-bar status item label.
- Do not redesign the menu content inside `MenuBarSentinelView`.
- Preserve the `MenuBarExtra { ... } label: { StatusBarIconLabel() }` structure.

### Task 1: Update test and implementation for template menu-bar icon

**Files:**
- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift`
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift`

- [ ] **Step 1: Write the failing source test**

In `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift`, replace `testMenuBarUsesBundledOrbIconInsteadOfGenericSystemSymbol()` with:

```swift
func testMenuBarUsesNativeTemplateWaveformIcon() throws {
    let applicationSource = try appSource("AgentVoiceApp.swift")
    let statusLabel = try sourceSlice(
        in: applicationSource,
        from: "struct StatusBarIconLabel",
        to: "extension DashboardView"
    )

    XCTAssertTrue(applicationSource.contains("MenuBarExtra {"))
    XCTAssertTrue(applicationSource.contains("StatusBarIconLabel()"))
    XCTAssertTrue(statusLabel.contains("Image(systemName: \"waveform\")"))
    XCTAssertTrue(statusLabel.contains(".accessibilityLabel(\"Agent Voice\")"))
    XCTAssertFalse(
        statusLabel.contains("forResource: \"AppIcon\", withExtension: \"icns\""),
        "The status item should not use the full-color app icon."
    )
    XCTAssertFalse(
        statusLabel.contains("Image(nsImage:"),
        "The status item should be a native template-style SF Symbol, not a full-color NSImage."
    )
    XCTAssertFalse(
        statusLabel.contains(".clipShape(Circle())"),
        "The menu-bar glyph should be transparent, not a clipped app-icon circle."
    )
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AgentVoiceAppSourceTests/testMenuBarUsesNativeTemplateWaveformIcon
```

Expected: FAIL because `StatusBarIconLabel` still contains bundled `AppIcon.icns`, `Image(nsImage:)`, and `.clipShape(Circle())`, and does not yet contain `Image(systemName: "waveform")` in the primary status label path.

- [ ] **Step 3: Implement the minimal SwiftUI status label change**

In `macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift`, remove `import AppKit` if it is only used by `StatusBarIconLabel`, then replace `StatusBarIconLabel` with:

```swift
struct StatusBarIconLabel: View {
    var body: some View {
        Image(systemName: "waveform")
            .accessibilityLabel("Agent Voice")
    }
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AgentVoiceAppSourceTests/testMenuBarUsesNativeTemplateWaveformIcon
```

Expected: PASS.

- [ ] **Step 5: Run the app source test suite**

Run:

```bash
swift test --package-path macos/AgentVoiceApp --filter AgentVoiceAppSourceTests
```

Expected: PASS.

- [ ] **Step 6: Run source diagnostics**

Run LSP/lens diagnostics on the changed Swift files if available, or run:

```bash
swift test --package-path macos/AgentVoiceApp
```

Expected: PASS, or report unrelated pre-existing failures separately.

- [ ] **Step 7: Review the targeted diff**

Run:

```bash
git diff -- macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift
```

Expected: Diff only updates the menu-bar status icon implementation and the matching source test.

- [ ] **Step 8: Commit only the relevant files if the workspace is safe**

Before committing, inspect:

```bash
git status --short
```

If unrelated dirty files remain, do not stage them. Commit only the two changed Swift files and the plan if committing is appropriate:

```bash
git add docs/superpowers/plans/2026-06-16-menu-bar-template-icon.md \
  macos/AgentVoiceApp/Sources/AgentVoiceApp/AgentVoiceApp.swift \
  macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceAppSourceTests.swift
git commit -m "fix: use native template menu bar icon"
```
