import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { createEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import { enqueue, markDone } from "../src/store";

const repoRoot = join(import.meta.dir, "..");

describe("agent-voice CLI stdout flushing", () => {
	test("history --json is fully flushed when output exceeds the OS pipe buffer", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-flush-test-"));
		try {
			const avHome = join(home, ".agent-voice");
			mkdirSync(avHome, { recursive: true });
			const paths = resolvePaths({ AGENT_VOICE_HOME: avHome });

			// Seed enough completed jobs that the history JSON is larger than the
			// 64 KiB OS pipe buffer — the threshold at which a premature
			// process.exit() drops buffered stdout and the macOS app decodes a
			// truncated document ("Unexpected end of file").
			const jobCount = 60;
			const bigText = "x".repeat(2000);
			const db = openDb(paths.db);
			try {
				for (let i = 0; i < jobCount; i++) {
					const event = createEvent({
						agent: "pi",
						text: `job ${i} ${bigText}`,
						cwd: "/project",
						metadata: { format: "text" },
					});
					enqueue(db, event);
					markDone(db, event.id);
				}
			} finally {
				db.close();
			}

			// Run the real entrypoint behind a genuine OS pipe whose consumer stalls
			// before reading — exactly how the macOS app drains stdout. While the
			// consumer sleeps the kernel pipe buffer fills; a process that exits
			// without flushing drops every byte past the buffer, whereas one that
			// waits for the write to drain delivers the whole document.
			const proc = Bun.spawn({
				cmd: [
					"bash",
					"-c",
					"bun src/index.ts history --json --limit 200 | { sleep 0.5; cat; }",
				],
				cwd: repoRoot,
				env: { ...process.env, AGENT_VOICE_HOME: avHome },
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);

			expect(exitCode).toBe(0);
			expect(stderr).toBe("");
			// The whole document must survive the pipe, not just the first 64 KiB.
			expect(stdout.length).toBeGreaterThan(65536);
			const parsed = JSON.parse(stdout) as { jobs: unknown[] };
			expect(parsed.jobs.length).toBe(jobCount);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
