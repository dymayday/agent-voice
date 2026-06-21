import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import {
	TURSO_MULTIPROCESS_WAL_FEATURE,
	normalizeSqlParams,
	runOptionalMaintenance,
	tursoExperimentalFeaturesForLocation,
} from "../src/db-adapter";
import { createEvent } from "../src/events";
import { countByStatus, enqueue } from "../src/store";

describe("Turso database adapter", () => {
	test("normalizes sqlite-style named parameter objects for Turso bindings", () => {
		expect(
			normalizeSqlParams({
				$id: "job-1",
				$created_at: "2026-06-21T00:00:00.000Z",
				plain: "kept",
			}),
		).toEqual({
			$id: "job-1",
			id: "job-1",
			$created_at: "2026-06-21T00:00:00.000Z",
			created_at: "2026-06-21T00:00:00.000Z",
			plain: "kept",
		});

		const positional = ["job-1", "pending"];
		expect(normalizeSqlParams(positional)).toBe(positional);
		expect(normalizeSqlParams("job-1")).toBe("job-1");
	});

	test("optional maintenance pragmas are ignored only when unsupported", () => {
		const unsupportedCalls: string[] = [];
		runOptionalMaintenance(
			{
				exec(sql: string) {
					unsupportedCalls.push(sql);
					throw new Error("Parse error: Not a valid pragma name");
				},
			},
			"PRAGMA optimize",
		);
		expect(unsupportedCalls).toEqual(["PRAGMA optimize"]);

		expect(() =>
			runOptionalMaintenance(
				{
					exec() {
						throw new Error("disk full");
					},
				},
				"PRAGMA optimize",
			),
		).toThrow("disk full");
	});

	test("database code no longer imports Bun's sqlite driver directly", () => {
		for (const file of [
			"src/db.ts",
			"src/store.ts",
			"src/processor.ts",
			"src/daemon.ts",
			"src/history.ts",
		]) {
			const source = readFileSync(file, "utf8");
			expect(source, file).not.toContain('from "bun:sqlite"');
		}
	});

	test("Turso is a runtime dependency", () => {
		const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
		expect(packageJson.dependencies?.["@tursodatabase/database"]).toBe("0.6.1");
	});

	test("file databases explicitly enable Turso multi-process WAL", () => {
		expect(tursoExperimentalFeaturesForLocation("queue.db")).toContain(
			TURSO_MULTIPROCESS_WAL_FEATURE,
		);
		expect(tursoExperimentalFeaturesForLocation("/tmp/queue.db")).toContain(
			"multiprocess_wal",
		);
		expect(tursoExperimentalFeaturesForLocation(":memory:")).toEqual([]);
		expect(tursoExperimentalFeaturesForLocation("file::memory:")).toEqual([]);
		expect(tursoExperimentalFeaturesForLocation("file:queue?mode=memory")).toEqual(
			[],
		);
	});

	test("file databases support daemon plus CLI process access", () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-turso-mp-"));
		try {
			const dbPath = join(home, "queue.db");
			const db = openDb(dbPath);
			try {
				enqueue(db, createEvent({ agent: "claude", text: "Parent process." }));
				const child = Bun.spawnSync({
					cmd: [process.execPath, "tests/fixtures/turso-multiprocess-child.ts", dbPath],
					cwd: process.cwd(),
					stdout: "pipe",
					stderr: "pipe",
				});

				expect(child.exitCode).toBe(0);
				expect(child.stderr.toString()).toBe("");
				expect(child.stdout.toString().trim()).not.toBe("");
				expect(countByStatus(db).pending).toBe(2);
			} finally {
				db.close();
			}
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
