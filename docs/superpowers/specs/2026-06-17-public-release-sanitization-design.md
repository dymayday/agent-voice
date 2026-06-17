# Public Release Sanitization Design

## Goal

Prepare Agent Voice to be safely open sourced by publishing a clean public Git history while keeping the existing private development history out of public GitHub refs.

## Decisions

- Public repository identity: `dymayday/agent-voice`.
- Package name: `agent-voice`.
- macOS bundle identifier: `com.dymayday.agentvoice`.
- App display name: `Agent Voice`.
- CLI command and state directory stay stable: `agent-voice`, `~/.agent-voice`, and `AGENT_VOICE_HOME`.
- License: MIT.
- npm publishing: blocked for now with `"private": true`; the GitHub repo is public source, not an npm package release yet.
- Summarizer defaults: keep model-backed summarizers as the default; make the privacy/network behavior prominent in documentation and keep local-only heuristic mode documented.
- Branch strategy: because `master` is currently the default branch, use a temporary clean orphan branch as a staging/default branch only long enough to delete/replace old remote refs, then restore clean `master` as the final public default branch.

## Scope

### Public identity rename

The rename is broad enough that public-facing and packaged identifiers no longer expose the old project name:

- Rename GitHub references from `dymayday/agent-voice-sum-up-hook` to `dymayday/agent-voice`.
- Rename package metadata from `claude-sum-up-hook` to `agent-voice`.
- Rename the Swift package path from `macos/AgentVoiceApp` to `macos/AgentVoice`.
- Rename the Swift executable target from `AgentVoiceApp` to `AgentVoice`.
- Update `CFBundleExecutable` to `AgentVoice` and `CFBundleIdentifier` to `com.dymayday.agentvoice`.

The app display name remains `Agent Voice`, and the CLI binary remains `agent-voice` to avoid user-facing command churn.

### Sanitization

Remove or neutralize information that should not be part of a public repo:

- Hardcoded maintainer-local paths such as `/Users/meidhy/...`.
- Internal planning artifacts under `docs/superpowers/**` and `.superpowers/`.
- Nonessential visual generation artifacts under `docs/visual/**` and `generated-images/**`.
- Scanner-triggering fake token strings in tests and docs.
- Private Git history on remote refs before the repository visibility changes.

### Public OSS hygiene

Add minimal public project files:

- `LICENSE` with MIT terms.
- `SECURITY.md` with vulnerability reporting guidance.
- `CONTRIBUTING.md` with lightweight development instructions.
- Public-ready `package.json` metadata while preserving `"private": true`.

### Privacy documentation

The README must state plainly that:

- Agent Voice stores completed agent text locally in SQLite under `AGENT_VOICE_HOME`.
- The default summarizer chain can invoke configured `pi` and `codex` tools, which may contact their model providers.
- Users who want local-only/no-network summarization should run `./bin/agent-voice summarizer mode heuristic`.

## Verification

The sanitized tree is acceptable only when all of these pass:

- No current-tree matches for personal paths, maintainer email, old package/repo names, old macOS paths, or scanner-triggering fake secrets.
- No tracked `.env`, private keys, SQLite DBs, logs, or audio artifacts.
- `bun test` passes.
- `bun run typecheck` passes.
- `bun audit --json` reports no advisories.
- `swift test --package-path macos/AgentVoice` passes.
- `swift build --package-path macos/AgentVoice` passes.
- Remote refs are verified private before public visibility changes, then only the clean `master` branch remains before making the repo public.

## Non-goals

- Do not change the default summarizer priority to heuristic-only.
- Do not publish to npm in this pass.
- Do not remove the local SQLite queue architecture.
- Do not change the CLI command name or app display name.
