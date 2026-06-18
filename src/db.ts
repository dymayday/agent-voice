import { Database } from "bun:sqlite";

export type AgentVoiceDb = Database;

export const SCHEMA_VERSION = 2;

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
  spoken_at       TEXT,
  skip_reason     TEXT,
  last_error      TEXT,
  metadata        TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_inflight ON jobs(status, next_attempt_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_jobs_agent_created ON jobs(agent, created_at);
CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT);
`;

function hasColumn(db: Database, table: string, column: string): boolean {
	const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{
		name: string;
	}>;
	return rows.some((row) => row.name === column);
}

function migrateSchema(db: Database): void {
	if (!hasColumn(db, "jobs", "spoken_at")) {
		db.query("ALTER TABLE jobs ADD COLUMN spoken_at TEXT").run();
	}
}

export function openDb(location: string): Database {
	const db = new Database(location, { create: true });
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA busy_timeout = 5000");
	db.exec("PRAGMA synchronous = NORMAL");
	db.exec("PRAGMA auto_vacuum = INCREMENTAL");
	db.exec(SCHEMA_SQL);
	migrateSchema(db);
	db.query(
		"INSERT INTO schema_meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
	).run(String(SCHEMA_VERSION));
	return db;
}

export function getSchemaVersion(db: Database): number {
	const row = db
		.query("SELECT value FROM schema_meta WHERE key = 'schema_version'")
		.get() as { value: string } | null;
	return row ? Number(row.value) : 0;
}
