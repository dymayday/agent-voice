# Attention Detail Window Design

## Goal

When Agent Voice reports `Needs Attention` or diagnostic checks that need review, users should be able to click the relevant dashboard or menu-bar attention surface and open a dedicated window with the information that needs attention.

## Entry points

- Dashboard System Health attention messages.
- Dashboard diagnostic “need review” summary/details.
- Menu-bar `Needs attention` banner.

Each entry point opens the same attention detail window so the behavior is consistent across the app.

## Window content

The attention detail window presents a focused, selectable diagnostic view with three sections:

1. **Attention messages** from `status.ui.attention`.
2. **Doctor checks needing review** from `doctorReport.checks` where the check failed or has warning/error severity.
   - Show severity, message, and action text when available.
3. **Failed jobs / recent errors** from history jobs with `status == failed`.
   - Show agent, attempts, timestamp, and `lastError` when available.

If a section has no items, it shows a short empty-state message instead of implying success for unavailable data.

## Architecture

- Add a new SwiftUI window id, `AgentVoiceWindowID.attention`.
- Add `AttentionDetailView` in the app target. It observes the existing shared `AppModel`; no new CLI commands or data model changes are needed.
- Reuse existing derived data rules from the dashboard where practical:
  - doctor issues: failed checks or warning/error checks.
  - failed jobs: history jobs with failed status.
- Open the window via `@Environment(\.openWindow)` from both `DashboardView` and `MenuBarSentinelView`.
- Activate the app after opening so the window comes forward.

## Interaction and accessibility

- Clickable attention surfaces use `Button` or clearly button-like plain controls.
- Text remains selectable for copying diagnostic output.
- Empty/unavailable states are explicit.
- The window uses a single scroll region to avoid nested scrolling traps.

## Error handling

The view relies on `AppModel`'s existing refresh pipeline. If status, doctor, or history data is unavailable, the corresponding section displays an unavailable state. The window does not mutate daemon or queue state.

## Testing

- Add source-level Swift tests verifying:
  - an attention window id exists.
  - `AttentionDetailView` exists and includes attention, doctor issue, and failed job sections.
  - dashboard and menu-bar attention surfaces call `openWindow(id: AgentVoiceWindowID.attention)`.
- Run `swift test --package-path macos/AgentVoiceApp`.
