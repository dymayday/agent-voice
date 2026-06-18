# Code Quality Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the maintainability findings from the thermo-nuclear audit while preserving runtime behavior.

**Architecture:** Extract overloaded responsibilities into focused modules without changing CLI or app contracts. Make queue speech lifecycle explicit enough to stop using `summary` as a proxy for spoken state. Reduce Swift source-shape test coupling so UI decomposition is less painful.

**Tech Stack:** Bun/TypeScript, bun:sqlite, Swift/SwiftUI, XCTest.

---

### Task 1: Make speech lifecycle explicit

**Files:**
- Modify: `src/db.ts`
- Modify: `src/store.ts`
- Modify: `src/processor.ts`
- Test: `tests/processor.test.ts` / `tests/daemon.test.ts`

- [x] Add failing test showing a job with a summary but no spoken marker is spoken instead of silently marked done.
- [x] Add schema column and store helpers for explicit `spoken_at` state.
- [x] Update processor recovery branch to check `spokenAt`, not `summary`.
- [x] Verify focused processor/daemon tests pass.

### Task 2: Share Kokoro JSONL protocol between runtime and setup

**Files:**
- Create: `src/kokoro/protocol.ts`
- Modify: `src/tts.ts`
- Modify: `src/kokoro-setup.ts`
- Test: `tests/tts.test.ts`, `tests/kokoro-setup.test.ts`

- [x] Add focused tests for shared protocol parsing / setup smoke behavior.
- [x] Move JSONL parsing, line reading, deadline handling, and audio validation into `src/kokoro/protocol.ts`.
- [x] Use that module from both runtime TTS and setup smoke test.
- [x] Verify focused tests pass.

### Task 3: Decompose Kokoro setup and tests below 1k lines

**Files:**
- Create: `src/kokoro/commands.ts`
- Create: `src/kokoro/managed-paths.ts`
- Create: `src/kokoro/setup-lock.ts`
- Create: `src/kokoro/uv-installer.ts`
- Modify: `src/kokoro-setup.ts`
- Split: `tests/kokoro-setup.test.ts` into setup/resource/CLI/smoke test files

- [x] Move path safety, lock, command runner, and managed uv installation to focused modules.
- [x] Keep public exports stable from `src/kokoro-setup.ts`.
- [x] Split tests without changing assertions.
- [x] Verify line counts are below 1k.

### Task 4: Decompose Swift AppModel and reduce source-shape test brittleness

**Files:**
- Create: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceDiagnosticSnapshot.swift`
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift`
- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/DashboardViewSourceTests.swift`
- Modify: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/SourceTestHelpers.swift`

- [x] Extract diagnostic snapshot DTOs out of `AppModel.swift`.
- [x] Reduce `AppModel.swift` below the 1k-line god-object threshold.
- [x] Replace dashboard private-property/order source-slicing tests with broader app-source feature contracts.
- [x] Verify Swift tests and line counts.

### Task 5: Final verification and PR

- [x] Run `bun run typecheck`.
- [x] Run `bun test`.
- [x] Run `swift test --package-path macos/AgentVoiceApp`.
- [x] Run LSP/lens diagnostics.
- [ ] Commit, push branch, and open PR.
