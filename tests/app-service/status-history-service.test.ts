import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config";
import { formatHistoryJson } from "../../src/history";
import { formatAppStatusJson } from "../../src/status";
import { openDb } from "../../src/db";
import { createEvent } from "../../src/events";
import { resolvePaths } from "../../src/paths";
import {
	claimNextDue,
	enqueue,
	markDone,
	markFailed,
	markSkipped,
	markSpoken,
} from "../../src/store";
import { getHistory } from "../../src/app-service/history-service";
import {
	getQueueSnapshot,
	getStatus,
} from "../../src/app-service/status-service";

function fixture() {
	const home = mkdtempSync(
		join(tmpdir(), "agent-voice-status-history-service-"),
	);
	const paths = resolvePaths({ AGENT_VOICE_HOME: home });
	const db = openDb(paths.db);
	return { home, paths, db };
}

function cleanup(home: string, db?: ReturnType<typeof openDb>) {
	db?.close();
	rmSync(home, { recursive: true, force: true });
}

describe("app-service status and history", () => {
	test("getStatus maps existing status, queue, install, and build fields", () => {
		const { home, paths, db } = fixture();
		try {
			enqueue(db, createEvent({ agent: "claude", text: "pending" }));
			const failed = createEvent({ agent: "codex", text: "failed" });
			enqueue(db, failed);
			markFailed(db, failed.id, new Date("2026-06-15T00:00:00.000Z"), "boom");
			db.close();

			const result = getStatus(paths, {
				daemonDeps: { isPidAlive: () => false },
				installEnv: { HOME: home },
				playback: { platform: "linux", commandExists: (cmd) => cmd === "paplay" },
			});

			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error(result.error.message);
			expect(result.value.version).toBe(1);
			expect(result.value.buildId).toBeNull();
			expect(result.value.daemon).toMatchObject({
				state: "stopped",
				running: false,
				pid: null,
			});
			expect(result.value.queue.pending).toBe(1);
			expect(result.value.queue.failed).toBe(1);
			expect(result.value.attention).toContain("failed_jobs");
			expect(result.value.playback).toMatchObject({
				state: "available",
				backend: "paplay",
				checked: ["paplay"],
			});
			expect(result.value.install).toBeDefined();
			expect(Object.keys(result.value.install ?? {}).sort()).toEqual([
				"claude",
				"codex",
				"opencode",
				"pi",
			]);
		} finally {
			cleanup(home);
		}
	});

	test("getQueueSnapshot returns active and recent rows without mutating the store", () => {
		const { home, paths, db } = fixture();
		try {
			const pending = createEvent({ agent: "pi", text: "pending" });
			const processing = createEvent({ agent: "codex", text: "processing" });
			const done = createEvent({ agent: "claude", text: "done" });
			enqueue(db, { ...pending, createdAt: "2026-06-15T00:00:01.000Z" });
			enqueue(db, { ...processing, createdAt: "2026-06-15T00:00:02.000Z" });
			enqueue(db, { ...done, createdAt: "2026-06-15T00:00:03.000Z" });
			expect(claimNextDue(db, loadConfig(paths))?.id).toBe(pending.id);
			markSpoken(db, done.id, "done summary", "heuristic");
			markDone(db, done.id, new Date("2026-06-15T00:01:00.000Z"));
			db.close();

			const before = getQueueSnapshot(paths);
			const after = getQueueSnapshot(paths);
			expect(before.ok).toBe(true);
			expect(after.ok).toBe(true);
			if (!before.ok || !after.ok) throw new Error("queue snapshot failed");
			expect(before.value.pending.map((job) => job.id)).toEqual([
				processing.id,
			]);
			expect(before.value.processing.map((job) => job.id)).toEqual([
				pending.id,
			]);
			expect(before.value.recent.map((job) => job.id)).toEqual([done.id]);
			expect(after.value).toEqual(before.value);
		} finally {
			cleanup(home);
		}
	});

	test("getHistory uses public before cursor semantics and returns BAD_INPUT failures", () => {
		const { home, paths, db } = fixture();
		try {
			const newest = createEvent({ agent: "claude", text: "newest" });
			const oldest = createEvent({ agent: "pi", text: "oldest" });
			enqueue(db, { ...oldest, createdAt: "2026-06-15T00:00:01.000Z" });
			enqueue(db, { ...newest, createdAt: "2026-06-15T00:00:02.000Z" });
			markSpoken(db, oldest.id, "oldest summary", "heuristic");
			markDone(db, oldest.id, new Date("2026-06-15T00:01:00.000Z"));
			markSkipped(
				db,
				newest.id,
				"disabled_system",
				new Date("2026-06-15T00:02:00.000Z"),
			);
			db.close();

			const first = getHistory({ limit: 1 }, paths);
			expect(first.ok).toBe(true);
			if (!first.ok) throw new Error(first.error.message);
			expect(first.value.jobs.map((job) => job.id)).toEqual([newest.id]);
			expect(first.value.pageInfo.nextCursor).toEqual(expect.any(String));

			const second = getHistory(
				{ limit: 1, before: first.value.pageInfo.nextCursor! },
				paths,
			);
			expect(second.ok).toBe(true);
			if (!second.ok) throw new Error(second.error.message);
			expect(second.value.jobs.map((job) => job.id)).toEqual([oldest.id]);

			const badCursor = getHistory({ before: "not-a-cursor" }, paths);
			expect(badCursor).toMatchObject({
				ok: false,
				error: { code: "BAD_INPUT" },
			});
			const badLimit = getHistory({ limit: 1.5 }, paths);
			expect(badLimit).toMatchObject({
				ok: false,
				error: { code: "BAD_INPUT" },
			});
		} finally {
			cleanup(home);
		}
	});

	test("service layer does not change existing CLI JSON fixture formatting helpers", () => {
		const historyJson = formatHistoryJson({
			version: 1,
			jobs: [],
			pageInfo: { limit: 50, hasMore: false, nextCursor: null },
		});
		expect(historyJson).toBe(
			'{\n  "version": 1,\n  "jobs": [],\n  "pageInfo": {\n    "limit": 50,\n    "hasMore": false,\n    "nextCursor": null\n  }\n}\n',
		);
		const statusJson = formatAppStatusJson({
			version: 1,
			buildId: null,
			daemon: { state: "stopped", running: false, pid: null },
			queues: { pending: 0, processing: 0, done: 0, failed: 0, skipped: 0 },
			config: {
				enabled: true,
				agents: {
					claude: { enabled: true, mode: "native" },
					codex: { enabled: true, mode: "native" },
					opencode: { enabled: true, mode: "native" },
					pi: { enabled: true, mode: "native" },
				},
			},
			install: {
				claude: "not_installed",
				codex: "not_installed",
				opencode: "not_installed",
				pi: "not_installed",
			},
			paths: {
				home: "/tmp/av",
				config: "/tmp/av/config.json",
				db: "/tmp/av/queue.db",
			},
			ui: { state: "daemon_stopped", attention: [] },
		});
		expect(statusJson).toContain('"queues"');
		expect(statusJson).not.toContain('"queue"');
	});
});
