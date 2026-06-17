# Diagnostic History Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add true cursor-based pagination for diagnostic recent jobs so the macOS diagnostics window loads a small newest page, appends older pages on demand, and avoids full history refreshes every 2 seconds.

**Architecture:** Extend the TypeScript CLI history command with opaque cursor pagination and `pageInfo`. Extend Swift history decoding and `AgentVoiceCLI.history(limit:before:)`. Update `AppModel` to smart-refresh only the newest page when terminal queue counts change, and update `AttentionDetailView` with Refresh History and Load More controls.

**Tech Stack:** Bun/TypeScript CLI, SQLite via `bun:sqlite`, Swift/SwiftUI macOS app, XCTest source/model tests.

---

## File structure and responsibilities

- `src/history.ts`: Owns history JSON query, ordering, cursor encode/decode, `pageInfo`, and read-only missing-DB behavior.
- `src/cli.ts`: Parses `history --json --limit N --before CURSOR`, validates bounded limit and cursor, returns clear usage errors.
- `tests/history-json.test.ts`: CLI behavior tests for `pageInfo`, next-page cursor behavior, cursor stability, invalid cursor, and read-only missing DB.
- `macos/AgentVoiceApp/Sources/AgentVoiceCore/HistoryModels.swift`: Decodes history `pageInfo` and supports constructing combined history snapshots.
- `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift`: Builds `history` CLI requests with optional cursor.
- `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift`: Owns smart history refresh, pagination state, append/de-dupe merge, and raw diagnostic snapshot page metadata.
- `macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift`: Displays loaded history count, manual refresh, load-more controls, and loaded-history snapshot note.
- `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/HistoryModelsTests.swift`: Swift CLI argument and model decoding tests.
- `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`: Smart refresh, load-more, de-dupe, snapshot page metadata tests.
- `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AttentionDetailViewSourceTests.swift`: Source-level UI guardrails.

---

### Task 1: Add CLI cursor pagination and page metadata

**Files:**
- Modify: `src/history.ts`
- Modify: `src/cli.ts`
- Test: `tests/history-json.test.ts`

- [ ] **Step 1: Write failing CLI tests for `pageInfo` and next-page cursor**

Add tests in `tests/history-json.test.ts` that seed three terminal jobs with distinct `finished_at` values, run:

```ts
const first = await runCli(["history", "--json", "--limit", "2"], { env: { AGENT_VOICE_HOME: home } });
const firstParsed = JSON.parse(first.stdout) as { pageInfo: { hasMore: boolean; nextCursor: string | null }; jobs: Array<{ id: string }> };
const second = await runCli(["history", "--json", "--limit", "2", "--before", firstParsed.pageInfo.nextCursor!], { env: { AGENT_VOICE_HOME: home } });
```

Expect first page to contain two newest jobs, `hasMore: true`, non-null `nextCursor`; second page contains the oldest job only, `hasMore: false`, `nextCursor: null`, and no duplicate IDs.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd .worktrees/diagnostic-history-pagination
bun test tests/history-json.test.ts
```

Expected: FAIL because `pageInfo` and `--before` are not implemented.

- [ ] **Step 3: Write failing test for cursor stability when a newer job appears between pages**

In `tests/history-json.test.ts`, seed three terminal jobs, fetch page 1 limit 2, then insert a newer terminal job, then fetch page 2 using the original cursor. Expect page 2 to contain the original oldest job, not duplicate page-1 rows or include the newer row.

- [ ] **Step 4: Run the focused test and verify it fails**

Run:

```bash
cd .worktrees/diagnostic-history-pagination
bun test tests/history-json.test.ts
```

Expected: FAIL because cursor pagination is missing.

- [ ] **Step 5: Write failing test for invalid cursor**

Add a test that runs:

```ts
const result = await runCli(["history", "--json", "--before", "not-a-valid-cursor"], { env: { AGENT_VOICE_HOME: home } });
expect(result.exitCode).toBe(2);
expect(result.stderr).toContain("--before must be a valid history cursor");
```

- [ ] **Step 6: Run the focused test and verify it fails**

Run:

```bash
cd .worktrees/diagnostic-history-pagination
bun test tests/history-json.test.ts
```

Expected: FAIL because invalid cursor is not parsed/rejected yet.

- [ ] **Step 7: Implement minimal CLI pagination**

In `src/history.ts`:

- Add `AppHistoryPageInfo` and `HistoryCursor` types.
- Add `encodeHistoryCursor(row)` using `Buffer.from(JSON.stringify({ sortAt, createdAt, id })).toString("base64url")`.
- Add `decodeHistoryCursor(raw)` that returns `HistoryCursor | null` after base64url JSON parse and string-shape validation.
- Change `AppHistorySnapshot` to include `pageInfo`.
- Change `buildHistorySnapshot(paths, limit = 50, before?: HistoryCursor)` to:
  - Return `{ version: 1, jobs: [], pageInfo: { limit: boundedLimit, hasMore: false, nextCursor: null } }` when DB is missing.
  - Query terminal jobs ordered by `COALESCE(finished_at, created_at) DESC, created_at DESC, id DESC`.
  - Apply cursor predicate for rows older than `before`.
  - Fetch `boundedLimit + 1` rows, drop the extra row, set `hasMore`, and set `nextCursor` from the last returned row only when `hasMore` is true.

In `src/cli.ts`:

- Parse `const before = getOption(args, "--before")` for the history command.
- Decode with `decodeHistoryCursor` when present.
- Return exit code 2 and `--before must be a valid history cursor\n` for invalid cursors.
- Pass decoded cursor to `buildHistorySnapshot(paths, limit, cursor)`.

- [ ] **Step 8: Run focused CLI tests and verify green**

Run:

```bash
cd .worktrees/diagnostic-history-pagination
bun test tests/history-json.test.ts
```

Expected: all history JSON tests pass.

- [ ] **Step 9: Run full Bun tests and typecheck**

Run:

```bash
cd .worktrees/diagnostic-history-pagination
bun test
bun run typecheck
```

Expected: all Bun tests pass and `tsc --noEmit` succeeds.

- [ ] **Step 10: Commit CLI pagination**

```bash
cd .worktrees/diagnostic-history-pagination
git add src/history.ts src/cli.ts tests/history-json.test.ts
git commit -m "feat: paginate history CLI"
```

---

### Task 2: Decode paginated history in Swift and build cursor-aware CLI requests

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/HistoryModels.swift`
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift`
- Test: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/HistoryModelsTests.swift`

- [ ] **Step 1: Write failing Swift tests for pageInfo decoding and cursor CLI args**

Update `HistoryModelsTests.swift`:

```swift
func testBuildsHistoryJsonCommandWithCursor() async throws {
    let runner = RecordingRunner(results: [ProcessResult(exitCode: 0, stdout: paginatedHistoryJSON, stderr: "")])
    let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

    _ = try await cli.history(limit: 10, before: "cursor-123")

    let requests = await runner.capturedRequests()
    XCTAssertEqual(requests.first?.arguments, ["history", "--json", "--limit", "10", "--before", "cursor-123"])
}
```

Add a decoding assertion that `snapshot.pageInfo.hasMore == true` and `snapshot.pageInfo.nextCursor == "cursor-123"`.

- [ ] **Step 2: Run focused Swift tests and verify failure**

Run:

```bash
cd .worktrees/diagnostic-history-pagination/macos/AgentVoiceApp
swift test --filter HistoryModelsTests
```

Expected: FAIL because `pageInfo` and `before` parameter are missing.

- [ ] **Step 3: Implement minimal Swift model/CLI support**

In `HistoryModels.swift`:

- Add `AgentVoiceHistoryPageInfo: Codable, Equatable, Sendable` with `limit`, `hasMore`, `nextCursor`.
- Add `pageInfo` to `AgentVoiceHistorySnapshot`.
- Update initializer to accept `pageInfo`, defaulting to `AgentVoiceHistoryPageInfo(limit: jobs.count, hasMore: false, nextCursor: nil)` for source compatibility.

In `AgentVoiceCLI.swift`:

- Change `history(limit: Int = 50)` to `history(limit: Int = 50, before cursor: String? = nil)`.
- Build arguments `history --json --limit <limit>` and append `--before <cursor>` when non-nil.

- [ ] **Step 4: Run focused Swift tests and verify green**

Run:

```bash
cd .worktrees/diagnostic-history-pagination/macos/AgentVoiceApp
swift test --filter HistoryModelsTests
```

Expected: HistoryModels tests pass.

- [ ] **Step 5: Commit Swift history decoding**

```bash
cd .worktrees/diagnostic-history-pagination
git add macos/AgentVoiceApp/Sources/AgentVoiceCore/HistoryModels.swift macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/HistoryModelsTests.swift
git commit -m "feat: decode paginated history in app"
```

---

### Task 3: Add smart history refresh and append pagination to AppModel

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift`
- Test: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`

- [ ] **Step 1: Write failing test for small initial history page**

Update expectations in `testRefreshLoadsStatusHistoryDoctorAndConfig` and auto-refresh tests so the history request uses:

```swift
["history", "--json", "--limit", "10"]
```

instead of limit 50.

- [ ] **Step 2: Run focused AppModel test and verify failure**

Run:

```bash
cd .worktrees/diagnostic-history-pagination/macos/AgentVoiceApp
swift test --filter AppModelTests/testRefreshLoadsStatusHistoryDoctorAndConfig
```

Expected: FAIL because current refresh still requests limit 50.

- [ ] **Step 3: Write failing test that unchanged terminal counts skip history fetch**

Add a test that returns two refresh cycles with identical queue counts. Call `await model.refresh()` twice. Expect the second cycle requests status, doctor, config, but no `history` command.

- [ ] **Step 4: Run focused AppModel test and verify failure**

Run:

```bash
cd .worktrees/diagnostic-history-pagination/macos/AgentVoiceApp
swift test --filter AppModelTests/testRefreshSkipsHistoryWhenTerminalCountsAreUnchanged
```

Expected: FAIL because current refresh always requests history.

- [ ] **Step 5: Write failing test that terminal count changes refresh first page**

Add a test with first status queue counts `done: 1, failed: 0, skipped: 0`, then second status `done: 2, failed: 0, skipped: 0`. Call refresh twice. Expect both cycles request first history page.

- [ ] **Step 6: Run focused AppModel test and verify failure**

Run:

```bash
cd .worktrees/diagnostic-history-pagination/macos/AgentVoiceApp
swift test --filter AppModelTests/testRefreshReloadsFirstHistoryPageWhenTerminalCountsChange
```

Expected: FAIL until smart terminal-count tracking exists.

- [ ] **Step 7: Write failing test for loadMoreHistory append/de-dupe**

Add a test that starts with a first history page containing jobs A/B and `nextCursor: "cursor-1"`, then `loadMoreHistory()` returns B/C. Expect `model.history?.jobs.map(\.id)` to be `[A, B, C]`, not `[A, B, B, C]`, and a request with `--before cursor-1`.

- [ ] **Step 8: Run focused AppModel test and verify failure**

Run:

```bash
cd .worktrees/diagnostic-history-pagination/macos/AgentVoiceApp
swift test --filter AppModelTests/testLoadMoreHistoryAppendsAndDeduplicatesJobs
```

Expected: FAIL because `loadMoreHistory()` is missing.

- [ ] **Step 9: Implement minimal AppModel pagination**

In `AppModel.swift`:

- Add `public static let defaultHistoryPageSize = 10`.
- Add published/private state as needed: `isLoadingHistoryPage`, `historyLoadError`, and internal `loadedHistoryPageCount`, `lastHistoryTerminalCounts`.
- Add `private struct TerminalQueueCounts: Equatable` based on `done`, `failed`, `skipped`.
- Change `refresh()` so it fetches status first, computes terminal counts, and calls `refreshNewestHistoryPage(preserveLoadedPages: true)` only when history is nil or terminal counts changed.
- Keep doctor/config best-effort refresh behavior.
- Add `public func refreshHistory() async` to fetch the newest page and preserve loaded older pages.
- Add `public func loadMoreHistory() async` to fetch `cli.history(limit: Self.defaultHistoryPageSize, before: history?.pageInfo.nextCursor)` and append.
- Add merge helper that de-dupes by `id` while preserving incoming newest-to-oldest order.
- Keep errors in `lastError` or `historyLoadError` without clearing unrelated data.

- [ ] **Step 10: Run focused AppModel tests and verify green**

Run:

```bash
cd .worktrees/diagnostic-history-pagination/macos/AgentVoiceApp
swift test --filter AppModelTests
```

Expected: AppModel tests pass.

- [ ] **Step 11: Commit AppModel pagination**

```bash
cd .worktrees/diagnostic-history-pagination
git add macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift
git commit -m "feat: smart refresh diagnostic history"
```

---

### Task 4: Add diagnostics UI controls and snapshot page metadata

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift`
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift`
- Test: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AttentionDetailViewSourceTests.swift`
- Test: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`

- [ ] **Step 1: Write failing source test for Refresh History and Load More controls**

Update `AttentionDetailViewSourceTests.swift` to assert the source contains:

```swift
XCTAssertTrue(source.contains("Refresh history"))
XCTAssertTrue(source.contains("Load more"))
XCTAssertTrue(source.contains("model.loadMoreHistory()"))
XCTAssertTrue(source.contains("model.refreshHistory()"))
XCTAssertTrue(source.contains("loaded jobs"))
```

- [ ] **Step 2: Run focused source test and verify failure**

Run:

```bash
cd .worktrees/diagnostic-history-pagination/macos/AgentVoiceApp
swift test --filter AttentionDetailViewSourceTests
```

Expected: FAIL because controls are not present.

- [ ] **Step 3: Write failing snapshot test for page metadata**

Update `testDiagnosticSnapshotJSONIncludesExpandedDebugContext` to assert raw snapshot contains `historyPageInfo` or equivalent page metadata with `hasMore` and `nextCursor` from loaded history.

- [ ] **Step 4: Run focused snapshot test and verify failure**

Run:

```bash
cd .worktrees/diagnostic-history-pagination/macos/AgentVoiceApp
swift test --filter AppModelTests/testDiagnosticSnapshotJSONIncludesExpandedDebugContext
```

Expected: FAIL until snapshot includes page metadata.

- [ ] **Step 5: Implement minimal UI controls and snapshot metadata**

In `AttentionDetailView.swift`:

- Update recent jobs header copy to show loaded count.
- Add `Refresh history` button using `Task { await model.refreshHistory() }`.
- Add `Load more` button below job cards when `model.history?.pageInfo.hasMore == true`.
- Disable buttons while `model.isLoadingHistoryPage` is true.
- Add note that raw snapshot includes loaded jobs only.
- Keep exactly one primary `ScrollView`.

In `AppModel.swift` diagnostic snapshot:

- Include history page metadata from the combined loaded `history` snapshot.

- [ ] **Step 6: Run focused UI/snapshot tests and verify green**

Run:

```bash
cd .worktrees/diagnostic-history-pagination/macos/AgentVoiceApp
swift test --filter AttentionDetailViewSourceTests
swift test --filter AppModelTests/testDiagnosticSnapshotJSONIncludesExpandedDebugContext
```

Expected: tests pass.

- [ ] **Step 7: Run all Swift tests and commit UI changes**

Run:

```bash
cd .worktrees/diagnostic-history-pagination/macos/AgentVoiceApp
swift test
```

Expected: all Swift tests pass.

Commit:

```bash
cd .worktrees/diagnostic-history-pagination
git add macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AttentionDetailViewSourceTests.swift macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift
git commit -m "feat: add diagnostic history pagination controls"
```

---

### Task 5: Final validation and review

**Files:**
- Review all changed files.

- [ ] **Step 1: Run full validation**

```bash
cd .worktrees/diagnostic-history-pagination
bun test
bun run typecheck
cd macos/AgentVoiceApp && swift test
cd ../..
git diff --check
```

Expected: all commands pass.

- [ ] **Step 2: Run LSP diagnostics on changed Swift files**

Run from repo root:

```bash
# via pi lsp_diagnostics tool, check:
macos/AgentVoiceApp/Sources/AgentVoiceCore/HistoryModels.swift
macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift
macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift
macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift
macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/HistoryModelsTests.swift
macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift
macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AttentionDetailViewSourceTests.swift
```

Expected: no diagnostics.

- [ ] **Step 3: Request code review**

Dispatch a reviewer with:

- Spec path: `docs/superpowers/specs/2026-06-17-diagnostic-history-pagination-design.md`
- Plan path: `docs/superpowers/plans/2026-06-17-diagnostic-history-pagination.md`
- Diff base: commit before Task 1 implementation
- Focus: cursor correctness, smart refresh behavior, raw text payload bounds, UI flow, tests.

- [ ] **Step 4: Fix review findings if any**

If review reports issues, fix with TDD where behavior changes are needed, rerun focused/full validation, and re-review.

- [ ] **Step 5: Integrate**

After review approval and validation, merge the feature branch back to `master`, rerun final validation on `master`, push if requested by the user/autopilot context, then remove the worktree.
