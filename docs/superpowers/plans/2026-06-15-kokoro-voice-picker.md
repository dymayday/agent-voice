# Kokoro Voice Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an editable Kokoro voice picker to the macOS app that reads and saves `tts.voice` through the existing CLI config.

**Architecture:** Extend the Swift CLI bridge to decode `agent-voice config get` and run `config set tts.voice`. AppModel owns a `draftVoice` field and save action. Dashboard and Setup Kokoro sections render a preset picker plus editable text field.

**Tech Stack:** SwiftUI, AgentVoiceCore Swift CLI bridge, existing Bun/TypeScript config command, XCTest.

---

## Tasks

### Task 1: Swift config bridge

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceConfig.swift`
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AgentVoiceCLI.swift`
- Test: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AgentVoiceCLITests.swift`

- [ ] Write failing tests for `cli.config()` decoding `tts.voice` and `cli.setVoice(_:)` calling `config set tts.voice`.
- [ ] Add minimal full-config structs for `tts.voice`.
- [ ] Add CLI methods.
- [ ] Run `swift test --package-path macos/AgentVoiceApp --filter AgentVoiceCLITests`.

### Task 2: AppModel draft voice and save action

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceCore/AppModel.swift`
- Test: `macos/AgentVoiceApp/Tests/AgentVoiceCoreTests/AppModelTests.swift`

- [ ] Update AppModel tests so refresh loads config.
- [ ] Add tests for draft voice population, save voice trimming, and empty voice rejection.
- [ ] Add `config`, `draftVoice`, presets, and `saveVoice()`.
- [ ] Run `swift test --package-path macos/AgentVoiceApp --filter AppModelTests`.

### Task 3: SwiftUI voice controls

**Files:**
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/DashboardView.swift`
- Modify: `macos/AgentVoiceApp/Sources/AgentVoiceApp/SetupAssistantView.swift`

- [ ] Add current voice, preset picker, editable text field, and Save Voice button to Kokoro sections.
- [ ] Keep Run Voice Test button.
- [ ] Run `swift build --package-path macos/AgentVoiceApp`.

### Task 4: Documentation and verification

**Files:**
- Modify: `README.md`

- [ ] Document app voice picker and CLI voice config command.
- [ ] Run `bun test`, `bun run typecheck`, `swift test --package-path macos/AgentVoiceApp`, `swift build --package-path macos/AgentVoiceApp`.
- [ ] Rebuild app bundle with `bash scripts/build-macos-app.sh`.
