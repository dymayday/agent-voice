# Menu Smart Actions Design

## Goal

Add an interesting, context-aware Smart Actions drop-up menu to the bottom area of the Agent Voice menu-bar popover. The addition should make the compact menu feel more useful without replacing the existing Dashboard, Setup, and Quit footer actions.

## Approved direction

The menu should lean toward a context-aware assistant. It should surface the best next actions for the current Agent Voice state instead of showing a static grab bag of controls.

## Scope

- Add a new Smart Actions icon/menu near the bottom of `MenuBarSentinelView`.
- Keep existing footer actions:
  - Dashboard
  - Setup
  - Quit Agent Voice
- Use existing app model and CLI-backed capabilities where possible.
- Prefer safe utility actions that either mutate through existing tested `AppModel` methods or perform local UI-only actions such as copying diagnostics or revealing local paths.

## Menu behavior

The Smart Actions menu is always visible but its leading options change by state.

State precedence is deterministic when multiple conditions overlap:

1. Needs attention.
2. Daemon stopped.
3. Healthy, paused, or processing.

For example, if the daemon is stopped and failed jobs also exist, the menu uses the needs-attention leading actions first while still allowing recovery actions where useful.

### Needs attention

When `status.ui.attention` is non-empty, doctor checks need review, or failed jobs exist, prioritize repair-oriented actions:

- Open Attention Details.
- Refresh Diagnostics.
- Copy Diagnostic Snapshot.
- Reveal Agent Voice Home when a home path is available.

### Daemon stopped

When the daemon is not running, prioritize recovery actions:

- Start Daemon.
- Open Setup.
- Copy Diagnostic Snapshot.
- Reveal Agent Voice Home when a home path is available.

### Healthy, paused, or processing

When no urgent attention is surfaced, prioritize daily companion and convenience actions:

- Replay Last Summary when a done job has a non-empty summary.
- Run Voice Test.
- Pause or Resume depending on current UI state.
- Reveal Agent Voice Home when a home path is available.

## Action details

- **Open Attention Details** opens the existing singleton attention window and activates the app.
- **Refresh Diagnostics** calls the existing refresh pipeline so status, history, doctor, and config are refreshed together.
- **Copy Diagnostic Snapshot** copies compact local JSON to the macOS pasteboard. It should not require a new CLI command. The top-level object should include:
  - `statusState`: the high-level UI state when available.
  - `daemon`: daemon state, running flag, and PID when available.
  - `queues`: pending, processing, done, failed, and skipped counts when available.
  - `attention`: `status.ui.attention` messages when available.
  - `doctorIssues`: failed, warning, or error doctor checks with message, severity, and action when available.
  - `failedJobs`: recent failed jobs with agent, attempts, timestamp, and last error when available.
  - `paths`: Agent Voice home, config, and queue database paths when available.
- **Reveal Agent Voice Home** opens the local `status.paths.home` directory in Finder via `NSWorkspace` when available.
- **Replay Last Summary** speaks the latest done-job summary through the existing CLI voice-test path. If no replayable summary exists, the action is disabled or omitted.
- **Pause/Resume**, **Run Voice Test**, and **Start Daemon** use existing `AppModel` methods.

## Visual and interaction design

- The Smart Actions control should sit above or alongside the existing footer actions without crowding the popover.
- Use a distinctive but modest icon such as `sparkles`, `wand.and.stars`, or `ellipsis.circle`.
- The menu label should communicate state, for example `Smart Actions` with a short caption like `Best next steps for current state`.
- Destructive actions should not be added to this menu in this slice. Existing destructive controls stay where they already are.
- Disabled actions should explain unavailable state through the label where practical, such as `No Summary to Replay`.

## Error handling

- If status, history, or doctor data is unavailable, the menu should still render with safe actions such as Refresh Diagnostics, Open Setup, and Run Voice Test.
- Clipboard and Finder actions should be best-effort local UI actions. If they fail, set `model.lastError` or otherwise surface a concise error through the existing menu error banner.
- Missing paths should disable or omit reveal actions rather than crashing.

## Non-goals

- Do not replace the existing footer.
- Do not add a new daemon command solely for this menu.
- Do not implement a full debug-bundle exporter in this slice.
- Do not add destructive cleanup, queue deletion, or hook mutation under Smart Actions.
- Do not add telemetry, accounts, cloud sync, or remote diagnostics.

## Testing

Add source-level Swift tests covering:

- `MenuBarSentinelView` contains a Smart Actions menu/control in the footer area.
- Existing Dashboard, Setup, and Quit footer actions remain present.
- The Smart Actions menu exposes state-aware entries for attention, daemon stopped, and healthy/daily usage.
- Attention actions call the existing attention window opener.
- Daemon recovery actions call existing `AppModel.startDaemon()` and setup opener paths.
- Utility actions for diagnostic copy and home reveal are present and guarded by available data.

Run:

```bash
swift test --package-path macos/AgentVoiceApp
```
