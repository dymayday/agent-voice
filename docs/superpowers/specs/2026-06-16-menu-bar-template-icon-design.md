# Menu Bar Template Icon Design

## Goal

Make the macOS menu-bar icon match the system status bar style: a monochrome template glyph on a transparent background instead of the full-color bundled app icon.

## Current problem

`StatusBarIconLabel` loads `AppIcon.icns`, resizes it to 18×18, and clips it to a circle. That works as an app identity mark, but it does not fit the menu bar where surrounding status items are simple white glyphs over a transparent background.

## Approved approach

Use a native SwiftUI SF Symbol for the menu-bar label:

- Replace the bundled `AppIcon.icns` loading path in `StatusBarIconLabel`.
- Render `Image(systemName: "waveform")` as the status item label.
- Keep the accessibility label as `Agent Voice`.
- Do not add a colored background, circular clipping, or custom full-color image.

## Alternatives considered

1. **Template SF Symbol waveform** — approved. Best native fit, automatically adapts to menu-bar contrast, and keeps a clear voice/audio cue.
2. **Custom template asset** — could preserve more brand identity, but requires asset design and is unnecessary for this fix.
3. **Minimal orb outline** — keeps an orb concept but is less clearly voice-related and may look generic.

## Testing

Update the existing source test for the menu-bar icon so it verifies:

- `StatusBarIconLabel()` is still used by `MenuBarExtra`.
- `Image(systemName: "waveform")` is used for the status item label.
- `StatusBarIconLabel` keeps `accessibilityLabel("Agent Voice")`.
- `StatusBarIconLabel` no longer loads `AppIcon.icns`.
- The status item no longer clips a full-color image to a circle.
