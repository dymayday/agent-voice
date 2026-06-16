# Diagnostics Window Debug Console Design

## Context

The macOS Agent Voice app currently has a Diagnostics/Attention details window, but it mostly surfaces attention flags, doctor checks, and failed-job snippets. That is not enough to debug why the daemon, queue, summarizer, TTS, or hook flow is behaving a certain way.

## User-approved direction

Build the diagnostics experience for both human troubleshooting and developer debugging:

1. Show a readable troubleshooting summary first.
2. Add richer grouped debug details below it.
3. Include full raw job input text in diagnostics and copyable snapshots when available.

## Goals

- Make the diagnostics window useful for understanding what is happening now.
- Make failures actionable by showing error context, job context, and relevant runtime configuration.
- Preserve the existing doctor/attention/failed-job signals while adding richer context.
- Keep the information grouped so normal users are not forced to read raw JSON first.
- Make it easy to copy a complete diagnostic snapshot for bug reports.

## Non-goals

- Do not redesign the entire dashboard.
- Do not change daemon, queue, summarizer, or TTS processing behavior.
- Do not add external telemetry or network reporting.
- Do not hide full job text; the user explicitly approved full raw input for maximum debugging value.

## Proposed UX

The diagnostics window should become a structured troubleshooting console with these sections:

### 1. Health summary

Show the current high-level system state at the top:

- UI state (`ready`, `processing`, `paused`, `needs_attention`, `daemon_stopped`)
- Daemon state and PID
- Queue pressure summary, especially pending/processing/failed counts
- Attention flags, if any
- Last app/CLI refresh error, if any

This section should answer: “Is the system healthy, stopped, stuck, paused, or failing?”

### 2. Runtime and paths

Show runtime information needed to debug environment problems:

- Daemon running state
- PID or stale PID state
- Agent Voice home path
- Config path
- Queue database path
- CLI executable path if available from app settings/model

Paths should use text selection so they can be copied.

### 3. Queue and activity

Show all queue counts and a recent activity timeline based on history:

- Pending, processing, done, failed, skipped counts
- Recent jobs ordered as provided by history
- Include the jobs returned by the existing app history request, currently up to 50 recent terminal jobs (`done`, `failed`, `skipped`)
- Job status, agent, timestamps, attempts
- CWD
- Summarizer used
- Skip reason
- Summary
- Last error
- Full raw job text, untruncated for each included job

This section should answer: “What work has recently happened, and where did it fail or get skipped?”

### 4. Configuration context

Show the current local configuration relevant to voice generation and hook behavior:

- Global enabled/paused state
- Agent enablement and mode for each configured agent
- Kokoro voice
- Kokoro script path
- TTS timeout or other exposed TTS fields, if available in current config model
- Summarizer thinking effort and other exposed summarizer fields, if available

This section should answer: “What settings was the app using when this happened?”

### 5. Doctor checks

Keep existing doctor checks, but make them more useful. The diagnostics window should show all doctor checks, not only warnings/errors, with checks needing review grouped or visually emphasized first:

- Check ID
- OK/failing state
- Severity
- Message
- Action text

The summary/attention areas may continue to count only checks needing review, but the detailed diagnostics section and raw snapshot should include all decoded doctor checks.

This section should answer: “Which setup checks are passing, which are failing or warning, and what should I do?”

### 6. Raw diagnostic snapshot

Provide a copy action for a complete JSON snapshot containing:

- Status state
- Daemon details
- Queue counts
- Attention flags
- Paths
- Config summary/details available to the app
- All doctor checks plus a derived `doctorIssues` subset for warnings/errors/failing checks
- Recent jobs from the existing app history fetch limit, including full untruncated raw `text`
- Failed jobs with full context
- Last app error if present

The raw JSON is intended for bug reports and developer debugging.

## Data model changes

Extend the app-side diagnostic snapshot builder in `AppModel` so it includes more than current issue lists:

- Current status snapshot fields already decoded from `status --json`
- Current full config decoded from `config`
- Recent history jobs, not only failed jobs; use the current app history fetch limit (`history(limit: 50)`) unless a future design changes that limit
- Full job text and all decoded job metadata for every included history job
- All doctor checks and the derived doctor-issues subset
- Last app error
- Executable path from settings/CLI if accessible without invasive changes

Prefer additive model fields and computed helpers over changing CLI JSON contracts unless the required data is not available in the app.

Refresh should become best-effort per data source: status, history, doctor, and config fetches should be attempted independently so one failing command does not prevent the diagnostics window from showing the other successfully fetched or previously cached data. `lastError` should still record refresh failures clearly.

## View changes

Update `AttentionDetailView` or replace its internals with a clearer diagnostics console layout. The existing window ID and navigation can remain unchanged so menu/dashboard links keep working.

Implementation should favor reusable small SwiftUI helpers:

- `diagnosticSummarySection`
- `runtimeSection`
- `queueActivitySection`
- `configurationSection`
- `doctorChecksSection`
- `rawSnapshotSection`
- small row/value components with text selection
- job detail rows/cards

Keep cards readable and avoid one giant unstructured view block where possible.

## Error handling

- If status refresh fails, show that explicitly and still show successfully fetched or previously cached history/config/doctor data.
- If history refresh fails, show a clear empty state or stale cached data indicator instead of hiding the activity section.
- If config refresh fails, show a clear empty state or stale cached data indicator instead of implying defaults.
- If doctor refresh fails, show a clear empty state or stale cached data indicator instead of dropping the doctor section.
- If fields are nil, display `Unknown`, `None`, or `Not exposed by current CLI yet` consistently.
- Keep copy-to-pasteboard failures surfaced in the app error/local error path where already established.

## Privacy and security

The user explicitly chose full raw input for diagnostics. Because this may include sensitive prompt/session content:

- The UI should make the raw snapshot/copy area clearly labeled.
- Full job text should be visible/selectable in the diagnostics window.
- No network transmission should be added.

## Testing and validation

Add or update Swift tests to cover:

- Diagnostic snapshot JSON includes stable existing keys and new useful keys.
- Snapshot includes up to the current app history limit of recent jobs with full untruncated `text`, status, timestamps, attempts, cwd, summary, skip reason, summarizer, and last error.
- Snapshot includes all doctor checks and the derived doctor-issues subset.
- Snapshot includes config/runtime information when available.
- Best-effort refresh preserves or shows independently available data when one CLI command fails.
- Diagnostics source/view tests verify the new sections are present.
- Existing dashboard/menu links to attention details still compile and source tests still pass.

Run at minimum:

- `bun test`
- Swift package tests for `macos/AgentVoiceApp` if available in the environment
- `bun run typecheck`

## Acceptance criteria

- The diagnostic window has a readable summary plus grouped runtime, config, queue/activity, doctor, and raw snapshot sections.
- Recent jobs use the existing app history fetch limit and include full untruncated raw text plus failure context for every included job.
- Doctor details include all checks, while summaries can still emphasize checks needing review.
- Refresh is best-effort across status, history, doctor, and config so partial command failure does not blank unrelated diagnostics.
- Copyable diagnostic JSON includes enough context to debug without manually querying SQLite for common issues.
- Existing dashboard/menu diagnostic actions continue to work.
- Tests cover the expanded snapshot, partial-refresh behavior, and visible diagnostic sections.
