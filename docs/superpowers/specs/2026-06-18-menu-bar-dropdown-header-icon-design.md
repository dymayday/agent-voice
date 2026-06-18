# Menu-Bar Dropdown Header Icon Design

## Summary

Improve the icon at the top of the Agent Voice menu-bar dropdown. The current header icon looks visually awkward because it combines a centered status dot with an offset waveform. Replace it with a cleaner status-first halo ring that still preserves the voice identity.

## Approved Direction

Use a circular halo ring around the `waveform` SF Symbol.

- Icon symbol: `Image(systemName: "waveform")`
- Layout: centered waveform inside a circular icon container
- Status treatment: the ring, halo, and waveform tint follow the existing `statusTint`
- Remove: the existing centered status dot and vertically offset waveform
- Keep: the existing title, subtitle, and right-side status badge

## Visual Behavior

The header icon should communicate both product identity and status without stacking multiple small status indicators.

- Ready: green halo/ring/icon
- Processing: blue halo/ring/icon
- Paused: orange halo/ring/icon
- Needs attention: red halo/ring/icon
- Daemon stopped or unavailable: secondary/gray halo/ring/icon

The halo should be subtle, not glowing aggressively. The visual target is a calm macOS popover header icon: clear status, centered voice glyph, no accidental-looking offsets.

## Proposed Component Shape

In `MenuBarSentinelView.header`, replace the current `ZStack` icon composition with a reusable private view or local composition equivalent to:

- Outer container: approximately 40×40 points
- Shape: circle
- Background: `statusTint.opacity(0.08)` to `statusTint.opacity(0.12)`
- Outer halo: `statusTint.opacity(0.10)` to `statusTint.opacity(0.14)`, visually outside or behind the ring
- Ring stroke: `statusTint.opacity(0.70)` to `statusTint.opacity(0.85)`, about 2 points
- Center glyph: `Image(systemName: "waveform")`, semibold, centered, `statusTint`

Exact opacity can be adjusted during implementation for native appearance, but the centered ring + waveform structure is fixed.

## Non-Goals

- Do not redesign the whole dropdown menu.
- Do not change the menu-bar icon in the top system bar.
- Do not introduce custom image assets.
- Do not remove or redesign the right-side status badge.
- Do not add animation in this pass.

## Affected Area

Primary file:

- `macos/AgentVoiceApp/Sources/AgentVoiceApp/MenuBarSentinelView.swift`

Likely test file:

- `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/DockMenuSourceTests.swift` or another existing source-level SwiftUI test if it asserts header source details.

## Accessibility

The change should preserve the existing header semantics. The icon is decorative because the adjacent title/subtitle/status badge already convey the application and status. Do not add duplicate spoken content unless existing tests or conventions require it.

## Validation

After implementation:

1. Build or test the macOS package from `macos/AgentVoiceApp`.
2. Run the relevant Swift tests if available.
3. Verify the source no longer contains the old offset waveform composition.
4. Visually inspect the dropdown header if possible.

## Open Questions

None. User approved the C3 halo-ring direction with status-following color and the `waveform` symbol.
