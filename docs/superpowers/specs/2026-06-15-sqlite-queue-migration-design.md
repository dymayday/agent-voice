# SQLite Queue Migration — Design

**Date:** 2026-06-15
**Status:** Approved design, pre-implementation
**Topic:** Replace the file-spool queue with a SQLite-backed queue (full cutover)

---

## 1. Purpose

The daemon runs constantly and processes agent turn-end events into spoken TTS
summaries. Today the queue is a hardened, dependency-free **file spool**
(`src/spool.ts`): jobs are JSON files moved between `incoming/processing/done/
failed/skipped` directories with atomic hardlink publishes, lock dirs, and
fsync.

Two problems motivate this change:

1. **Unbounded growth + O(N) dedup.** Terminal-state job files are never pruned
   (`cleanupRetention` exists but is **not** wired into the daemon loop), and
   `dedupeSeenEvent` does a full **O(N) scan reading every file** on every job.
   As history accumulates, each turn does more disk I/O — steady-state cost
   degrades over time.
2. **No querying.** A directory of files can't answer "what did agent X say last
   week", count events, or expose timing/health metrics.

This migration moves to **SQLite as the single source of truth** for the queue,
which makes dedup O(1), retention a `DELETE`, and unlocks history + metrics —
while *fixing* (not reintroducing) the degradation problem.

SQLite is **zero new dependency**: `bun:sqlite` is built into the Bun runtime,
and the project currently has no runtime deps.

## 2. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Migration scope | **Full cutover** — SQLite is the sole source of truth; retire the file spool | Single source of truth; dedup/retention become trivial |
| Schema shape | **Approach 1** — one `jobs` table holding queue + history + metrics | Most maintainable at this throughput: fewer moving parts, single-table reads, trivially testable. Approach 2's separation adds maintenance surface for no real-world speed gain |
| Capabilities | Cheap dedup + retention; event history + querying; metrics/observability | All three requested |
| Existing data | **Start fresh** — ignore the old file spool; SQLite starts empty | Personal daemon; unprocessed in-flight loss is acceptable. No importer to build |

## 3. Throughput context (drives the design)

A few events per **minute**. Every DB op is tens of microseconds; the real cost
per job is the summarizer subprocess (~1–10 s) and Kokoro TTS (hundreds of ms).
The queue layer is 5–6 orders of magnitude below the real work. Correctness and
maintainability matter; raw DB throughput does not.

## 4. Architecture

### 4.1 Module decomposition

Each unit has one purpose and a clear interface.

| Module | Status | Responsibility |
|---|---|---|
| `src/db.ts` | **new** | Owns the SQLite connection. PRAGMAs (WAL, `busy_timeout`, `foreign_keys`, `auto_vacuum=INCREMENTAL`), schema creation, `schema_version` for future migrations. Persistence only — no business logic. |
| `src/store.ts` | **new** | The queue API over `db.ts`. Replaces `spool.ts` + the storage parts of `queue.ts`: `enqueue`, `claimNextDue`, `markDone/Failed/Skipped`, `scheduleRetry`, `recoverStale`, `pruneRetention`, `countByStatus`, plus query helpers for history/metrics. |
| `src/queue.ts` | **modified** | Keeps **pure logic** only: `shouldSkipJob`, cwd glob matching, `markAttempt`/`isDue`/`scheduleRetry` decisions (operate on data, not storage). Storage-touching functions (`claimNextDueJob`, `dedupeSeenEvent`, `recoverStaleProcessing`) move to `store.ts`. |
| `src/events.ts` | **unchanged** | Domain model + validation (`AgentVoiceEvent`, `createEvent`, `validateEvent`). Storage-agnostic. |
| `src/processor.ts` | **modified** | Rewired to call `store.ts` instead of spool functions. Records timing/summarizer-used for metrics. |
| `src/daemon.ts` | **modified** | Loop mostly unchanged. Status counts via `store.countByStatus`. Adds a periodic `store.pruneRetention()` + incremental vacuum/`PRAGMA optimize`. |
| `src/paths.ts` | **modified** | Add `db` path (e.g. `<home>/queue.db`). Remove spool dir paths. |
| `src/config.ts` | **modified** | Reuse `maxAttempts`, `retryBackoffSeconds`, `processingTimeoutSeconds`, `retentionDays`. Remove spool-dir config. Default `retentionDays` generously (history is wanted). |
| `src/spool.ts` | **deleted** | Replaced by `db.ts` + `store.ts`. Old on-disk spool ignored. |

### 4.2 Concurrency model (critical)

- **Enqueue** runs in short-lived **hook processes** (possibly concurrent).
- **Daemon** is a single long-lived process (PID lock unchanged).
- Multiple processes → one SQLite file. Handled by:
  - `PRAGMA journal_mode = WAL` — concurrent readers + one writer.
  - `PRAGMA busy_timeout = <ms>` — writers wait instead of failing with
    `SQLITE_BUSY`.
  - `PRAGMA synchronous = NORMAL` (safe with WAL) for sensible durability/speed.
- **Atomic claim** (lock-free), single statement:
  ```sql
  UPDATE jobs SET status='processing', attempts=attempts+1,
         last_attempt_at=:now, claimed_at=:now
  WHERE id = (
    SELECT id FROM jobs
    WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= :now)
    ORDER BY created_at LIMIT 1
  )
  RETURNING *;
  ```

## 5. Schema

```sql
CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,         -- event id; dedup is UNIQUE by construction
  version         INTEGER NOT NULL,
  agent           TEXT NOT NULL,
  event           TEXT NOT NULL,            -- 'turn_end'
  text            TEXT NOT NULL,            -- original response text
  cwd             TEXT,
  session_id      TEXT,
  status          TEXT NOT NULL,            -- pending|processing|done|failed|skipped
  attempts        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,            -- from the event
  enqueued_at     TEXT NOT NULL,
  last_attempt_at TEXT,
  next_attempt_at TEXT,                     -- retry/backoff + due check
  claimed_at      TEXT,                     -- metrics: latency start
  finished_at     TEXT,                     -- metrics: latency end + retention key
  summary         TEXT,                     -- history: the spoken summary
  summarizer_used TEXT,                     -- metrics: which backend produced it
  skip_reason     TEXT,
  last_error      TEXT,
  metadata        TEXT                      -- JSON blob
);

-- Hot path: partial index over in-flight rows only → seek cost independent of history size
CREATE INDEX idx_jobs_inflight ON jobs(status, next_attempt_at)
  WHERE status IN ('pending', 'processing');

-- History / metrics queries
CREATE INDEX idx_jobs_agent_created ON jobs(agent, created_at);

CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT);  -- holds schema_version
```

- **Dedup** → `INSERT … ON CONFLICT(id) DO NOTHING`; inspect `changes()`.
- **Retention** → `DELETE FROM jobs WHERE status IN ('done','failed','skipped')
  AND finished_at < :cutoff`, called periodically from the daemon loop.
- **History / metrics** → `SELECT`s over the same table (per agent, per cwd, time
  range; latency from `claimed_at`/`finished_at`; success/attempts from
  `status`/`attempts`/`summarizer_used`).

## 6. Performance: no steady-state degradation (explicit guarantee)

The single table accumulates terminal rows, but the **daemon hot path stays
flat** because:

1. **Partial index** `idx_jobs_inflight` only indexes pending/processing rows, so
   claim/poll seeks and per-write index maintenance cost track the *in-flight*
   set (≈ constant), not total history.
2. **Retention in the loop** caps total rows, bounding DB file size and
   history-query cost.
3. **`auto_vacuum=INCREMENTAL`** (+ periodic `PRAGMA optimize`/`ANALYZE`) reclaims
   pages freed by retention `DELETE`s and keeps planner stats fresh.

This replaces the old O(N) file scan with an O(log N) — effectively O(1) on the
hot path — index seek. **A test asserts non-degradation** (see §8).

Honest caveat: ad-hoc history/report queries that filter on an *unindexed* column
(e.g., full-text over `text`) are O(N) — but these are occasional, user-initiated,
off the daemon hot path, and bounded by retention.

## 7. Cutover

- On startup, `db.ts` creates `queue.db` + schema if absent (idempotent).
- Old file-spool directories are **ignored** (start fresh). Not read, not
  imported. Left on disk for the user to delete manually; optionally a one-time
  log note. No importer code.

## 8. Testing strategy

- **In-memory DBs** (`:memory:`) per test → fast, isolated, no fs fixtures.
- Rewrite `tests/queue.test.ts`, the spool tests, `enqueue-cli`, and daemon tests
  against the store API. Pure-logic tests in `queue.ts` largely survive.
- **Concurrency test:** two connections to one temp-file DB exercising
  enqueue-while-claim; assert no lost/duplicated jobs and WAL/`busy_timeout`
  behavior.
- **Non-degradation test:** seed e.g. 50k terminal rows, assert claim/poll time
  is comparable to an empty table (within a tolerance) — proves the partial index
  + retention guarantee, verified not assumed.
- **Retention test:** terminal rows past `retentionDays` are deleted; in-flight
  and recent rows are kept.

## 9. Out of scope (YAGNI)

- No importer for existing spool data (start-fresh decision).
- No separate history/metrics tables (Approach 2 rejected).
- No external DB, no ORM, no migration framework beyond a `schema_version` int.
- No new CLI reporting commands yet — schema enables them; build later on demand.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Cross-process write contention | WAL + `busy_timeout`; writes are tiny and rare at this throughput |
| Lost in-flight work on cutover | Accepted (start-fresh); user can drain queue before upgrading |
| DB file bloat after deletes | `auto_vacuum=INCREMENTAL` + periodic maintenance |
| `bun:sqlite` API specifics (e.g. `RETURNING`, partial index support) | Verify against installed Bun version during implementation; both are supported in current SQLite/Bun |
| Losing the spool's crash-safety hardening | SQLite WAL provides ACID guarantees that supersede the hand-rolled fsync/lock machinery |
```
