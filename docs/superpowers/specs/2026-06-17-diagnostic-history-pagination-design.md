# Diagnostic History Pagination Design

## Context

The macOS diagnostics window now exposes rich recent-job detail, including full raw job text. That is useful for troubleshooting, but rendering and refreshing a fixed 50-job history payload can hurt app responsiveness. The problem gets worse when job text is large because the app fetches, decodes, stores, renders, and copies more data than the user usually needs.

The user wants true data pagination, not only UI slicing, and chose an append-style list: load the newest jobs first, then append older jobs below with a **Load more** action. The user also wants history refresh decoupled from the normal 2-second auto-refresh loop so the diagnostics flow and app performance do not degrade.

## User-approved direction

Use cursor-based history pagination with smart first-page refresh:

1. Diagnostics initially loads a small newest history page.
2. **Load more** fetches the next older page from the CLI and appends it below the current list.
3. The normal 2-second app refresh should not re-fetch all loaded history pages.
4. The app should refresh only the first history page when queue terminal counts change.
5. Appended older pages should be preserved where possible and merged without duplicate jobs.

## Goals

- Prevent the diagnostics window from rendering or refreshing large job lists by default.
- Avoid repeated 2-second fetches of raw job text when history has not changed.
- Keep the troubleshooting experience useful by showing a fresh newest page when completed/failed/skipped counts change.
- Allow users to inspect older jobs on demand with explicit append pagination.
- Preserve full raw job text for currently loaded diagnostic jobs and copied snapshots.
- Keep existing dashboard/menu/attention window behavior intact where possible.

## Non-goals

- Do not remove full raw job text from diagnostics; it remains intentionally visible for loaded jobs.
- Do not add external telemetry, network reporting, or background analytics.
- Do not redesign the whole dashboard or diagnostics window.
- Do not introduce virtualized SwiftUI lists unless pagination alone proves insufficient.
- Do not fetch per-job detail lazily in this slice; that can be a future optimization.

## Proposed UX

### Initial diagnostics view

When diagnostics opens, the app should load the newest small page of terminal jobs. A page size of 10 is enough for the default diagnostic view and keeps raw-text payloads bounded.

The **Queue and activity** section should make the loaded scope explicit, for example:

- `10 loaded · 1 failed · newer jobs refresh automatically when activity changes`
- Empty state if history is unavailable or no terminal jobs exist.
- Current job cards stay readable and include the same fields as today: status, agent, timestamps, attempts, cwd, summarizer, skip reason, summary, last error, and full raw text.

### Load more append pagination

Below the loaded job cards, show **Load more** when the CLI reports older jobs exist.

- Clicking **Load more** fetches the next older page using the cursor returned by the previous page.
- Newly fetched jobs append below the current list.
- Existing loaded jobs are de-duplicated by `id` so refreshes and pagination cannot show duplicate cards.
- Show a disabled/loading state while the page request is in flight.
- If there are no older jobs, replace the button with a small `No more history` state or hide the button with a clear loaded count.

### Manual history refresh

Add a **Refresh history** action near the list header.

- It refreshes the newest page immediately.
- It should preserve appended older jobs where possible and merge by ID.
- It gives users deterministic control without waiting for smart refresh.

### Smart first-page refresh

The existing auto-refresh loop can continue to refresh lightweight system state every 2 seconds, but it should not refetch every loaded history page.

Instead:

- `refresh()` fetches status as it does today.
- After status refresh, compare terminal queue counts: `done + failed + skipped`.
- If history has never loaded, fetch the first page.
- If the terminal count changed since the last history page refresh, fetch only the first page.
- Preserve already appended older pages where possible.
- Do not fetch older pages automatically.

This keeps the newest diagnostic activity fresh while preventing a periodic full-history/raw-text reload.

## CLI contract

Extend `agent-voice history --json` with cursor pagination while preserving existing limit behavior.

### Arguments

Current:

```bash
agent-voice history --json [--limit 50]
```

Add:

```bash
agent-voice history --json [--limit N] [--before CURSOR]
```

- `--limit` remains bounded and validated by the CLI.
- `--before` is an opaque cursor returned by a previous history response.
- Invalid cursors should fail with a clear usage error and non-zero exit code.

### Ordering

Use a stable newest-to-oldest ordering for terminal jobs:

1. `COALESCE(finished_at, created_at)` descending
2. `created_at` descending
3. `id` descending

The cursor should encode the last returned row's ordering keys, not an offset. This prevents duplicated or skipped rows when new jobs finish while the user is browsing older history.

### Response shape

Keep the existing top-level shape and add page metadata:

```json
{
  "version": 1,
  "jobs": [],
  "pageInfo": {
    "limit": 10,
    "hasMore": false,
    "nextCursor": null
  }
}
```

- `jobs` remains the array of loaded page jobs.
- `pageInfo.hasMore` indicates whether another older page exists.
- `pageInfo.nextCursor` is passed back as `--before` to fetch the next older page.
- For an absent database, return an empty page with `hasMore: false` and `nextCursor: null` without creating the database.

## macOS app model changes

### CLI wrapper

Update `AgentVoiceCLI.history` to accept an optional cursor:

```swift
history(limit: Int = 10, before cursor: String? = nil)
```

The method should append `--before <cursor>` only when a cursor is present.

### History model

Extend `AgentVoiceHistorySnapshot` with decoded page metadata:

- `pageInfo.limit`
- `pageInfo.hasMore`
- `pageInfo.nextCursor`

Make decoding tolerant enough for older CLI responses if practical, but the in-repo CLI should emit `pageInfo` after this change.

### AppModel state and operations

Add explicit history pagination state:

- default diagnostics page size: 10
- loaded combined `history` snapshot
- current older-page cursor / has-more state from the last loaded page
- loading flag for history page requests
- last observed terminal count from status

Add operations:

- Load or refresh newest history page.
- Load next older history page and append.
- Merge page jobs by ID while preserving newest-to-oldest order.

`refresh()` should become history-smart:

1. Fetch status, doctor, and config best-effort as today.
2. Fetch the first history page only when history is missing or terminal queue counts changed.
3. Record history failures in `lastError` without blanking unrelated diagnostics.

Mutating actions that call `refresh()` should benefit from the same smart-history behavior.

## Diagnostics view changes

Update `AttentionDetailView` queue/activity section:

- Keep one primary `ScrollView`.
- Show loaded history count and failed count for loaded jobs.
- Show a concise note that only loaded jobs are included in the raw snapshot.
- Add **Refresh history** and **Load more** controls.
- Disable pagination controls while a history page request is in flight.
- Preserve existing job-card details and full raw text for loaded jobs.

## Raw diagnostic snapshot

The copyable diagnostic snapshot should include the currently loaded history pages only.

- It should not trigger an implicit 50-job fetch.
- It should include page metadata so bug reports show whether more history existed.
- Full raw text remains included for every loaded job because the user explicitly chose that diagnostic depth.

## Error handling

- If the first history page fails, keep existing loaded history if present and show the error in the diagnostics error path.
- If **Load more** fails, keep existing loaded jobs and surface a clear error.
- Invalid cursor input is only expected from stale/buggy app state; the CLI should still return a clear usage error.
- If status refresh fails, skip smart terminal-count comparison for that cycle but keep other best-effort refresh behavior.
- If history is unavailable, the UI should state that history could not be loaded rather than implying there are no jobs.

## Testing and validation

Use test-driven development for implementation.

Add or update CLI tests to cover:

- `history --json --limit N` returns `pageInfo`.
- `history --json --limit N --before CURSOR` returns the next older page.
- Cursor pagination does not duplicate rows across pages.
- Missing database remains read-only and returns empty `pageInfo`.
- Invalid cursor returns a clear error.

Add or update Swift tests to cover:

- `AgentVoiceCLI.history(limit:before:)` builds the expected arguments.
- `AppModel.refresh()` uses the small default page size for initial history.
- `AppModel.refresh()` does not refetch history when terminal counts are unchanged.
- `AppModel.refresh()` refreshes the first page when terminal counts change.
- `loadMoreHistory()` appends older jobs and de-duplicates by ID.
- Diagnostic snapshot includes loaded jobs and page metadata.
- Diagnostics source tests include **Load more** and **Refresh history** controls and keep a single primary scroll region.

Run at minimum:

- `bun test`
- `bun run typecheck`
- `cd macos/AgentVoiceApp && swift test`
- LSP diagnostics on changed Swift files
- `git diff --check`

## Acceptance criteria

- Diagnostics initially loads and renders a small newest history page, not a fixed 50-job list.
- **Load more** fetches older history from the CLI and appends it below the current list.
- The app does not refetch all loaded history every 2 seconds.
- The first history page refreshes automatically when terminal queue counts change.
- Appended older pages are preserved where possible and duplicates are avoided.
- Raw diagnostic snapshots include only currently loaded jobs, full raw text for those jobs, and page metadata.
- Existing status, doctor, config, dashboard, and diagnostics flows continue to pass tests.
