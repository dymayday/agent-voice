# agent-voice latency reduction — design

**Date:** 2026-06-16
**Status:** Design (pending implementation plan)
**Goal:** Shorten the time between an agent finishing a turn and the spoken summary being heard, while keeping a real LLM-crafted one-liner (the user's chosen quality/speed tradeoff).

---

## 1. Problem

Today the perceived time-to-voice is far too long. An empirical per-stage audit (real `time` probes on `codex`, `pi`, Kokoro, `afplay`, plus the live `~/.agent-voice/queue.db`) found:

| Stage | Typical | Worst | Share of typical |
|---|---|---|---|
| 1. hook → enqueue (Bun cold start + INSERT) | ~54 ms | ~90 ms | ~0.4% |
| 2. enqueue → claim (queue wait) | ~3 s | ~117 s | ~22% |
| 3. **summarizer LLM call** | **~9.5 s** | ~24 s | **~70%** |
| 4. TTS synth + afplay start (excludes spoken duration) | ~1.1 s | ~8.3 s | ~8% |

Root causes that matter:

1. **The LLM summarizer is silently broken and on the critical path.** The configured model `gpt-5.3-codex` is incompatible with the ChatGPT-account auth `codex` uses — it returns HTTP 400 after ~7.7 s **every turn**, then the next summarizer (`pi-fast`) also fails (wrong provider prefix `openai/…` → over-quota key, plus a trailing `-` arg pi rejects), so the chain falls through to the instant local heuristic. **The user only ever hears the heuristic, after ~8 s of dead air, and has never heard an LLM summary.**
2. **A working LLM call is the dominant cost.** `codex exec` with a supported model is ~9–10 s (remote inference). `pi --model openai-codex/gpt-5.5 --thinking off` through the same subscription is **~5.8 s** and returns a clean one-liner — measured twice at 5.82 s / 5.84 s.
3. **Fallback chain stacks.** Per-summarizer `timeoutSeconds=12` means a codex hang + a pi hang = up to 24 s of dead air before the instant heuristic runs.
4. **Worst case ~117 s is a serial retry stall:** repeated `Kokoro exited before ready` × `retryBackoffSeconds=30` × `maxAttempts=3` = 90 s of backoff blocking the single-worker queue.
5. **A timestamp bug hides all processing time.** `runDaemonLoop` captures `now` once per iteration; `claimNextDue` stamps `claimed_at=$now` and `markDone` stamps `finished_at=$now` with that same frozen value, so `claimed_at == finished_at` to the millisecond. `proc_s` is structurally ~0 and the real codex/TTS time is mis-attributed into the *next* job's wait window.
6. **Stage 4 is otherwise healthy:** `KokoroClient` is persistent (model loads once per daemon, ~6.7 s, then warm synth ~0.3–0.65 s). The one-time load currently lands on the first user-visible summary; afplay adds a fixed ~0.8 s startup per utterance.

Not addressed here (noted): only the **pi** agent is actually wired to agent-voice (claude's Stop hook is peon-ping; codex/opencode wrappers hit an unhandled command). That is a correctness/coverage gap, not latency — see Out of Scope.

## 2. Goal & non-goals

**Goal:** Make the LLM voice path fast *for real* and reliable:
- Primary summarizer = **pi** through the codex subscription, thinking off (~5.8 s, proven working).
- No stacking, no multi-minute stalls, no first-utterance model-load penalty.
- Make the latency measurable so the win is verifiable.

**Realistic target time-to-voice:** ~0.15 s claim + ~5.8 s pi + ~0.5 s synth + ~0.8 s afplay start ≈ **6–7 s, reliably, with a real LLM sentence.** Worst case bounded to seconds, not minutes.

**Non-goals (this is the accepted floor):** The codex-subscription LLM is inherently several seconds; we are not chasing sub-2 s here. Sub-2 s would require heuristic-first or a different transport, both explicitly rejected for this path.

## 3. Design

### 3.1 Summarizer: pi primary, thinking off

**Invocation (replaces the broken pi-fast args):**
```
pi --model openai-codex/gpt-5.5 --thinking <thinking> --no-tools -p "<prompt>"
```
- Provider prefix **`openai-codex/`** (routes through the working codex subscription) instead of `openai/` (separate over-quota OpenAI key). This is the core bug fix the user identified.
- Prompt passed via **`-p "<prompt>"`** as an argument, not stdin + trailing `-` (pi 0.79.4 rejects the bare `-` with "Unknown option: -").
- `--thinking <thinking>` driven by new config (`summarizer.thinking`, default `"off"`). "off" matches the proven command and is correct for a one-sentence rewrite that needs no reasoning.
- `--no-tools` keeps pi from doing anything but answer (proven in measurement).
- `AGENT_VOICE_DISABLE=1` stays in the summarizer env (already set in `baseRequest`) to prevent the pi extension from re-enqueuing recursively.
- **To verify during implementation:** whether `--no-session` is compatible with `-p` (the proven command omitted it); whether adding `--fast` (codex fast service tier) lowers latency further. Default to matching the proven command (no `--fast`, verify `--no-session`).

**Priority chain default:** `["pi-fast", "heuristic"]` — pi first (~5.8 s), instant local heuristic if pi fails. Two stages → nothing can stack.

The `codex-fast` and `opencode` request builders in `summarizers.ts` are retained (so an advanced config can still select them) but removed from the default priority. They can be deleted in a later cleanup.

### 3.2 Output cleaning: strip terminal escape sequences

pi `-p` mode emits TUI teardown escape sequences after the answer (e.g. `[?2026h[r[?1006l…`). The ESC byte is in the current control-char strip, but the residual `[?2026h[r…` is printable and can leak into speech.

Add an ANSI/CSI escape pattern applied **before** the control-char strip in `cleanForSpeech` so the whole sequence (ESC + bracket payload) is removed as a unit:
```
ANSI_ESCAPE_PATTERN = /\[[0-9;?]*[ -/]*[@-~]/g   (plus other ESC-introduced forms as needed)
```

### 3.3 Config additions

`AgentVoiceConfig.summarizer` gains:
- **`thinking: "off" | "low" | "medium" | "high"`**, default `"off"` — mapped directly to pi's `--thinking`. (If a retained codex-fast path is ever used, translate `off → minimal` for `model_reasoning_effort`.)

Default changes in `defaultConfig`:
- `summarizer.priority`: `["codex-fast","pi-fast","opencode","heuristic"]` → `["pi-fast","heuristic"]`
- `summarizer.piModel`: `"openai/gpt-5.3-codex"` → `"openai-codex/gpt-5.5"`
- `summarizer.thinking`: `"off"` (new)

Verify pi's exact accepted `--thinking` values during implementation and constrain the type accordingly.

### 3.4 Reliability: pre-warm Kokoro + make TTS failure non-fatal

- **Pre-warm:** add an optional `prewarm?(): Promise<void>` to `ProcessorDeps`; `defaultProcessorDeps` sets it to `() => kokoro.ensureReady()`. `runDaemonLoop` calls `await deps.prewarm?.()` (best-effort, errors swallowed/logged) **before** entering the loop, so the ~6.7 s model load happens during idle daemon init, not on the first user-visible summary.
- **Non-fatal TTS:** `KokoroClient.speak()` already does one internal restart+retry. If `speak()` still throws, treat it as **terminal for that job** (mark failed/logged) instead of feeding the daemon-level `scheduleRetry` backoff (3 × 30 s = 90 s). The summary is already computed; a persistent TTS failure must not stall the queue. Summarizer failures keep their existing behavior (summarize already falls back to the heuristic internally, so it rarely throws).

### 3.5 Lower the idle claim floor

`runDaemonLoop` idle poll default `pollIntervalMs` 1000 ms → **~200 ms**, so an idle daemon claims a fresh job in ≤200 ms instead of up to 1 s. The claim SQL is ~17 µs, so the extra polling is negligible CPU. (Kept as a simple default change; promoting it to a config knob is optional.)

### 3.6 Observability: fix the frozen-timestamp bug

Capture a fresh `new Date()` immediately before `markDone` (and `markFailed`) so `finished_at` reflects true completion, making `proc_s = finished_at − claimed_at` a real measure of summarize + speak time. Optionally add a `spoke_at` column for finer metrics (nice-to-have, not required). This is how we verify every other change actually landed.

## 4. Data flow (after changes)

```
pi turn_end
  → ~/.pi/agent/extensions/agent-voice.ts (detached, unref → ~0 perceived)
  → bin/agent-voice enqueue --format text --agent pi   (INSERT pending, ~54 ms)
  → daemon (pre-warmed Kokoro) claims within ≤200 ms
  → summarize(): pi --model openai-codex/gpt-5.5 --thinking off --no-tools -p  (~5.8 s)
        ↳ on failure: instant heuristic
  → speak(): warm Kokoro synth (~0.5 s) → afplay (serial, one voice at a time)
        ↳ on persistent failure: terminal for job, queue keeps moving
  → markDone(fresh Date)   → proc_s now reflects real time
```

## 5. Affected code

- `src/config.ts` — add `summarizer.thinking`; change `priority`, `piModel` defaults; type for thinking values.
- `src/summarizers.ts` — rewrite the `pi-fast` branch in `requestFor` (provider prefix, `-p` arg, `--thinking`, drop `-`); thread `thinking` through; switch pi prompt from stdin to `-p` arg; add ANSI escape stripping to `cleanForSpeech`.
- `src/processor.ts` — fresh timestamp at `markDone`/`markFailed`; treat `speak()` failure as terminal (no backoff retry).
- `src/daemon.ts` — `pollIntervalMs` default → ~200 ms; call `deps.prewarm?.()` before the loop.
- `src/cli.ts` — `defaultProcessorDeps` provides `prewarm` and keeps the persistent `KokoroClient`.
- `src/store.ts` — `markDone`/`markFailed` accept the fresh time (already parameterized); optional `spoke_at`.
- Tests: `tests/summarizers.test.ts`, `tests/summarizer-mode.test.ts`, `tests/daemon-cli.test.ts`, `tests/tts.test.ts`, `tests/pause-resume.test.ts` updated for new defaults/args and new behavior.

The macOS app (`macos/AgentVoiceApp`) runs the same `src` daemon and reads the same `config.json`; changes propagate when its daemon restarts. Surfacing `summarizer.thinking` in the app UI is out of scope (set it via `agent-voice config set summarizer.thinking <v>`).

## 6. Rollout / migration

`defaultConfig` changes only apply to *newly created* configs. The live `~/.agent-voice/config.json` must be updated explicitly:
- `summarizer.thinking` (scalar) can be set with `agent-voice config set summarizer.thinking off`.
- `summarizer.priority` (array) and `summarizer.piModel` must be edited in the file directly, since `setConfigValue` rejects array updates.
- Restart the daemon (the macOS app's embedded daemon, pid in `~/.agent-voice/run/daemon.pid`) so it reloads config and pre-warms Kokoro.

## 7. Testing

- **Unit:** pi-fast request shape (model `openai-codex/gpt-5.5`, `-p` arg, `--thinking` from config, no `-`); `thinking` default/override; `cleanForSpeech` removes `[?2026h[r…` style sequences; processor marks speak failure terminal and stamps a fresh `finished_at`; config defaults.
- **Manual verification:** start the daemon, finish a pi turn, confirm time-to-voice ~6–7 s; confirm `queue.db` `proc_s` is now non-zero and ≈ the real summarize+speak time; force a Kokoro failure (e.g. bad python path) and confirm the queue does **not** stall ~90 s; confirm no escape-sequence garbage is ever spoken.
- **Latency probe to settle open flags:** time pi with/without `--fast` and with/without `--no-session` to lock the final invocation.

## 8. Out of scope (future work)

- **Burst pipelining:** summarize the next turn while the current one is still speaking (keeps playback serial / one voice, but overlaps the summarize stage). Larger restructure of the daemon loop into stages.
- **Warm persistent summarizer process** to amortize CLI startup (~1.8 s) — pi at ~5.8 s is good enough; uncertain feasibility.
- **Persistent audio player** to remove afplay's ~0.8 s startup.
- **Wiring claude / codex / opencode** agents to actually call agent-voice (only pi is live today).
- **Faster transport** (direct fast-model API instead of the codex CLI) — explicitly rejected; this path keeps the codex subscription.
