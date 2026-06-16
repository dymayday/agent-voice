# Fast Mode Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global Pi `/fast` command and `--fast` flag that applies OpenAI/Codex priority service tier without installing a package.

**Architecture:** A single global TypeScript extension in `~/.pi/agent/extensions/fast-mode.ts` stores per-session enabled state, updates footer status, and patches `before_provider_request` payloads for OpenAI provider names only. A Bun test in this repo imports the extension, mocks the Pi extension API, invokes the command handler, and asserts payload patching behavior.

**Tech Stack:** Pi TypeScript extension API, `before_provider_request`, `registerCommand`, `registerFlag`, Bun test runner.

---

### Task 1: Test the extension behavior

**Files:**
- Create: `tests/fast-mode-extension.test.mjs`

- [ ] **Step 1: Write failing test**

Test that the extension registers `/fast` and `--fast`, starts disabled, enables via `/fast on`, patches only `openai`/`openai-codex` payloads with `service_tier: "priority"`, and leaves other providers unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/fast-mode-extension.test.mjs`
Expected: FAIL because `~/.pi/agent/extensions/fast-mode.ts` does not exist yet.

### Task 2: Implement the global extension

**Files:**
- Create: `/Users/meidhy/.pi/agent/extensions/fast-mode.ts`

- [ ] **Step 1: Write minimal implementation**

Register `--fast`, `/fast`, `session_start`, and `before_provider_request` handlers. Use in-memory state and update footer status as `⚡ FAST` while enabled.

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test tests/fast-mode-extension.test.mjs`
Expected: PASS.

- [ ] **Step 3: Smoke-check Pi sees the extension**

Run: `pi --no-extensions -e /Users/meidhy/.pi/agent/extensions/fast-mode.ts --help | rg -- "--fast"`
Expected: `--fast` appears or Pi exits successfully with the extension loadable.
