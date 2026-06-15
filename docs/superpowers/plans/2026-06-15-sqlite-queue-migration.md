# SQLite Queue Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the file-spool queue with a SQLite-backed queue (single source of truth) that adds O(1) dedup, in-loop retention, event history, and metrics — without steady-state performance degradation.

**Architecture:** A new persistence module (`db.ts`) owns the `bun:sqlite` connection, PRAGMAs, and schema. A new `store.ts` exposes the queue API (enqueue/claim/recover/mark/prune/query) backed by one `jobs` table. `queue.ts` keeps only pure logic (skip rules, retry/backoff math, cwd matching). `processor.ts`, `daemon.ts`, and `cli.ts` are rewired from spool calls to store calls. `spool.ts` is deleted last so the build stays green until cutover.

**Tech Stack:** Bun 1.3.13, `bun:sqlite` (built in — zero new deps), TypeScript, `bun test`.

---

## Design reference

Spec: `docs/superpowers/specs/2026-06-15-sqlite-queue-migration-design.md`.

**Decision deviating from spec wording (justified):** The spec said "remove spool-dir config." The config object's `spool` section (`src/config.ts`) holds only tuning knobs (`processingTimeoutSeconds`, `retentionDays`, `maxAttempts`, `retryBackoffSeconds`, `maxEventBytes`) — no directory paths. Renaming `config.spool` would churn many tests for no benefit, so we **keep the `config.spool` key name**. Directory paths live in `paths.ts` and are removed there. This keeps the change minimal (the maintainability goal).

**Crash-safe resume simplification:** The summary column doubles as the "already spoken" marker. We persist `summary` (via `markSpoken`) immediately after `speak()` succeeds and before `markDone`. On recovery, a claimed job whose `summary` is already set is finished without re-speaking. This removes the old `metadata.spokenAt` dance.

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/db.ts` | create | Open connection, set PRAGMAs, create schema, track `schema_version`. |
| `src/store.ts` | create | Queue API over `db.ts`: `enqueue`, `claimNextDue`, `recoverStale`, `markSpoken`, `markDone`, `requeueForRetry`, `markFailed`, `markSkipped`, `countByStatus`, `pruneRetention`, `listHistory`, plus row mappers. |
| `src/queue.ts` | modify | Keep pure logic only (`shouldSkipJob`, `markAttempt`, `isDue`, `scheduleRetry`, cwd matching, types). Remove storage fns (`claimNextDueJob`, `dedupeSeenEvent`, `recoverStaleProcessing`) — they move to `store.ts`. |
| `src/processor.ts` | modify | Take a `Database` instead of `paths`; call `store.ts`; persist summary/summarizer for metrics. |
| `src/daemon.ts` | modify | Open the DB once for the loop; status counts via `countByStatus`; call `pruneRetention` + `PRAGMA incremental_vacuum`/`optimize` periodically. |
| `src/cli.ts` | modify | `enqueue` and `status` go through `store.ts`/`db.ts`. |
| `src/paths.ts` | modify | Add `db` path; remove `spool` block (in final task). |
| `src/config.ts` | modify | None required (keep `spool` knobs). Listed for awareness. |
| `src/spool.ts` | delete | Replaced by `db.ts` + `store.ts` (final task). |
| `tests/store.test.ts` | create | Store behavior incl. dedup, claim, recover, retention, concurrency, non-degradation. |
| `tests/db.test.ts` | create | Schema + PRAGMA + version. |
| `tests/queue.test.ts` | modify | Keep pure-logic tests only. |
| `tests/spool.test.ts` | delete | Spool removed. |
| `tests/daemon.test.ts`, `tests/daemon-cli.test.ts`, `tests/enqueue-cli.test.ts`, `tests/integration-daemon.test.ts` | modify | Use DB/store; rename `incoming`→`pending`. |

**Build-green strategy:** Tasks 1–6 are additive (new modules + tests) — full suite stays green. Tasks 7–11 are the cutover; the build may be red mid-sequence and returns green at Task 11's final `bun test`. Each cutover task still commits its own slice.

---

### Task 1: DB layer (`src/db.ts`)

**Files:**
- Create: `src/db.ts`
- Modify: `src/paths.ts` (add `db` path; keep `spool` block for now)
- Test: `tests/db.test.ts`

- [ ] **Step 1: Add the `db` path to `paths.ts`**

In `src/paths.ts`, add `db: string;` to the `AgentVoicePaths` interface (after `run: string;`) and add the field in `resolvePaths`'s returned object (after `run: join(home, "run"),`):

```ts
		run: join(home, "run"),
		db: join(home, "queue.db"),
```

- [ ] **Step 2: Write the failing test**

Create `tests/db.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { openDb, getSchemaVersion, SCHEMA_VERSION } from "../src/db";

describe("db layer", () => {
	test("opens an in-memory db with schema and version", () => {
		const db = openDb(":memory:");
		try {
			const cols = db
				.query("SELECT name FROM pragma_table_info('jobs')")
				.all() as { name: string }[];
			const names = cols.map((c) => c.name);
			expect(names).toContain("id");
			expect(names).toContain("status");
			expect(names).toContain("summary");
			expect(names).toContain("summarizer_used");
			expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
		} finally {
			db.close();
		}
	});

	test("partial in-flight index exists", () => {
		const db = openDb(":memory:");
		try {
			const idx = db
				.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_jobs_inflight'")
				.get();
			expect(idx).not.toBeNull();
		} finally {
			db.close();
		}
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/db.test.ts`
Expected: FAIL — `Cannot find module "../src/db"`.

- [ ] **Step 4: Implement `src/db.ts`**

```ts
import { Database } from "bun:sqlite";

export type AgentVoiceDb = Database;

export const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  version         INTEGER NOT NULL,
  agent           TEXT NOT NULL,
  event           TEXT NOT NULL,
  text            TEXT NOT NULL,
  cwd             TEXT,
  session_id      TEXT,
  status          TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  enqueued_at     TEXT NOT NULL,
  last_attempt_at TEXT,
  next_attempt_at TEXT,
  claimed_at      TEXT,
  finished_at     TEXT,
  summary         TEXT,
  summarizer_used TEXT,
  skip_reason     TEXT,
  last_error      TEXT,
  metadata        TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_inflight ON jobs(status, next_attempt_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_jobs_agent_created ON jobs(agent, created_at);
CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT);
`;

export function openDb(location: string): Database {
	const db = new Database(location, { create: true });
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA busy_timeout = 5000");
	db.exec("PRAGMA synchronous = NORMAL");
	db.exec("PRAGMA auto_vacuum = INCREMENTAL");
	db.exec(SCHEMA_SQL);
	db.query(
		"INSERT INTO schema_meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO NOTHING",
	).run(String(SCHEMA_VERSION));
	return db;
}

export function getSchemaVersion(db: Database): number {
	const row = db
		.query("SELECT value FROM schema_meta WHERE key = 'schema_version'")
		.get() as { value: string } | null;
	return row ? Number(row.value) : 0;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/db.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/db.ts src/paths.ts tests/db.test.ts
git commit -m "feat: add sqlite db layer with schema and pragmas"
```

---

### Task 2: Store — types, row mappers, and `enqueue` with dedup

**Files:**
- Create: `src/store.ts`
- Test: `tests/store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/store.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { createEvent } from "../src/events";
import { enqueue, countByStatus } from "../src/store";

describe("store: enqueue + dedup", () => {
	test("enqueue inserts a pending job", () => {
		const db = openDb(":memory:");
		try {
			const event = createEvent({ agent: "claude", text: "Hello." });
			const res = enqueue(db, event);
			expect(res.inserted).toBe(true);
			expect(countByStatus(db).pending).toBe(1);
		} finally {
			db.close();
		}
	});

	test("duplicate event id is a no-op", () => {
		const db = openDb(":memory:");
		try {
			const event = createEvent({ agent: "claude", text: "Once." });
			expect(enqueue(db, event).inserted).toBe(true);
			expect(enqueue(db, { ...event, text: "Different payload." }).inserted).toBe(false);
			expect(countByStatus(db).pending).toBe(1);
		} finally {
			db.close();
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/store.test.ts`
Expected: FAIL — `Cannot find module "../src/store"`.

- [ ] **Step 3: Implement `src/store.ts` (types, mappers, `enqueue`, `countByStatus`)**

```ts
import type { Database } from "bun:sqlite";
import type { AgentVoiceConfig } from "./config";
import type { AgentVoiceEvent } from "./events";
import { shouldSkipJob, type QueueJob, type SkipReason } from "./queue";

export type JobStatus = "pending" | "processing" | "done" | "failed" | "skipped";

export interface StoredJob extends QueueJob {
	status: JobStatus;
	summary?: string;
	summarizerUsed?: string;
}

interface JobRow {
	id: string;
	version: number;
	agent: string;
	event: string;
	text: string;
	cwd: string | null;
	session_id: string | null;
	status: string;
	attempts: number;
	created_at: string;
	enqueued_at: string;
	last_attempt_at: string | null;
	next_attempt_at: string | null;
	claimed_at: string | null;
	finished_at: string | null;
	summary: string | null;
	summarizer_used: string | null;
	skip_reason: string | null;
	last_error: string | null;
	metadata: string | null;
}

function parseMetadata(raw: string | null): Record<string, unknown> | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function rowToStoredJob(row: JobRow): StoredJob {
	return {
		id: row.id,
		version: 1,
		agent: row.agent as QueueJob["agent"],
		event: "turn_end",
		text: row.text,
		...(row.cwd ? { cwd: row.cwd } : {}),
		...(row.session_id ? { sessionId: row.session_id } : {}),
		createdAt: row.created_at,
		status: row.status as JobStatus,
		attempts: row.attempts,
		...(row.last_attempt_at ? { lastAttemptAt: row.last_attempt_at } : {}),
		...(row.next_attempt_at ? { nextAttemptAt: row.next_attempt_at } : {}),
		...(row.summary ? { summary: row.summary } : {}),
		...(row.summarizer_used ? { summarizerUsed: row.summarizer_used } : {}),
		...(parseMetadata(row.metadata) ? { metadata: parseMetadata(row.metadata) } : {}),
	};
}

export function enqueue(
	db: Database,
	event: AgentVoiceEvent,
	now = new Date(),
): { inserted: boolean } {
	const res = db
		.query(
			`INSERT INTO jobs
        (id, version, agent, event, text, cwd, session_id, status, attempts, created_at, enqueued_at, metadata)
       VALUES
        ($id, $version, $agent, $event, $text, $cwd, $session_id, 'pending', 0, $created_at, $enqueued_at, $metadata)
       ON CONFLICT(id) DO NOTHING`,
		)
		.run({
			$id: event.id,
			$version: event.version,
			$agent: event.agent,
			$event: event.event,
			$text: event.text,
			$cwd: event.cwd ?? null,
			$session_id: event.sessionId ?? null,
			$created_at: event.createdAt,
			$enqueued_at: now.toISOString(),
			$metadata: event.metadata ? JSON.stringify(event.metadata) : null,
		});
	return { inserted: res.changes > 0 };
}

const STATUSES: JobStatus[] = ["pending", "processing", "done", "failed", "skipped"];

export function countByStatus(db: Database): Record<JobStatus, number> {
	const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
	const rows = db
		.query("SELECT status, COUNT(*) AS c FROM jobs GROUP BY status")
		.all() as { status: string; c: number }[];
	for (const row of rows) {
		if ((STATUSES as string[]).includes(row.status)) {
			counts[row.status as JobStatus] = row.c;
		}
	}
	return counts;
}

// Internal helpers shared by later tasks.
export { rowToStoredJob };
export type { JobRow };
```

> NOTE: `shouldSkipJob`, `QueueJob`, and `SkipReason` are imported now so Task 3 can use them without changing the import line. They are unused until Task 3 — that is intentional and the build tolerates it (TS `noUnusedLocals` is not enabled in this project; confirm `bun test` passes).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store.ts tests/store.test.ts
git commit -m "feat: add store enqueue with sqlite dedup"
```

---

### Task 3: Store — `claimNextDue`, `recoverStale`

**Files:**
- Modify: `src/store.ts`
- Test: `tests/store.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `tests/store.test.ts`)

```ts
import { claimNextDue, recoverStale } from "../src/store";
import { defaultConfig } from "../src/config";

describe("store: claim + recover", () => {
	test("oldest due pending job is claimed first and moved to processing", () => {
		const db = openDb(":memory:");
		try {
			const older = createEvent({ agent: "codex", text: "First." });
			const newer = createEvent({ agent: "claude", text: "Second." });
			enqueue(db, { ...older, createdAt: "2026-06-12T00:00:01.000Z" });
			enqueue(db, { ...newer, createdAt: "2026-06-12T00:00:02.000Z" });

			const claimed = claimNextDue(db, defaultConfig, new Date("2026-06-12T00:01:00.000Z"));
			expect(claimed?.id).toBe(older.id);
			expect(claimed?.attempts).toBe(1);
			expect(countByStatus(db).processing).toBe(1);
			expect(countByStatus(db).pending).toBe(1);
		} finally {
			db.close();
		}
	});

	test("future next_attempt_at job is not claimed until due", () => {
		const db = openDb(":memory:");
		try {
			const event = createEvent({ agent: "pi", text: "Later." });
			enqueue(db, event);
			db.query("UPDATE jobs SET next_attempt_at = '2026-06-12T00:02:00.000Z' WHERE id = ?").run(event.id);
			expect(claimNextDue(db, defaultConfig, new Date("2026-06-12T00:01:00.000Z"))).toBeNull();
			expect(claimNextDue(db, defaultConfig, new Date("2026-06-12T00:02:00.000Z"))?.id).toBe(event.id);
		} finally {
			db.close();
		}
	});

	test("disabled system claims nothing and marks skipped", () => {
		const db = openDb(":memory:");
		try {
			enqueue(db, createEvent({ agent: "claude", text: "Queued." }));
			const claimed = claimNextDue(db, { ...defaultConfig, enabled: false }, new Date());
			expect(claimed).toBeNull();
			expect(countByStatus(db).skipped).toBe(1);
		} finally {
			db.close();
		}
	});

	test("stale processing jobs return to pending; fresh ones stay", () => {
		const db = openDb(":memory:");
		try {
			const stale = createEvent({ agent: "claude", text: "Stale." });
			const fresh = createEvent({ agent: "codex", text: "Fresh." });
			enqueue(db, stale);
			enqueue(db, fresh);
			db.query("UPDATE jobs SET status='processing', last_attempt_at=? WHERE id=?")
				.run("2026-06-12T00:00:00.000Z", stale.id);
			db.query("UPDATE jobs SET status='processing', last_attempt_at=? WHERE id=?")
				.run("2026-06-12T00:04:30.000Z", fresh.id);

			const recovered = recoverStale(db, defaultConfig, new Date("2026-06-12T00:05:00.000Z"));
			expect(recovered).toEqual([stale.id]);
			expect(countByStatus(db).processing).toBe(1);
			expect(countByStatus(db).pending).toBe(1);
		} finally {
			db.close();
		}
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/store.test.ts`
Expected: FAIL — `claimNextDue`/`recoverStale` are not exported.

- [ ] **Step 3: Implement `claimNextDue` and `recoverStale`** (append to `src/store.ts`)

```ts
function markSkippedInternal(db: Database, id: string, reason: SkipReason, now: Date): void {
	db.query(
		"UPDATE jobs SET status='skipped', skip_reason=$reason, finished_at=$now WHERE id=$id",
	).run({ $reason: reason, $now: now.toISOString(), $id: id });
}

export function claimNextDue(
	db: Database,
	config: AgentVoiceConfig,
	now = new Date(),
): StoredJob | null {
	const iso = now.toISOString();
	const select = db.query(
		`SELECT * FROM jobs
       WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= $now)
       ORDER BY created_at LIMIT 1`,
	);
	const claim = db.query(
		`UPDATE jobs SET status='processing', attempts=attempts+1, last_attempt_at=$now, claimed_at=$now
       WHERE id=$id AND status='pending' RETURNING *`,
	);

	while (true) {
		const candidate = select.get({ $now: iso }) as JobRow | null;
		if (!candidate) return null;
		const job = rowToStoredJob(candidate);
		const skip = shouldSkipJob(job, config);
		if (skip.skip) {
			markSkippedInternal(db, candidate.id, skip.reason, now);
			continue;
		}
		const claimed = claim.get({ $now: iso, $id: candidate.id }) as JobRow | null;
		if (!claimed) continue; // lost a race (single daemon: should not happen)
		return rowToStoredJob(claimed);
	}
}

export function recoverStale(
	db: Database,
	config: AgentVoiceConfig,
	now = new Date(),
): string[] {
	const timeoutMs = config.spool.processingTimeoutSeconds * 1000;
	const rows = db.query("SELECT * FROM jobs WHERE status='processing'").all() as JobRow[];
	const recovered: string[] = [];
	const reset = db.query(
		"UPDATE jobs SET status='pending', next_attempt_at=NULL WHERE id=? AND status='processing'",
	);
	for (const row of rows) {
		const ref = row.last_attempt_at ?? row.created_at;
		const refMs = Date.parse(ref);
		if (!Number.isNaN(refMs) && now.getTime() - refMs <= timeoutMs) continue;
		reset.run(row.id);
		recovered.push(row.id);
	}
	return recovered;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/store.test.ts`
Expected: PASS (all claim/recover tests).

- [ ] **Step 5: Commit**

```bash
git add src/store.ts tests/store.test.ts
git commit -m "feat: add store claim and stale recovery"
```

---

### Task 4: Store — terminal transitions (`markSpoken`, `markDone`, `requeueForRetry`, `markFailed`, `markSkipped`)

**Files:**
- Modify: `src/store.ts`
- Test: `tests/store.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `tests/store.test.ts`)

```ts
import { markSpoken, markDone, requeueForRetry, markFailed } from "../src/store";

describe("store: terminal transitions", () => {
	test("markSpoken then markDone records summary + finishes", () => {
		const db = openDb(":memory:");
		try {
			const event = createEvent({ agent: "claude", text: "Do it." });
			enqueue(db, event);
			claimNextDue(db, defaultConfig, new Date());
			markSpoken(db, event.id, "All done.", "codex-fast");
			markDone(db, event.id, new Date("2026-06-12T00:00:05.000Z"));

			const row = db.query("SELECT status, summary, summarizer_used, finished_at FROM jobs WHERE id=?")
				.get(event.id) as { status: string; summary: string; summarizer_used: string; finished_at: string };
			expect(row.status).toBe("done");
			expect(row.summary).toBe("All done.");
			expect(row.summarizer_used).toBe("codex-fast");
			expect(row.finished_at).toBe("2026-06-12T00:00:05.000Z");
		} finally {
			db.close();
		}
	});

	test("requeueForRetry returns the job to pending with backoff", () => {
		const db = openDb(":memory:");
		try {
			const event = createEvent({ agent: "pi", text: "Flaky." });
			enqueue(db, event);
			claimNextDue(db, defaultConfig, new Date());
			requeueForRetry(db, event.id, "2026-06-12T00:00:30.000Z", "temporary failure");
			const row = db.query("SELECT status, next_attempt_at, last_error FROM jobs WHERE id=?")
				.get(event.id) as { status: string; next_attempt_at: string; last_error: string };
			expect(row.status).toBe("pending");
			expect(row.next_attempt_at).toBe("2026-06-12T00:00:30.000Z");
			expect(row.last_error).toBe("temporary failure");
		} finally {
			db.close();
		}
	});

	test("markFailed finishes with error", () => {
		const db = openDb(":memory:");
		try {
			const event = createEvent({ agent: "codex", text: "Nope." });
			enqueue(db, event);
			claimNextDue(db, defaultConfig, new Date());
			markFailed(db, event.id, new Date("2026-06-12T00:00:09.000Z"), "still failing");
			const row = db.query("SELECT status, last_error, finished_at FROM jobs WHERE id=?")
				.get(event.id) as { status: string; last_error: string; finished_at: string };
			expect(row.status).toBe("failed");
			expect(row.last_error).toBe("still failing");
			expect(row.finished_at).toBe("2026-06-12T00:00:09.000Z");
		} finally {
			db.close();
		}
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/store.test.ts`
Expected: FAIL — these functions are not exported.

- [ ] **Step 3: Implement transitions** (append to `src/store.ts`)

```ts
export function markSpoken(
	db: Database,
	id: string,
	summary: string,
	summarizerUsed: string | null,
): void {
	db.query("UPDATE jobs SET summary=$summary, summarizer_used=$used WHERE id=$id").run({
		$summary: summary,
		$used: summarizerUsed,
		$id: id,
	});
}

export function markDone(db: Database, id: string, now = new Date()): void {
	db.query("UPDATE jobs SET status='done', finished_at=$now WHERE id=$id").run({
		$now: now.toISOString(),
		$id: id,
	});
}

export function requeueForRetry(
	db: Database,
	id: string,
	nextAttemptAt: string,
	lastError: string,
): void {
	db.query(
		"UPDATE jobs SET status='pending', next_attempt_at=$next, last_error=$err, claimed_at=NULL WHERE id=$id",
	).run({ $next: nextAttemptAt, $err: lastError, $id: id });
}

export function markFailed(
	db: Database,
	id: string,
	now: Date,
	lastError: string,
): void {
	db.query(
		"UPDATE jobs SET status='failed', last_error=$err, finished_at=$now WHERE id=$id",
	).run({ $err: lastError, $now: now.toISOString(), $id: id });
}

export function markSkipped(db: Database, id: string, reason: SkipReason, now = new Date()): void {
	markSkippedInternal(db, id, reason, now);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts tests/store.test.ts
git commit -m "feat: add store terminal transitions"
```

---

### Task 5: Store — retention, history queries, non-degradation & concurrency tests

**Files:**
- Modify: `src/store.ts`
- Test: `tests/store.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `tests/store.test.ts`)

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneRetention, listHistory } from "../src/store";

describe("store: retention + history", () => {
	test("pruneRetention deletes old terminal rows, keeps recent + in-flight", () => {
		const db = openDb(":memory:");
		try {
			const old = createEvent({ agent: "claude", text: "Old." });
			const recent = createEvent({ agent: "codex", text: "Recent." });
			const live = createEvent({ agent: "pi", text: "Live." });
			enqueue(db, old);
			enqueue(db, recent);
			enqueue(db, live);
			db.query("UPDATE jobs SET status='done', finished_at=? WHERE id=?").run("2026-06-01T00:00:00.000Z", old.id);
			db.query("UPDATE jobs SET status='done', finished_at=? WHERE id=?").run("2026-06-15T00:00:00.000Z", recent.id);

			const deleted = pruneRetention(db, 7, new Date("2026-06-15T12:00:00.000Z"));
			expect(deleted).toBe(1);
			expect(countByStatus(db).done).toBe(1);
			expect(countByStatus(db).pending).toBe(1);
		} finally {
			db.close();
		}
	});

	test("listHistory filters by agent", () => {
		const db = openDb(":memory:");
		try {
			const a = createEvent({ agent: "claude", text: "A." });
			const b = createEvent({ agent: "codex", text: "B." });
			enqueue(db, a);
			enqueue(db, b);
			db.query("UPDATE jobs SET status='done' WHERE id=?").run(a.id);
			db.query("UPDATE jobs SET status='done' WHERE id=?").run(b.id);
			const claudeHistory = listHistory(db, { agent: "claude" });
			expect(claudeHistory.map((j) => j.id)).toEqual([a.id]);
		} finally {
			db.close();
		}
	});

	test("non-degradation: claim time is flat with large history", () => {
		const db = openDb(":memory:");
		try {
			const insert = db.query(
				`INSERT INTO jobs (id, version, agent, event, text, status, attempts, created_at, enqueued_at, finished_at)
         VALUES (?, 1, 'claude', 'turn_end', 'x', 'done', 1, ?, ?, ?)`,
			);
			const txn = db.transaction(() => {
				for (let i = 0; i < 50_000; i++) {
					const ts = `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`;
					insert.run(`hist-${i}`, ts, ts, ts);
				}
			});
			txn();
			const live = createEvent({ agent: "claude", text: "Pick me." });
			enqueue(db, live);

			const start = performance.now();
			const claimed = claimNextDue(db, defaultConfig, new Date("2026-12-01T00:00:00.000Z"));
			const elapsedMs = performance.now() - start;

			expect(claimed?.id).toBe(live.id);
			// Partial index keeps the hot path off the 50k history rows.
			expect(elapsedMs).toBeLessThan(25);
		} finally {
			db.close();
		}
	});

	test("concurrent connections: enqueue while claim, no loss or dup", () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-store-conc-"));
		const dbPath = join(home, "queue.db");
		const writer = openDb(dbPath);
		const reader = openDb(dbPath);
		try {
			const e1 = createEvent({ agent: "claude", text: "One." });
			const e2 = createEvent({ agent: "codex", text: "Two." });
			enqueue(writer, { ...e1, createdAt: "2026-06-12T00:00:01.000Z" });
			const claimed = claimNextDue(reader, defaultConfig, new Date("2026-06-12T00:01:00.000Z"));
			enqueue(writer, { ...e2, createdAt: "2026-06-12T00:00:02.000Z" });
			expect(claimed?.id).toBe(e1.id);
			expect(countByStatus(reader).pending).toBe(1);
			expect(countByStatus(reader).processing).toBe(1);
		} finally {
			writer.close();
			reader.close();
			rmSync(home, { recursive: true, force: true });
		}
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/store.test.ts`
Expected: FAIL — `pruneRetention`/`listHistory` not exported.

- [ ] **Step 3: Implement retention + history** (append to `src/store.ts`)

```ts
export function pruneRetention(db: Database, retentionDays: number, now = new Date()): number {
	if (!Number.isFinite(retentionDays) || retentionDays < 0) {
		throw new Error(`Invalid retentionDays: ${retentionDays}`);
	}
	const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
	const res = db
		.query(
			`DELETE FROM jobs
         WHERE status IN ('done','failed','skipped')
           AND finished_at IS NOT NULL AND finished_at < $cutoff`,
		)
		.run({ $cutoff: cutoff });
	db.exec("PRAGMA incremental_vacuum");
	return res.changes;
}

export interface HistoryFilter {
	agent?: string;
	since?: string;
	limit?: number;
}

export function listHistory(db: Database, filter: HistoryFilter = {}): StoredJob[] {
	const clauses = ["status IN ('done','failed','skipped')"];
	const params: Record<string, string | number> = {};
	if (filter.agent) {
		clauses.push("agent = $agent");
		params.$agent = filter.agent;
	}
	if (filter.since) {
		clauses.push("created_at >= $since");
		params.$since = filter.since;
	}
	const limit = filter.limit ?? 200;
	const rows = db
		.query(
			`SELECT * FROM jobs WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ${limit}`,
		)
		.all(params) as JobRow[];
	return rows.map(rowToStoredJob);
}

export function runMaintenance(db: Database): void {
	db.exec("PRAGMA optimize");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/store.test.ts`
Expected: PASS (all store tests).

- [ ] **Step 5: Commit**

```bash
git add src/store.ts tests/store.test.ts
git commit -m "feat: add store retention, history, and guarantees tests"
```

---

### Task 6: Trim `queue.ts` to pure logic; split `queue.test.ts`

**Files:**
- Modify: `src/queue.ts`
- Modify: `tests/queue.test.ts`

> After this task, `processor.ts` still imports the removed functions and will not type-check until Task 7. That is expected (see build-green strategy). Do NOT run the full suite as a gate here — run only the targeted files noted below.

- [ ] **Step 1: Remove storage functions from `queue.ts`**

Delete these from `src/queue.ts`: the imports of `readFileSync`, `AgentVoicePaths`, and the `spool` import; and the functions `readJob`, `annotateJob`, `withMetadata`, `markSkipped`, `dedupeSeenEvent`, `claimNextDueJob`, `recoverStaleProcessing`. Keep: `QueueJob`, `SkipReason`, `ClaimedQueueJob`, `RetryDecision`, `splitPathSegments`, `matchesSegment`, `matchesSegments`, `matchesPattern`, `shouldSkipJob`, `markAttempt`, `isDue`, `scheduleRetry`.

The remaining top of the file should be exactly:

```ts
import type { AgentVoiceConfig } from "./config";
import type { AgentVoiceEvent } from "./events";

export type SkipReason =
	| "disabled_system"
	| "disabled_agent"
	| "ignored_cwd"
	| "duplicate_event";

export interface QueueJob extends AgentVoiceEvent {
	attempts?: number;
	lastAttemptAt?: string;
	nextAttemptAt?: string;
}

export type RetryDecision =
	| { state: "incoming"; job: QueueJob }
	| { state: "failed"; job: QueueJob };
```

(Delete `ClaimedQueueJob` if unused after Task 7 — it is no longer needed; remove it now.) Keep `withMetadata` **only** if `scheduleRetry` uses it — it does, so move a private copy into `queue.ts`:

```ts
function withMetadata(job: QueueJob, metadata: Record<string, unknown>): QueueJob {
	return { ...job, metadata: { ...(job.metadata ?? {}), ...metadata } };
}
```

Leave `shouldSkipJob`, `markAttempt`, `isDue`, `scheduleRetry`, and the `matches*`/`splitPathSegments` helpers byte-for-byte as they are.

- [ ] **Step 2: Split `tests/queue.test.ts` to pure-logic only**

In `tests/queue.test.ts`, remove the storage-coupled tests and imports. Delete the import block from `../src/spool` and the `claimNextDueJob`, `dedupeSeenEvent`, `recoverStaleProcessing` names from the `../src/queue` import. Delete these tests entirely (they are now covered by `tests/store.test.ts`):
- `"queue annotations use spool atomic replacement instead of direct truncate writes"`
- `"oldest due incoming job is selected first"`
- `"future nextAttemptAt incoming job is skipped until due"` — **keep only** the two `isDue(...)` assertions by moving them into a small standalone test (see below)
- `"stale processing jobs move back to incoming on startup"`
- `"duplicate event id is not processed twice"`
- the `enqueueEvent`/`claimNextDueJob` part of `"disabled system, disabled agent, and ignored cwd..."` — keep only the three `shouldSkipJob` assertions.

Replace the deleted `isDue` coverage with:

```ts
test("isDue respects nextAttemptAt", () => {
	const future = { ...createEvent({ agent: "claude", text: "Later." }), nextAttemptAt: "2026-06-12T00:02:00.000Z" } satisfies QueueJob;
	expect(isDue(future, new Date("2026-06-12T00:01:59.999Z"))).toBe(false);
	expect(isDue(future, new Date("2026-06-12T00:02:00.000Z"))).toBe(true);
});
```

The remaining `queue.test.ts` imports should be only:

```ts
import { describe, expect, test } from "bun:test";
import { defaultConfig, type AgentVoiceConfig } from "../src/config";
import { createEvent } from "../src/events";
import { isDue, markAttempt, scheduleRetry, shouldSkipJob, type QueueJob } from "../src/queue";
```

(Keep the `config()` helper; drop `withTempHome`, `readJob`, `resolvePaths`, `basename/join` if now unused.)

- [ ] **Step 3: Run targeted tests**

Run: `bun test tests/queue.test.ts`
Expected: PASS (pure-logic tests).

- [ ] **Step 4: Commit**

```bash
git add src/queue.ts tests/queue.test.ts
git commit -m "refactor: reduce queue.ts to pure logic"
```

---

### Task 7: Rewire `processor.ts` to the store

**Files:**
- Modify: `src/processor.ts`
- Test: rely on `tests/integration-daemon.test.ts` (updated in Task 10) + a focused processor test below

- [ ] **Step 1: Replace `src/processor.ts` entirely**

```ts
import type { Database } from "bun:sqlite";
import type { AgentVoiceConfig } from "./config";
import type { AgentVoiceEvent } from "./events";
import { scheduleRetry } from "./queue";
import {
	claimNextDue,
	markDone,
	markFailed,
	markSpoken,
	recoverStale,
	requeueForRetry,
	type StoredJob,
} from "./store";

export interface ProcessorDeps {
	summarize: (event: AgentVoiceEvent, config: AgentVoiceConfig) => Promise<string>;
	speak: (summary: string, voice: string, event: AgentVoiceEvent) => Promise<void>;
}

export type ProcessNextJobResult =
	| { kind: "idle"; recovered: string[] }
	| { kind: "processed"; id: string }
	| { kind: "retry_scheduled"; id: string }
	| { kind: "failed"; id: string };

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function summarizerName(config: AgentVoiceConfig): string {
	return config.summarizer.priority[0] ?? "heuristic";
}

export async function processNextJob(
	db: Database,
	config: AgentVoiceConfig,
	deps: ProcessorDeps,
	now = new Date(),
): Promise<ProcessNextJobResult> {
	const recovered = recoverStale(db, config, now);
	const claimed: StoredJob | null = claimNextDue(db, config, now);
	if (!claimed) return { kind: "idle", recovered };

	try {
		// Resume after a crash that happened post-speak: summary already persisted.
		if (claimed.summary) {
			markDone(db, claimed.id, now);
			return { kind: "processed", id: claimed.id };
		}

		const summary = await deps.summarize(claimed, config);
		await deps.speak(summary, config.tts.voice, claimed);
		markSpoken(db, claimed.id, summary, summarizerName(config));
		markDone(db, claimed.id, now);
		return { kind: "processed", id: claimed.id };
	} catch (error) {
		const lastError = errorMessage(error);
		const retry = scheduleRetry(claimed, config, now, lastError);
		if (retry.state === "incoming" && retry.job.nextAttemptAt) {
			requeueForRetry(db, claimed.id, retry.job.nextAttemptAt, lastError);
			return { kind: "retry_scheduled", id: claimed.id };
		}
		markFailed(db, claimed.id, now, lastError);
		return { kind: "failed", id: claimed.id };
	}
}
```

> NOTE: `requeueProcessingJob` (used by no production code path after cutover) is removed. If a later task reports a missing reference, it was test-only — update that test to drive state via `recoverStale`/store instead.

- [ ] **Step 2: Write a focused processor test**

Create `tests/processor.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { defaultConfig } from "../src/config";
import { createEvent } from "../src/events";
import { enqueue, countByStatus } from "../src/store";
import { processNextJob, type ProcessorDeps } from "../src/processor";

function deps(over: Partial<ProcessorDeps> = {}): ProcessorDeps {
	return {
		summarize: async () => "Spoken summary.",
		speak: async () => {},
		...over,
	};
}

describe("processNextJob", () => {
	test("happy path: summarize, speak, mark done", async () => {
		const db = openDb(":memory:");
		try {
			enqueue(db, createEvent({ agent: "claude", text: "Work." }));
			const result = await processNextJob(db, defaultConfig, deps(), new Date());
			expect(result.kind).toBe("processed");
			expect(countByStatus(db).done).toBe(1);
		} finally {
			db.close();
		}
	});

	test("speak failure schedules a retry", async () => {
		const db = openDb(":memory:");
		try {
			enqueue(db, createEvent({ agent: "pi", text: "Flaky." }));
			const result = await processNextJob(
				db,
				defaultConfig,
				deps({ speak: async () => { throw new Error("audio device busy"); } }),
				new Date(),
			);
			expect(result.kind).toBe("retry_scheduled");
			expect(countByStatus(db).pending).toBe(1);
		} finally {
			db.close();
		}
	});

	test("idle when queue empty", async () => {
		const db = openDb(":memory:");
		try {
			const result = await processNextJob(db, defaultConfig, deps(), new Date());
			expect(result.kind).toBe("idle");
		} finally {
			db.close();
		}
	});
});
```

- [ ] **Step 3: Run targeted tests**

Run: `bun test tests/processor.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/processor.ts tests/processor.test.ts
git commit -m "refactor: drive processor from sqlite store"
```

---

### Task 8: Rewire `daemon.ts` (DB lifecycle, status, retention in loop)

**Files:**
- Modify: `src/daemon.ts`
- Test: `tests/daemon.test.ts`, `tests/daemon-cli.test.ts` (updated)

- [ ] **Step 1: Update imports and `DaemonStatus` in `src/daemon.ts`**

Replace the spool import line:

```ts
import { listJobs, type SpoolState } from "./spool";
```

with:

```ts
import { openDb } from "./db";
import { countByStatus, pruneRetention, runMaintenance, type JobStatus } from "./store";
```

Delete the `STATES` constant and replace the `DaemonStatus` interface's `queues` type:

```ts
export interface DaemonStatus {
	running: boolean;
	pid: number | null;
	queues: Record<JobStatus, number>;
}
```

- [ ] **Step 2: Update `getDaemonStatus` and `formatDaemonStatus`**

```ts
export function getDaemonStatus(
	paths: AgentVoicePaths,
	deps: DaemonCliDeps = {},
): DaemonStatus {
	const pid = readDaemonLock(paths);
	const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive;
	const db = openDb(paths.db);
	try {
		return { pid, running: pid !== null && isPidAlive(pid), queues: countByStatus(db) };
	} finally {
		db.close();
	}
}

const STATUS_ORDER: JobStatus[] = ["pending", "processing", "done", "failed", "skipped"];

export function formatDaemonStatus(status: DaemonStatus): string {
	const state = status.running
		? `running pid=${status.pid}`
		: status.pid
			? `stale pid=${status.pid}`
			: "stopped";
	const queues = STATUS_ORDER.map((key) => `${key}=${status.queues[key]}`).join(" ");
	return `${state}\n${queues}\n`;
}
```

- [ ] **Step 3: Thread the DB into the loop + add retention**

Change `runDaemonOnce` to open/own a DB, and `runDaemonLoop` to open one DB for its lifetime and prune periodically. Replace both functions:

```ts
export async function runDaemonOnce(
	paths: AgentVoicePaths,
	config: AgentVoiceConfig,
	deps: DaemonCliDeps,
): Promise<ProcessNextJobResult> {
	const db = openDb(paths.db);
	try {
		return await processNextJob(db, config, requireProcessorDeps(deps), deps.now?.() ?? new Date());
	} finally {
		db.close();
	}
}

export async function runDaemonLoop(
	paths: AgentVoicePaths,
	config: AgentVoiceConfig,
	deps: DaemonCliDeps,
): Promise<DaemonLoopResult> {
	requireProcessorDeps(deps);
	const summary: DaemonLoopResult = {
		iterations: 0, processed: 0, idle: 0, retryScheduled: 0, failed: 0,
	};
	const maxIterations = deps.maxIterations ?? Number.POSITIVE_INFINITY;
	const pollIntervalMs = deps.pollIntervalMs ?? 1000;
	const pruneEvery = deps.pruneEveryIterations ?? 300;
	const db = openDb(paths.db);
	try {
		while (summary.iterations < maxIterations && !hasIntentionalStop(paths)) {
			const now = deps.now?.() ?? new Date();
			const result = await processNextJob(db, config, requireProcessorDeps(deps), now);
			summary.iterations += 1;
			if (result.kind === "processed") summary.processed += 1;
			if (result.kind === "idle") summary.idle += 1;
			if (result.kind === "retry_scheduled") summary.retryScheduled += 1;
			if (result.kind === "failed") summary.failed += 1;
			if (summary.iterations % pruneEvery === 0) {
				pruneRetention(db, config.spool.retentionDays, now);
				runMaintenance(db);
			}
			if (result.kind === "idle") await sleep(pollIntervalMs);
		}
	} finally {
		db.close();
	}
	return summary;
}
```

Add `pruneEveryIterations?: number;` to the `DaemonCliDeps` interface (near `maxIterations?`).

- [ ] **Step 4: Update `tests/daemon.test.ts` and `tests/daemon-cli.test.ts`**

For any test that constructs jobs with `writeJob`/`listJobs` from `../src/spool`, switch to `openDb(paths.db)` + `enqueue`. For assertions on status output, replace `incoming=` with `pending=`. For `processorDeps`, the deps shape is unchanged (`summarize`/`speak`), but tests that previously passed `paths` to `processNextJob` no longer apply — exercise via `runDaemonOnce`/`runDaemonLoop` which still take `paths`. Concretely, where a daemon test seeds the queue, use:

```ts
import { openDb } from "../src/db";
import { enqueue } from "../src/store";
// ...
const db = openDb(paths.db);
enqueue(db, createEvent({ agent: "claude", text: "Queued." }));
db.close();
```

Run the targeted suites and fix assertions until green:

Run: `bun test tests/daemon.test.ts tests/daemon-cli.test.ts`
Expected: PASS after updating seed/assertions.

- [ ] **Step 5: Commit**

```bash
git add src/daemon.ts tests/daemon.test.ts tests/daemon-cli.test.ts
git commit -m "refactor: run daemon loop on sqlite store with in-loop retention"
```

---

### Task 9: Rewire `cli.ts` enqueue

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/enqueue-cli.test.ts`, `tests/cli.test.ts`

- [ ] **Step 1: Swap the enqueue path in `src/cli.ts`**

Replace the import:

```ts
import { enqueueEvent } from "./spool";
```

with:

```ts
import { openDb } from "./db";
import { enqueue } from "./store";
```

Replace the enqueue call site (the `try { enqueueEvent(paths, event); ... }` block) with:

```ts
			try {
				const db = openDb(paths.db);
				try {
					enqueue(db, event);
				} finally {
					db.close();
				}
				return result(0, "");
			} catch (error) {
				return result(
					0,
					"",
					`enqueue failed: ${error instanceof Error ? error.message : String(error)}\n`,
				);
			}
```

(`status` already routes through `getDaemonStatus`, updated in Task 8 — no change needed here.)

- [ ] **Step 2: Update `tests/enqueue-cli.test.ts`**

Where the test asserts the job landed by reading the spool (`listJobs(paths, "incoming")`), assert via the DB instead:

```ts
import { openDb } from "../src/db";
import { countByStatus } from "../src/store";
// ...
const db = openDb(paths.db);
expect(countByStatus(db).pending).toBe(1);
db.close();
```

For a duplicate-enqueue test, enqueue the same event twice and assert `countByStatus(db).pending === 1`.

Run: `bun test tests/enqueue-cli.test.ts tests/cli.test.ts`
Expected: PASS after updating assertions.

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts tests/enqueue-cli.test.ts tests/cli.test.ts
git commit -m "refactor: cli enqueue writes to sqlite store"
```

---

### Task 10: Update integration test; final cutover delete of `spool.ts`

**Files:**
- Delete: `src/spool.ts`, `tests/spool.test.ts`
- Modify: `src/paths.ts` (remove `spool` block), `tests/integration-daemon.test.ts`

- [ ] **Step 1: Update `tests/integration-daemon.test.ts`**

Replace any `../src/spool` imports and `writeJob`/`listJobs`/`enqueueEvent` usage with `openDb(paths.db)` + `enqueue`/`countByStatus`. The end-to-end flow (enqueue → run daemon once/loop → assert done count) becomes:

```ts
import { openDb } from "../src/db";
import { enqueue, countByStatus } from "../src/store";
// seed:
const seed = openDb(paths.db);
enqueue(seed, createEvent({ agent: "claude", text: "Integration." }));
seed.close();
// after running the daemon:
const check = openDb(paths.db);
expect(countByStatus(check).done).toBe(1);
check.close();
```

- [ ] **Step 2: Delete spool files**

```bash
git rm src/spool.ts tests/spool.test.ts
```

- [ ] **Step 3: Remove the `spool` block from `src/paths.ts`**

Delete the `spool: { ... }` field from the `AgentVoicePaths` interface and from the `resolvePaths` return object, and delete the now-unused `spoolRoot` line. The file reduces to `home/config/logs/backups/run/db/launchd*` fields only.

- [ ] **Step 4: Grep for stragglers**

Run: `grep -rn "spool" src tests`
Expected: no matches in `src/`. (If `config.spool` knobs appear, that is the config key name we intentionally kept — those are fine. Any `./spool` import is a bug to fix.)

- [ ] **Step 5: Run the full suite + typecheck**

Run: `bun test && bun run typecheck`
Expected: PASS — entire suite green, no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove file spool; sqlite is the sole queue backend"
```

---

### Task 11: Manual smoke test + docs

**Files:**
- Modify: `README` / docs if they describe the spool (optional, if present)

- [ ] **Step 1: Smoke test the real binary against a temp home**

```bash
AGENT_VOICE_HOME=/tmp/av-smoke bun run src/index.ts enqueue --format text --agent claude --cwd "$PWD" <<< "Claude finished editing the auth module."
AGENT_VOICE_HOME=/tmp/av-smoke bun run src/index.ts status
```

Expected: `status` prints `pending=1` (and `processing=0 done=0 failed=0 skipped=0`), and `/tmp/av-smoke/queue.db` exists.

- [ ] **Step 2: Run one daemon iteration (mock TTS to avoid audio)**

If a `--once` path is available, run it; otherwise rely on the integration test from Task 10 as the behavioral proof. Confirm the job moves to `done`:

```bash
AGENT_VOICE_HOME=/tmp/av-smoke bun run src/index.ts status
```

- [ ] **Step 3: Clean up + commit any doc edits**

```bash
rm -rf /tmp/av-smoke
git add -A && git commit -m "docs: note sqlite queue backend" || echo "no doc changes"
```

---

## Self-review

**1. Spec coverage**

| Spec section | Covered by |
|---|---|
| Full cutover, SQLite single source of truth | Tasks 1–10 (spool deleted Task 10) |
| `bun:sqlite`, zero deps | Task 1 |
| Schema (one `jobs` table, columns, indexes, schema_meta) | Task 1 |
| Concurrency: WAL + busy_timeout + atomic claim `UPDATE … RETURNING` | Task 1 (PRAGMAs), Task 3 (`claimNextDue`), Task 5 (concurrency test) |
| Dedup via `UNIQUE(id)` ON CONFLICT | Task 2 |
| Retention in the loop + auto_vacuum/optimize | Task 5 (`pruneRetention`/`runMaintenance`), Task 8 (loop wiring) |
| History + metrics queries | Task 5 (`listHistory`; metrics columns set in Tasks 3–4) |
| No steady-state degradation (tested) | Task 5 (50k-row non-degradation test); Task 1 partial index |
| Module decomposition (db/store/queue/processor/daemon/paths/config) | Tasks 1, 2–5, 6, 7, 8, 9 |
| Start fresh (no importer) | No import task by design; Task 1 creates empty DB |
| Testing: in-memory, concurrency, retention, non-degradation | Tasks 1–5, 7 |

No gaps.

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to". Every code step has complete code. The only prose-only steps are mechanical test edits (Tasks 6, 8, 9, 10) with concrete before/after snippets — acceptable since they describe deterministic find/replace on files quoted in full earlier.

**3. Type consistency:** `JobStatus` (pending|processing|done|failed|skipped) defined in `store.ts` (Task 2), reused in `daemon.ts` (Task 8). `StoredJob extends QueueJob` (Task 2) returned by `claimNextDue` (Task 3) and consumed by `processor.ts` (Task 7). `processNextJob` signature `(db, config, deps, now)` defined Task 7, called in `daemon.ts` Task 8. `ProcessNextJobResult` changed from path-bearing variants to `{ kind, id }` — daemon loop (Task 8) only reads `result.kind`, consistent. `config.spool.*` knobs unchanged throughout.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-15-sqlite-queue-migration.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. (You opted for a Workflow earlier — this maps to running the migration as a workflow that pipelines the tasks with a verification pass.)

**2. Inline Execution** — execute tasks in this session with checkpoints for review.

**Which approach?**
