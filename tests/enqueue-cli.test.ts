import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli";
import { openDb } from "../src/db";
import { createEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import { countByStatus } from "../src/store";

async function withTempHome<T>(
	fn: (home: string) => T | Promise<T>,
): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-enqueue-test-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

function pendingCount(home: string): number {
	const paths = resolvePaths({ AGENT_VOICE_HOME: home });
	if (!existsSync(paths.db)) return 0;
	const db = openDb(paths.db);
	try {
		return countByStatus(db).pending;
	} finally {
		db.close();
	}
}

function pendingJobs(home: string): Record<string, unknown>[] {
	const paths = resolvePaths({ AGENT_VOICE_HOME: home });
	if (!existsSync(paths.db)) return [];
	const db = openDb(paths.db);
	try {
		return db
			.query("SELECT * FROM jobs WHERE status='pending' ORDER BY created_at")
			.all() as Record<string, unknown>[];
	} finally {
		db.close();
	}
}

describe("agent-voice enqueue CLI", () => {
	test("requires --format", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(["enqueue"], {
				env: { AGENT_VOICE_HOME: home },
				stdin: "done",
			});

			expect(result.exitCode).toBe(2);
			expect(result.stderr).toContain("--format is required");
			expect(pendingCount(home)).toBe(0);
		});
	});

	test("format text requires --agent and enqueues raw text with cwd", async () => {
		await withTempHome(async (home) => {
			const missingAgent = await runCli(["enqueue", "--format", "text"], {
				env: { AGENT_VOICE_HOME: home },
				stdin: "done",
			});
			expect(missingAgent.exitCode).toBe(2);
			expect(missingAgent.stderr).toContain("--agent is required");

			const rawText = "Authorization: Bearer sk-secret123 finished work  \n";
			const result = await runCli(
				["enqueue", "--format", "text", "--agent", "codex", "--cwd", "/repo"],
				{
					env: { AGENT_VOICE_HOME: home },
					stdin: rawText,
				},
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			const events = pendingJobs(home);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				version: 1,
				agent: "codex",
				event: "turn_end",
				cwd: "/repo",
			});
			expect(events[0].text).toBe(rawText);
		});
	});

	test("format event-json accepts matching agent and rejects mismatched agent", async () => {
		await withTempHome(async (home) => {
			const event = createEvent({ agent: "pi", text: "Pi finished." });
			const accepted = await runCli(
				["enqueue", "--format", "event-json", "--agent", "pi"],
				{
					env: { AGENT_VOICE_HOME: home },
					stdin: JSON.stringify(event),
				},
			);
			expect(accepted.exitCode).toBe(0);

			const rejected = await runCli(
				["enqueue", "--format", "event-json", "--agent", "claude"],
				{
					env: { AGENT_VOICE_HOME: home },
					stdin: JSON.stringify(event),
				},
			);

			expect(rejected.exitCode).toBe(2);
			expect(rejected.stderr).toContain("does not match event agent");
			expect(pendingCount(home)).toBe(1);
		});
	});

	test("format event-json preserves metadata before spooling", async () => {
		await withTempHome(async (home) => {
			const rawText = "Pi finished.  \n";
			const event = createEvent({
				agent: "pi",
				text: rawText,
				metadata: {
					token: "Bearer sk-secret123",
					apiKey: "sk-key-only",
					nested: {
						apiKey: "OPENAI_API_KEY=sk-test456",
						githubToken: "ghp_secret789",
						password: "plain-password",
					},
				},
			});

			const result = await runCli(["enqueue", "--format", "event-json"], {
				env: { AGENT_VOICE_HOME: home },
				stdin: JSON.stringify(event),
			});

			expect(result.exitCode).toBe(0);
			const events = pendingJobs(home);
			expect(events[0].text).toBe(rawText);
			const serialized = JSON.stringify(events);
			expect(serialized).toContain("Bearer sk-secret123");
			expect(serialized).toContain("OPENAI_API_KEY=sk-test456");
			expect(serialized).toContain("sk-key-only");
			expect(serialized).toContain("ghp_secret789");
			expect(serialized).toContain("plain-password");
		});
	});

	test("format claude-stop-hook requires claude agent and falls back to generic completion", async () => {
		await withTempHome(async (home) => {
			const wrongAgent = await runCli(
				["enqueue", "--format", "claude-stop-hook", "--agent", "codex"],
				{
					env: { AGENT_VOICE_HOME: home },
					stdin: "{}",
				},
			);
			expect(wrongAgent.exitCode).toBe(2);
			expect(wrongAgent.stderr).toContain("requires --agent claude");

			const result = await runCli(
				["enqueue", "--format", "claude-stop-hook", "--agent", "claude"],
				{
					env: { AGENT_VOICE_HOME: home },
					stdin: JSON.stringify({ stop_hook_active: true }),
				},
			);

			expect(result.exitCode).toBe(0);
			const events = pendingJobs(home);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				agent: "claude",
				text: "Claude finished responding.",
			});
			expect(JSON.parse(events[0].metadata as string)).toMatchObject({
				generic: true,
				format: "claude-stop-hook",
			});
		});
	});

	test("claude-stop-hook ignores non-response hook metadata", async () => {
		await withTempHome(async (home) => {
			const result = await runCli(
				["enqueue", "--format", "claude-stop-hook", "--agent", "claude"],
				{
					env: { AGENT_VOICE_HOME: home },
					stdin: JSON.stringify({
						hook_event_name: "Stop",
						session_id: "session-1",
						transcript_path: "/tmp/example-transcript.jsonl",
					}),
				},
			);

			expect(result.exitCode).toBe(0);
			const events = pendingJobs(home);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				agent: "claude",
				text: "Claude finished responding.",
			});
			expect(JSON.parse(events[0].metadata as string)).toMatchObject({
				generic: true,
				format: "claude-stop-hook",
			});
		});
	});

	test("claude-stop-hook accepts explicit response text and preserves it", async () => {
		await withTempHome(async (home) => {
			const rawText = "Claude used Authorization: Bearer sk-secret123.  \n";
			const result = await runCli(
				["enqueue", "--format", "claude-stop-hook", "--agent", "claude"],
				{
					env: { AGENT_VOICE_HOME: home },
					stdin: JSON.stringify({
						hook_event_name: "Stop",
						assistant_response: rawText,
					}),
				},
			);

			expect(result.exitCode).toBe(0);
			const events = pendingJobs(home);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				agent: "claude",
			});
			expect(JSON.parse(events[0].metadata as string)).toMatchObject({
				generic: false,
				format: "claude-stop-hook",
			});
			expect(events[0].text).toBe(rawText);
		});
	});

	test("claude-stop-hook accepts current Stop payload text, cwd, and session id", async () => {
		await withTempHome(async (home) => {
			const rawText = "Claude is asking which option to use.  \n";
			const result = await runCli(
				["enqueue", "--format", "claude-stop-hook", "--agent", "claude"],
				{
					env: { AGENT_VOICE_HOME: home },
					stdin: JSON.stringify({
						hook_event_name: "Stop",
						last_assistant_message: rawText,
						cwd: "/project",
						session_id: "claude-session-1",
					}),
				},
			);

			expect(result.exitCode).toBe(0);
			const events = pendingJobs(home);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				agent: "claude",
				text: rawText,
				cwd: "/project",
				session_id: "claude-session-1",
			});
			expect(JSON.parse(events[0].metadata as string)).toMatchObject({
				generic: false,
				format: "claude-stop-hook",
			});
		});
	});

	test("enqueue performs only local store work", async () => {
		await withTempHome(async (home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const result = await runCli(
				["enqueue", "--format", "text", "--agent", "claude"],
				{
					env: { AGENT_VOICE_HOME: home },
					stdin: "Claude finished.",
				},
			);

			expect(result.exitCode).toBe(0);
			const db = openDb(paths.db);
			try {
				const counts = countByStatus(db);
				expect(counts.pending).toBe(1);
				expect(counts.processing).toBe(0);
				expect(counts.done).toBe(0);
				expect(counts.failed).toBe(0);
				expect(counts.skipped).toBe(0);
			} finally {
				db.close();
			}
			expect(existsSync(join(paths.run, "agent-voice.pid"))).toBe(false);
		});
	});

	test("entrypoint reads stdin and enqueues raw text", async () => {
		await withTempHome(async (home) => {
			const proc = Bun.spawn(
				[
					process.execPath,
					"src/index.ts",
					"enqueue",
					"--format",
					"text",
					"--agent",
					"claude",
				],
				{
					env: { ...process.env, AGENT_VOICE_HOME: home },
					stdin: "pipe",
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const rawText = "Claude streamed raw stdin through the entrypoint.  \n";
			proc.stdin.write(rawText);
			proc.stdin.end();

			expect(await proc.exited).toBe(0);
			expect(await new Response(proc.stderr).text()).toBe("");
			expect(await new Response(proc.stdout).text()).toBe("");
			const events = pendingJobs(home);
			expect(events).toHaveLength(1);
			expect(events[0].text).toBe(rawText);
		});
	});

	test("entrypoint reads event-json stdin and preserves raw text", async () => {
		await withTempHome(async (home) => {
			const rawText = "Pi streamed raw event JSON through the entrypoint.  \n";
			const event = createEvent({ agent: "pi", text: rawText });
			const proc = Bun.spawn(
				[process.execPath, "src/index.ts", "enqueue", "--format", "event-json"],
				{
					env: { ...process.env, AGENT_VOICE_HOME: home },
					stdin: "pipe",
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			proc.stdin.write(JSON.stringify(event));
			proc.stdin.end();

			expect(await proc.exited).toBe(0);
			expect(await new Response(proc.stderr).text()).toBe("");
			expect(await new Response(proc.stdout).text()).toBe("");
			const events = pendingJobs(home);
			expect(events).toHaveLength(1);
			expect(events[0].text).toBe(rawText);
		});
	});

	test("entrypoint reads claude-stop-hook stdin and preserves response text", async () => {
		await withTempHome(async (home) => {
			const rawText =
				"Claude streamed raw hook text through the entrypoint.  \n";
			const proc = Bun.spawn(
				[
					process.execPath,
					"src/index.ts",
					"enqueue",
					"--format",
					"claude-stop-hook",
					"--agent",
					"claude",
				],
				{
					env: { ...process.env, AGENT_VOICE_HOME: home },
					stdin: "pipe",
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			proc.stdin.write(
				JSON.stringify({
					hook_event_name: "Stop",
					assistant_response: rawText,
				}),
			);
			proc.stdin.end();

			expect(await proc.exited).toBe(0);
			expect(await new Response(proc.stderr).text()).toBe("");
			expect(await new Response(proc.stdout).text()).toBe("");
			const events = pendingJobs(home);
			expect(events).toHaveLength(1);
			expect(events[0].text).toBe(rawText);
		});
	});

	test("duplicate enqueue of the same event is a no-op", async () => {
		await withTempHome(async (home) => {
			const event = createEvent({ agent: "pi", text: "Once." });
			const first = await runCli(["enqueue", "--format", "event-json"], {
				env: { AGENT_VOICE_HOME: home },
				stdin: JSON.stringify(event),
			});
			expect(first.exitCode).toBe(0);

			const second = await runCli(["enqueue", "--format", "event-json"], {
				env: { AGENT_VOICE_HOME: home },
				stdin: JSON.stringify(event),
			});
			expect(second.exitCode).toBe(0);

			expect(pendingCount(home)).toBe(1);
		});
	});

	test("enqueue path has no removed helper imports", () => {
		const cliSource = readFileSync("src/cli.ts", "utf8");
		const removedModule = "red" + "action";
		const removedHelper = "prepare" + "Text";

		expect(existsSync(join("src", `${removedModule}.ts`))).toBe(false);
		expect(cliSource).not.toContain(`./${removedModule}`);
		expect(cliSource).not.toContain(removedHelper);
		expect(cliSource).not.toContain("trim" + "End");
	});

	test("best-effort enqueue failure exits zero without starting daemon side effects", async () => {
		const homeFile = join(
			tmpdir(),
			`agent-voice-home-file-${crypto.randomUUID()}`,
		);
		writeFileSync(homeFile, "not a directory", "utf8");
		try {
			const result = await runCli(
				["enqueue", "--format", "text", "--agent", "claude"],
				{
					env: { AGENT_VOICE_HOME: homeFile },
					stdin: "Claude finished.",
				},
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain("enqueue failed");
			expect(readFileSync(homeFile, "utf8")).toBe("not a directory");
		} finally {
			rmSync(homeFile, { force: true });
		}
	});
});
