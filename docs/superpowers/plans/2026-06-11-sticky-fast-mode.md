# Sticky Fast Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pi Fast Mode persist across new sessions after `/fast on`, `/fast off`, or `/fast` toggle.

**Architecture:** Extend the single global extension with small JSON state-file helpers that read/write `~/.pi/agent/extensions/fast-mode-state.json`. Keep state in memory for the active session, but initialize it lazily from `--fast` or the saved file after Pi applies extension flags.

**Tech Stack:** Pi TypeScript extension API, Node `fs`/`path`/`os`, Bun test runner.

---

### Task 1: Add sticky-state regression tests

**Files:**
- Modify: `tests/fast-mode-extension.test.mjs`

- [ ] **Step 1: Write failing tests**

Add isolated temp `$HOME` tests proving:
- `/fast on` writes `{ "enabled": true }`
- a new extension instance starts enabled from that file
- `/fast off` writes `{ "enabled": false }`
- `--fast` forces enabled and writes sticky true

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/fast-mode-extension.test.mjs`
Expected: FAIL because the extension does not yet persist state.

### Task 2: Implement sticky state in extension

**Files:**
- Modify: `/Users/meidhy/.pi/agent/extensions/fast-mode.ts`

- [ ] **Step 1: Add state helpers**

Use `homedir()`, `join()`, `mkdirSync()`, `readFileSync()`, and `writeFileSync()` to manage `~/.pi/agent/extensions/fast-mode-state.json`.

- [ ] **Step 2: Initialize from flag or state file**

On first real use after Pi applies flags: if `pi.getFlag("fast") === true`, set enabled true and save it; otherwise read the saved state.

- [ ] **Step 3: Persist command changes**

When `/fast`, `/fast on`, or `/fast off` changes state, write the new value to disk.

- [ ] **Step 4: Verify**

Run: `bun test tests/fast-mode-extension.test.mjs`
Expected: PASS.
