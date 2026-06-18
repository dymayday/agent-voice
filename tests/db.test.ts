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
			expect(names).toContain("spoken_at");
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
