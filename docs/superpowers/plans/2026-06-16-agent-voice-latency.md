# agent-voice Latency Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the spoken-summary path fast and reliable by switching the summarizer to `pi` through the working `openai-codex` subscription (thinking off), and removing the reliability/observability defects that inflate latency to ~13.7s typical / ~117s worst.

**Architecture:** A pi turn enqueues a job into SQLite; a long-lived daemon claims it, summarizes (now `pi --model openai-codex/gpt-5.5 --thinking off`, ~5.8s, with an instant heuristic fallback), synthesizes via a persistent (pre-warmed) Kokoro client, and plays it serially. Changes are confined to `src/` (config, summarizers, processor, daemon, cli) plus tests; playback stays serial (one voice at a time).

**Tech Stack:** Bun + TypeScript, `bun:sqlite`, `bun:test`. External CLIs: `pi`, Kokoro (Python), `afplay`.

---

## Spec

Design spec: `docs/superpowers/specs/2026-06-16-agent-voice-latency-design.md`.

## Background the engineer needs

- **Entry path (only live agent is `pi`):** `~/.pi/agent/extensions/agent-voice.ts` spawns `bin/agent-voice enqueue --format text --agent pi` on `agent_end`, detached, with env `AGENT_VOICE_DISABLE=1`. The extension early-returns when `AGENT_VOICE_DISABLE === "1"` (`src/install.ts:111`), so the summarizer spawning `pi` cannot recurse. **This is why we can drop `--no-session`.**
- **The proven working summarizer command** (measured ~5.82s / 5.84s, clean one-liner): `pi --model 'openai-codex/gpt-5.5' --thinking 'off' --no-tools -p "<prompt>"`. The old code used `openai/gpt-5.3-codex` (wrong provider prefix → over-quota key) and a trailing `-` arg pi rejects.
- **`Bun.spawn([cmd, ...args])` does not use a shell**, so passing the prompt as the `-p` argument value is safe (no interpolation risk), even though other summarizers pass text via stdin.
- **The `proc≈0` bug:** `runDaemonLoop` calls `deps.now?.()` once per iteration and passes that frozen `Date` to `processNextJob`, which reuses it for both `claimed_at` (via `claimNextDue`) and `finished_at` (via `markDone`). Real work happens between them but the timestamp never advances. Fix = take a fresh timestamp at completion.
- **The ~117s worst case:** a `speak()` failure ("Kokoro exited before ready") goes through `scheduleRetry` (backoff `30s × 3 attempts`), blocking the single-worker queue. Fix = make TTS failure terminal.
- **`codex-fast` / `opencode` summarizer branches are intentionally left untouched** (retained as escape hatches, not in the default chain). Do not modify their args, the `codexModel` default, or their existing tests.

## File structure

- `src/config.ts` — add `SummarizerThinking` type + `summarizer.thinking`; change `priority` and `piModel` defaults.
- `src/summarizers.ts` — rewrite the `pi-fast` request; add ANSI/terminal-escape stripping in `cleanForSpeech`.
- `src/processor.ts` — `ProcessorDeps.prewarm?`; rewrite `processNextJob` (injectable clock + terminal TTS failure).
- `src/daemon.ts` — pass a clock function to `processNextJob`; pre-warm before the loop; lower idle poll default.
- `src/cli.ts` — `defaultProcessorDeps` provides `prewarm`.
- Tests: edit `tests/summarizers.test.ts`; create `tests/processor.test.ts`, `tests/daemon-prewarm.test.ts`.

---

## Task 1: Config — add `thinking`, flip defaults to pi-first

**Files:**
- Modify: `src/config.ts`
- Test: `tests/summarizers.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe("agent-voice summarizer fallback chain", ...)` block in `tests/summarizers.test.ts`:

```ts
test("default summarizer config is pi-first through the codex subscription", () => {
	expect(defaultConfig.summarizer.priority).toEqual(["pi-fast", "heuristic"]);
	expect(defaultConfig.summarizer.piModel).toBe("openai-codex/gpt-5.5");
	expect(defaultConfig.summarizer.thinking).toBe("off");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/summarizers.test.ts -t "default summarizer config is pi-first"`
Expected: FAIL (priority is the old 4-entry list; `piModel` is `openai/gpt-5.3-codex`; `thinking` is `undefined`).

- [ ] **Step 3: Add the `SummarizerThinking` type**

In `src/config.ts`, directly after the `SummarizerName` type, add:

```ts
export type SummarizerThinking = "off" | "low" | "medium" | "high";
```

- [ ] **Step 4: Add the `thinking` field to the config interface**

In `src/config.ts`, in the `summarizer` block of `interface AgentVoiceConfig`, add `thinking` after `opencodeModel`:

```ts
	summarizer: {
		priority: SummarizerName[];
		codexModel: string;
		piModel: string;
		opencodeModel: string | null;
		thinking: SummarizerThinking;
		timeoutSeconds: number;
		maxInputChars: number;
		maxSummaryChars: number;
	};
```

- [ ] **Step 5: Change the defaults**

In `src/config.ts`, in `defaultConfig.summarizer`, change `priority` and `piModel` and add `thinking` (leave `codexModel` and the rest unchanged):

```ts
	summarizer: {
		priority: ["pi-fast", "heuristic"],
		codexModel: "gpt-5.3-codex",
		piModel: "openai-codex/gpt-5.5",
		opencodeModel: null,
		thinking: "off",
		timeoutSeconds: 12,
		maxInputChars: 12000,
		maxSummaryChars: 180,
	},
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/summarizers.test.ts -t "default summarizer config is pi-first"`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/config.ts tests/summarizers.test.ts
git commit -m "feat: default summarizer to pi via openai-codex subscription, add thinking config"
```

---

## Task 2: Summarizer — fix the pi invocation

**Files:**
- Modify: `src/summarizers.ts:112-126` (the `pi-fast` branch in `requestFor`)
- Test: `tests/summarizers.test.ts` (rewrite the existing pi test)

- [ ] **Step 1: Rewrite the failing test**

Replace the existing test `"Pi fast uses safe arg array with configured model and recursion guard"` in `tests/summarizers.test.ts` with:

```ts
	test("Pi fast passes the prompt via -p with the configured model and thinking", async () => {
		const event = createEvent({
			agent: "pi",
			text: "Pi completed the queue task.",
		});
		const { calls, runner } = recordingRunner(() => ({
			ok: true,
			stdout: "Pi completed the queue policy.\n",
		}));

		const summary = await summarize(
			event,
			config({
				summarizer: {
					priority: ["pi-fast", "heuristic"],
					piModel: "openai-codex/gpt-5.5",
				},
			}),
			runner,
		);

		expect(summary).toBe("Pi completed the queue policy.");
		expect(calls).toHaveLength(1);
		expect(calls[0].cmd).toBe("pi");
		expect(calls[0].args.slice(0, 5)).toEqual([
			"--model",
			"openai-codex/gpt-5.5",
			"--thinking",
			"off",
			"--no-tools",
		]);
		expect(calls[0].args[5]).toBe("-p");
		expect(calls[0].args[6]).toContain("Pi completed the queue task.");
		expect(calls[0].args).toHaveLength(7);
		expect(calls[0].stdin).toBe("");
		expect(calls[0].env.AGENT_VOICE_DISABLE).toBe("1");
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/summarizers.test.ts -t "Pi fast passes the prompt via -p"`
Expected: FAIL (current args are `["--fast","-p","--model",...,"--no-tools","--no-session","-"]` and the prompt is in `stdin`, not args).

- [ ] **Step 3: Rewrite the pi-fast branch**

In `src/summarizers.ts`, replace the `if (name === "pi-fast") { ... }` block in `requestFor` with:

```ts
	if (name === "pi-fast") {
		const prompt = base.stdin;
		return {
			...base,
			cmd: "pi",
			args: [
				"--model",
				config.summarizer.piModel,
				"--thinking",
				config.summarizer.thinking ?? "off",
				"--no-tools",
				"-p",
				prompt,
			],
			stdin: "",
		};
	}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/summarizers.test.ts -t "Pi fast passes the prompt via -p"`
Expected: PASS

- [ ] **Step 5: Run the whole summarizer test file to confirm no regressions**

Run: `bun test tests/summarizers.test.ts`
Expected: PASS (the codex/opencode/fallback tests are unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/summarizers.ts tests/summarizers.test.ts
git commit -m "fix: pi summarizer uses openai-codex provider, -p prompt, and thinking flag"
```

---

## Task 3: Summarizer — strip terminal escape sequences

`pi -p` emits TUI teardown sequences (e.g. `[?2026h[<999u`). They must never reach the voice. We strip them anchored on the ESC byte (``), which never appears in legitimate text — so bracketed words like `[important]` are safe.

**Files:**
- Modify: `src/summarizers.ts` (the pattern constants block + `cleanForSpeech`)
- Test: `tests/summarizers.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the `describe` block in `tests/summarizers.test.ts`:

```ts
	test("heuristic strips embedded terminal escape sequences", () => {
		const noisy = "[?2026hThe build [<999upassed.";
		expect(heuristicSummary(noisy, 180)).toBe("The build passed.");
	});

	test("pi stdout escape sequences never leak into the summary", async () => {
		const event = createEvent({ agent: "pi", text: "Pi did the work." });
		const { runner } = recordingRunner(() => ({
			ok: true,
			stdout: "[?2026hPi finished the task[<999u",
		}));

		const summary = await summarize(
			event,
			config({ summarizer: { priority: ["pi-fast", "heuristic"] } }),
			runner,
		);

		expect(summary).toBe("Pi finished the task");
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/summarizers.test.ts -t "escape"`
Expected: FAIL (the residual `[?2026h` / `[<999u` survive into the cleaned text).

- [ ] **Step 3: Add the ANSI pattern**

In `src/summarizers.ts`, add this constant next to the other `*_PATTERN` constants (near line 35):

```ts
const ANSI_ESCAPE_PATTERN =
	// eslint-disable-next-line no-control-regex
	/(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
```

- [ ] **Step 4: Apply it first in `cleanForSpeech`**

In `src/summarizers.ts`, change `cleanForSpeech` so the ANSI strip runs before line splitting:

```ts
function cleanForSpeech(text: string): string {
	return text
		.replace(ANSI_ESCAPE_PATTERN, "")
		.split(/\r?\n/)
		.map((line) => line.replace(LINE_PREFIX_PATTERN, "").trim())
		.filter(Boolean)
		.join(" ")
		.replace(CONTROL_CHARS_PATTERN, " ")
		.replace(MARKDOWN_NOISE_PATTERN, "")
		.replace(WHITESPACE_PATTERN, " ")
		.trim();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/summarizers.test.ts -t "escape"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/summarizers.ts tests/summarizers.test.ts
git commit -m "fix: strip terminal escape sequences from summaries before speech"
```

---

## Task 4: Processor — injectable clock + terminal TTS failure

Two fixes in one function rewrite (they touch the same code): (a) take a **fresh** timestamp at completion so `finished_at` is real; (b) make a `speak()` failure **terminal** (no retry backoff) so a broken Kokoro never stalls the queue. Summarizer failures keep the existing retry behavior.

**Files:**
- Modify: `src/processor.ts` (`processNextJob`)
- Modify: `src/daemon.ts` (the two `processNextJob` call sites)
- Test: `tests/processor.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/processor.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config";
import { openDb } from "../src/db";
import { createEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import { processNextJob, type ProcessorDeps } from "../src/processor";
import { enqueue } from "../src/store";

async function withDb<T>(fn: (db: ReturnType<typeof openDb>) => Promise<T>): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-processor-test-"));
	const db = openDb(resolvePaths({ AGENT_VOICE_HOME: home }).db);
	try {
		return await fn(db);
	} finally {
		db.close();
		rmSync(home, { recursive: true, force: true });
	}
}

function increasingClock(seconds: number[]): () => Date {
	const times = seconds.map((s) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)));
	let index = 0;
	return () => times[Math.min(index++, times.length - 1)];
}

describe("processNextJob", () => {
	test("records a fresh finished_at later than claimed_at", async () => {
		await withDb(async (db) => {
			const event = createEvent({ agent: "pi", text: "Do the thing." });
			enqueue(db, event);
			const deps: ProcessorDeps = {
				summarize: async () => "A summary.",
				speak: async () => {},
			};

			const result = await processNextJob(
				db,
				defaultConfig,
				deps,
				increasingClock([0, 5]),
			);

			expect(result.kind).toBe("processed");
			const row = db
				.query("SELECT claimed_at, finished_at FROM jobs WHERE id=?")
				.get(event.id) as { claimed_at: string; finished_at: string };
			expect(Date.parse(row.finished_at)).toBeGreaterThan(
				Date.parse(row.claimed_at),
			);
		});
	});

	test("treats a TTS failure as terminal without scheduling a retry", async () => {
		await withDb(async (db) => {
			const event = createEvent({ agent: "pi", text: "Speak me." });
			enqueue(db, event);
			const deps: ProcessorDeps = {
				summarize: async () => "A summary.",
				speak: async () => {
					throw new Error("Kokoro exited before ready");
				},
			};

			const result = await processNextJob(db, defaultConfig, deps);

			expect(result.kind).toBe("failed");
			const row = db
				.query(
					"SELECT status, attempts, next_attempt_at, last_error FROM jobs WHERE id=?",
				)
				.get(event.id) as {
				status: string;
				attempts: number;
				next_attempt_at: string | null;
				last_error: string | null;
			};
			expect(row.status).toBe("failed");
			expect(row.attempts).toBe(1);
			expect(row.next_attempt_at).toBeNull();
			expect(row.last_error).toContain("Kokoro exited before ready");
		});
	});

	test("still schedules a retry when summarization throws", async () => {
		await withDb(async (db) => {
			const event = createEvent({ agent: "pi", text: "Summarize me." });
			enqueue(db, event);
			const deps: ProcessorDeps = {
				summarize: async () => {
					throw new Error("summarizer offline");
				},
				speak: async () => {},
			};

			const result = await processNextJob(db, defaultConfig, deps);

			expect(result.kind).toBe("retry_scheduled");
			const row = db
				.query("SELECT status, next_attempt_at FROM jobs WHERE id=?")
				.get(event.id) as { status: string; next_attempt_at: string | null };
			expect(row.status).toBe("pending");
			expect(row.next_attempt_at).not.toBeNull();
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/processor.test.ts`
Expected: FAIL — the finished_at test fails (frozen `now` makes them equal); the TTS-terminal test fails (current code schedules a retry → `retry_scheduled`, status `pending`). The summarize-retry test passes already but stays as a guard.

- [ ] **Step 3: Rewrite `processNextJob`**

In `src/processor.ts`, replace the entire `processNextJob` function with:

```ts
export async function processNextJob(
	db: Database,
	config: AgentVoiceConfig,
	deps: ProcessorDeps,
	now: () => Date = () => new Date(),
): Promise<ProcessNextJobResult> {
	const claimNow = now();
	const recovered = recoverStale(db, config, claimNow);
	const claimed: StoredJob | null = claimNextDue(db, config, claimNow);
	if (!claimed) return { kind: "idle", recovered };

	// Resume after a crash that happened post-speak: summary already persisted.
	if (claimed.summary) {
		markDone(db, claimed.id, now());
		return { kind: "processed", id: claimed.id };
	}

	let summary: string;
	try {
		summary = await deps.summarize(claimed, config);
	} catch (error) {
		const failNow = now();
		const lastError = errorMessage(error);
		const retry = scheduleRetry(claimed, config, failNow, lastError);
		if (retry.state === "incoming" && retry.job.nextAttemptAt) {
			requeueForRetry(db, claimed.id, retry.job.nextAttemptAt, lastError);
			return { kind: "retry_scheduled", id: claimed.id };
		}
		markFailed(db, claimed.id, failNow, lastError);
		return { kind: "failed", id: claimed.id };
	}

	try {
		await deps.speak(summary, config.tts.voice, claimed);
	} catch (error) {
		// TTS failure is terminal: the summary is computed but cannot be spoken.
		// Do not enter retry backoff — a broken Kokoro must never stall the queue.
		markFailed(db, claimed.id, now(), `speak failed: ${errorMessage(error)}`);
		return { kind: "failed", id: claimed.id };
	}

	markSpoken(db, claimed.id, summary, summarizerName(config));
	markDone(db, claimed.id, now());
	return { kind: "processed", id: claimed.id };
}
```

- [ ] **Step 4: Update the daemon call sites for the new clock signature**

First check for any other callers:

Run: `grep -rn "processNextJob" src tests`
Expected: callers are `src/daemon.ts` (two), `src/processor.ts` (definition), `tests/processor.test.ts`. If any other caller passes a `Date`, change it to pass `() => thatDate`.

In `src/daemon.ts`, in `runDaemonOnce`, change the call to:

```ts
		return await processNextJob(
			db,
			config,
			requireProcessorDeps(deps),
			deps.now ?? (() => new Date()),
		);
```

In `src/daemon.ts`, in `runDaemonLoop`, replace the body of the `while` loop's start so a clock function is used (note `pruneRetention` now takes `clock()`):

```ts
		const clock = deps.now ?? (() => new Date());
		while (summary.iterations < maxIterations && !hasIntentionalStop(paths)) {
			const result = await processNextJob(
				db,
				config,
				requireProcessorDeps(deps),
				clock,
			);
			summary.iterations += 1;
			if (result.kind === "processed") summary.processed += 1;
			if (result.kind === "idle") summary.idle += 1;
			if (result.kind === "retry_scheduled") summary.retryScheduled += 1;
			if (result.kind === "failed") summary.failed += 1;
			if (summary.iterations % pruneEvery === 0) {
				pruneRetention(db, config.spool.retentionDays, clock());
				runMaintenance(db);
			}
			if (result.kind === "idle") await sleep(pollIntervalMs);
		}
```

(Delete the old `const now = deps.now?.() ?? new Date();` line — `clock` replaces it.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/processor.test.ts`
Expected: PASS (all three)

Run: `bun test tests/daemon-cli.test.ts`
Expected: PASS (no regressions from the signature change)

- [ ] **Step 6: Commit**

```bash
git add src/processor.ts src/daemon.ts tests/processor.test.ts
git commit -m "fix: real finished_at timestamp and terminal TTS failures in processNextJob"
```

---

## Task 5: Daemon — pre-warm Kokoro + lower idle poll floor

Pre-warm the persistent Kokoro client during idle daemon init so the ~6.7s model load never lands on the first spoken summary, and lower the idle poll floor from 1000ms to 200ms.

**Files:**
- Modify: `src/processor.ts` (`ProcessorDeps`)
- Modify: `src/daemon.ts` (`runDaemonLoop`)
- Modify: `src/cli.ts` (`defaultProcessorDeps`)
- Test: `tests/daemon-prewarm.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/daemon-prewarm.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config";
import { runDaemonLoop } from "../src/daemon";
import { openDb } from "../src/db";
import { createEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import { enqueue } from "../src/store";

describe("daemon pre-warm", () => {
	test("calls prewarm once before processing any job", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-prewarm-test-"));
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const seed = openDb(paths.db);
			enqueue(seed, createEvent({ agent: "pi", text: "Warm then speak." }));
			seed.close();

			const events: string[] = [];
			await runDaemonLoop(paths, defaultConfig, {
				maxIterations: 1,
				pollIntervalMs: 0,
				processorDeps: {
					prewarm: async () => {
						events.push("prewarm");
					},
					summarize: async () => "Summary.",
					speak: async () => {
						events.push("speak");
					},
				},
			});

			expect(events).toEqual(["prewarm", "speak"]);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/daemon-prewarm.test.ts`
Expected: FAIL — `prewarm` is never called (type error tolerated by Bun at runtime; `events` is `["speak"]`).

- [ ] **Step 3: Add `prewarm` to `ProcessorDeps`**

In `src/processor.ts`, add the optional field to the interface:

```ts
export interface ProcessorDeps {
	summarize: (event: AgentVoiceEvent, config: AgentVoiceConfig) => Promise<string>;
	speak: (summary: string, voice: string, event: AgentVoiceEvent) => Promise<void>;
	prewarm?: () => Promise<void>;
}
```

- [ ] **Step 4: Call prewarm before the loop and lower the poll default**

In `src/daemon.ts` `runDaemonLoop`, change the poll default and add the pre-warm call before the `while` loop. Replace:

```ts
	const maxIterations = deps.maxIterations ?? Number.POSITIVE_INFINITY;
	const pollIntervalMs = deps.pollIntervalMs ?? 1000;
	const pruneEvery = deps.pruneEveryIterations ?? 300;
	const db = openDb(paths.db);
	try {
```

with:

```ts
	const maxIterations = deps.maxIterations ?? Number.POSITIVE_INFINITY;
	const pollIntervalMs = deps.pollIntervalMs ?? 200;
	const pruneEvery = deps.pruneEveryIterations ?? 300;
	const procDeps = requireProcessorDeps(deps);
	try {
		await procDeps.prewarm?.();
	} catch {
		// Best-effort warm-up; the first job will retry readiness if this failed.
	}
	const db = openDb(paths.db);
	try {
```

- [ ] **Step 5: Provide `prewarm` in `defaultProcessorDeps`**

In `src/cli.ts`, update `defaultProcessorDeps` to expose the Kokoro warm-up:

```ts
function defaultProcessorDeps(
	config: ReturnType<typeof loadConfig>,
	paths: ReturnType<typeof resolvePaths>,
): ProcessorDeps {
	const kokoro = new KokoroClient(config);
	return {
		summarize,
		speak: async (summary, voice) => {
			const audio = await kokoro.speak(summary, voice);
			await playWav(audio, paths, undefined, {
				timeoutMs: config.tts.timeoutSeconds * 1000,
			});
		},
		prewarm: async () => {
			await kokoro.ensureReady();
		},
	};
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test tests/daemon-prewarm.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/processor.ts src/daemon.ts src/cli.ts tests/daemon-prewarm.test.ts
git commit -m "feat: pre-warm Kokoro at daemon start and lower idle poll floor to 200ms"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `bun test`
Expected: PASS — all files green, including the previously-edited `tests/summarizer-mode.test.ts` (its "default" assertion reads `defaultConfig.summarizer.priority`, so it tracks the new value automatically).

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit only if Steps 1–2 required a fix**

If a fix was needed:

```bash
git add -A
git commit -m "test: fix fallout from latency changes"
```

Otherwise nothing to commit.

---

## Task 7: Rollout to the live config + manual verification

> **Requires user confirmation.** This modifies the live `~/.agent-voice/config.json` and restarts the running daemon (the macOS app's embedded daemon). `defaultConfig` changes only affect newly-created configs, so the existing config must be patched explicitly. `setConfigValue` cannot add a missing key or set an array, so we patch the JSON directly.

**Files:** `~/.agent-voice/config.json` (live user data, not in the repo)

- [ ] **Step 1: Back up the live config**

```bash
cp ~/.agent-voice/config.json ~/.agent-voice/config.json.bak
```

- [ ] **Step 2: Patch the three summarizer fields**

```bash
bun -e 'const fs=require("fs");const p=process.env.HOME+"/.agent-voice/config.json";const c=JSON.parse(fs.readFileSync(p,"utf8"));c.summarizer.priority=["pi-fast","heuristic"];c.summarizer.piModel="openai-codex/gpt-5.5";c.summarizer.thinking="off";fs.writeFileSync(p,JSON.stringify(c,null,2)+"\n");console.log("patched",c.summarizer.priority,c.summarizer.piModel,c.summarizer.thinking)'
```

Expected output: `patched [ "pi-fast", "heuristic" ] openai-codex/gpt-5.5 off`

- [ ] **Step 3: Restart the daemon**

Restart so it reloads config and pre-warms Kokoro. Either restart from the macOS app, or:

```bash
agent-voice stop && agent-voice start
```

Run: `agent-voice status`
Expected: `running pid=<n>` with queue counts.

- [ ] **Step 4: Verify latency and correctness empirically**

Finish a turn in a real `pi` session (so the extension enqueues), listen for the spoken summary (~6–7s), then:

```bash
sqlite3 -readonly ~/.agent-voice/queue.db "SELECT summarizer_used, status, round((julianday(finished_at)-julianday(claimed_at))*86400,2) AS proc_s, round((julianday(claimed_at)-julianday(enqueued_at))*86400,2) AS wait_s FROM jobs ORDER BY created_at DESC LIMIT 3;"
```

Expected: most recent row has `summarizer_used=pi-fast`, `status=done`, and **`proc_s` is now non-zero** (~6–7s, the real summarize+speak time) — confirming both the pi switch and the timestamp fix. `wait_s` should be small (≤~0.3s) for an idle daemon.

- [ ] **Step 5: Confirm a Kokoro failure no longer stalls the queue (optional but recommended)**

Temporarily point Kokoro at a bad python to force "exited before ready", enqueue a test job, and confirm it goes `failed` quickly instead of stalling ~90s:

```bash
agent-voice test "Latency rollout smoke test." ; echo "exit: $?"
```

Then restore the real config if you changed it: `cp ~/.agent-voice/config.json.bak ~/.agent-voice/config.json` and restart. (Skip this step if you don't want to perturb the live setup.)

---

## Self-review

**Spec coverage:**
- §3.1 pi primary, thinking off, drop `-`/wrong provider, priority `["pi-fast","heuristic"]` → Tasks 1, 2.
- §3.2 ANSI/escape stripping → Task 3.
- §3.3 `summarizer.thinking` config (default "off") + default changes → Task 1.
- §3.4 pre-warm Kokoro + non-fatal TTS → Tasks 5 (pre-warm) and 4 (terminal TTS failure).
- §3.5 lower idle poll floor → Task 5.
- §3.6 fresh-timestamp fix → Task 4.
- §6 rollout/migration → Task 7.
- §7 testing (unit + manual + proc_s check) → Tasks 1–6 (unit) and 7 (manual).
- Out of scope (codex handler untouched, burst pipelining, agent wiring) → respected; `codexModel` and codex/opencode branches and their tests are not modified.

**Placeholder scan:** none — every code/command step shows concrete content.

**Type consistency:** `SummarizerThinking` (config.ts) is referenced only via `config.summarizer.thinking` in summarizers.ts. `ProcessorDeps.prewarm?` (processor.ts) is provided in cli.ts and called in daemon.ts. `processNextJob(..., now: () => Date)` matches the daemon call sites (`deps.now ?? (() => new Date())`) and the test clock helper. `prewarm`/`summarize`/`speak` names are consistent across processor.ts, cli.ts, daemon.ts, and tests.
