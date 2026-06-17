# Public Release Sanitization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare Agent Voice for a public GitHub release as `dymayday/agent-voice` with MIT licensing, sanitized public files, full public identifier rename, and clean public Git history.

**Architecture:** Make all content and identity fixes on a private working branch, verify the sanitized tree, then create a clean orphan commit for publication. Because `master` is currently the GitHub default branch, use a temporary `public-main` remote default only while replacing old remote refs, then restore a clean `master` as the final public default branch before making the repository public.

**Tech Stack:** Bun/TypeScript CLI, SwiftPM macOS app, SQLite queue, Bash packaging scripts, Git/GitHub.

---

## Critical safety rules

- Do **not** make the GitHub repository public until the remote ref verification step shows only clean public refs.
- Do **not** push or expose the current private `master` history after starting the clean-public-history phase.
- Keep `"private": true` in `package.json`; this pass is GitHub OSS readiness, not npm publication.
- Keep model-backed summarizers as default; document privacy behavior instead of changing the default to heuristic-only.
- Use `public-main` only as a temporary staging/default branch. Final public default branch should be clean `master`.
- Get explicit human confirmation before deleting remote branches/tags or changing GitHub visibility.

---

## File map

### Create

- `LICENSE` — MIT license for public source.
- `SECURITY.md` — vulnerability reporting and supported-version policy.
- `CONTRIBUTING.md` — lightweight contributor setup and verification commands.

### Modify

- `.gitignore` — replace old Swift build path and ignore `.superpowers/`.
- `package.json` — public metadata, package name `agent-voice`, keep `private: true`.
- `bun.lock` — root workspace package name.
- `README.md` — public repo identity, renamed macOS path, privacy warning, local-only mode instructions.
- `src/config.ts` — neutral Kokoro script placeholder, no maintainer-local path.
- `fixtures/event.sample.json` — neutral sample `cwd`.
- Tests that currently use maintainer paths or scanner-triggering fake secret strings.
- `scripts/build-macos-app.sh` — renamed Swift package path and executable name.
- `scripts/generate-macos-icon.sh` — renamed Swift package resource path.
- `macos/AgentVoice/Package.swift` — after `git mv`, package/executable target rename.
- `macos/AgentVoice/Resources/Info.plist` — executable and bundle identifier.
- Swift source tests that load files from `Sources/AgentVoiceApp` or `AgentVoiceApp.swift`.

### Rename / remove

- Rename `macos/AgentVoiceApp/` → `macos/AgentVoice/`.
- Rename `macos/AgentVoice/Sources/AgentVoiceApp/` → `macos/AgentVoice/Sources/AgentVoice/`.
- Rename `macos/AgentVoice/Sources/AgentVoice/AgentVoiceApp.swift` → `macos/AgentVoice/Sources/AgentVoice/AgentVoice.swift`.
- Remove from the public tree:
  - `docs/superpowers/`
  - `docs/visual/`
  - `generated-images/`

Keep:

- `assets/app-icon/agent-voice-local-voice-orb.png`
- `macos/AgentVoice/Resources/AppIcon.icns`

---

## Task 0: Prepare a private execution branch

**Files:** none

- [ ] **Step 1: Confirm current state**

Run:

```bash
git status --short --branch
git remote -v
git branch -vv
```

Expected:

- Current branch is private `master` or a private working branch.
- Only known untracked local artifact should be `.superpowers/`.
- Remote is still private GitHub repo `dymayday/agent-voice-sum-up-hook`.

- [ ] **Step 2: Create implementation branch**

Run:

```bash
git switch -c chore/public-release-sanitization
```

Expected: new branch created from current private branch.

- [ ] **Step 3: Keep `.superpowers/` untracked**

Run:

```bash
git status --short
```

Expected: `.superpowers/` may appear as untracked for now; do not add it.

---

## Task 1: Add public OSS metadata and ignore rules

**Files:**

- Create: `LICENSE`
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Verify metadata is currently incomplete**

Run:

```bash
test -f LICENSE; echo "LICENSE exit=$?"
node -e 'const p=require("./package.json"); console.log({name:p.name, private:p.private, license:p.license, repository:p.repository})'
git check-ignore -v .superpowers/example || true
```

Expected:

- `LICENSE exit=1` before adding the license.
- Package name is `claude-sum-up-hook` before the fix.
- `.superpowers/example` is not ignored before the fix.

- [ ] **Step 2: Create MIT license**

Create `LICENSE`:

```text
MIT License

Copyright (c) 2026 dymayday

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Create security policy**

Create `SECURITY.md`:

```markdown
# Security Policy

## Supported Versions

Agent Voice is pre-1.0 software. Security fixes are made on the default branch.

## Reporting a Vulnerability

Please do not open a public issue for suspected vulnerabilities that expose user data, credentials, or local machine details.

Report privately through GitHub's private vulnerability reporting for `dymayday/agent-voice` when available. If private reporting is unavailable, open a minimal issue that asks for a private contact path without including exploit details.

## Privacy-Sensitive Areas

Agent Voice processes completed coding-agent text. That text may contain secrets or personal data from local projects. Treat queue contents, generated audio, and diagnostic output as sensitive local data.
```

- [ ] **Step 4: Create contributor guide**

Create `CONTRIBUTING.md`:

````markdown
# Contributing

Thanks for considering a contribution to Agent Voice.

## Development Setup

```bash
bun install
bun test
bun run typecheck
swift test --package-path macos/AgentVoice
swift build --package-path macos/AgentVoice
```

## Privacy Expectations

Do not commit local queue databases, audio output, logs, `.env` files, private keys, or real coding-agent transcripts. Use fixtures with synthetic text only.

## Pull Requests

Please include:

- a short description of the change,
- tests or a reason tests are not applicable,
- any privacy or data-flow implications.
````

- [ ] **Step 5: Update `.gitignore`**

Modify `.gitignore` to:

```gitignore
node_modules/
.agent-voice-test-*
macos/AgentVoice/.build/
dist/
.worktrees/
.superpowers/
*.log
*.sqlite
*.db
*.wav
.env
.env.*
```

Keep the existing ignore patterns but update the Swift package path and add `.superpowers/` plus common local sensitive artifacts.

- [ ] **Step 6: Update `package.json` metadata**

Modify `package.json` to include these fields and keep `private: true`:

```json
{
  "name": "agent-voice",
  "version": "0.1.0",
  "description": "Local CLI, daemon, and macOS menu bar app that speaks short summaries of completed coding-agent turns.",
  "type": "module",
  "private": true,
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/dymayday/agent-voice.git"
  },
  "bugs": {
    "url": "https://github.com/dymayday/agent-voice/issues"
  },
  "homepage": "https://github.com/dymayday/agent-voice#readme",
  "keywords": [
    "agent",
    "voice",
    "tts",
    "kokoro",
    "cli",
    "macos"
  ]
}
```

Preserve the existing `bin`, `scripts`, and `devDependencies` sections.

- [ ] **Step 7: Update `bun.lock` root workspace name**

Change the root workspace name from `claude-sum-up-hook` to `agent-voice`.

- [ ] **Step 8: Verify metadata**

Run:

```bash
node -e 'const p=require("./package.json"); if (p.name!=="agent-voice" || p.private!==true || p.license!=="MIT" || !p.repository?.url?.includes("dymayday/agent-voice")) process.exit(1); console.log("package metadata ok")'
git check-ignore -v .superpowers/example
git grep -n -I 'claude-sum-up-hook' -- package.json bun.lock || true
```

Expected:

- `package metadata ok`
- `.superpowers/example` ignored by `.gitignore`
- no `claude-sum-up-hook` matches in `package.json` or `bun.lock`

- [ ] **Step 9: Commit**

Run:

```bash
git add LICENSE SECURITY.md CONTRIBUTING.md .gitignore package.json bun.lock
git commit -m "chore: add public project metadata"
```

---

## Task 2: Rename macOS package and executable identifiers

**Files:**

- Rename: `macos/AgentVoiceApp/` → `macos/AgentVoice/`
- Rename: `macos/AgentVoice/Sources/AgentVoiceApp/` → `macos/AgentVoice/Sources/AgentVoice/`
- Rename: `macos/AgentVoice/Sources/AgentVoice/AgentVoiceApp.swift` → `macos/AgentVoice/Sources/AgentVoice/AgentVoice.swift`
- Modify: `macos/AgentVoice/Package.swift`
- Modify: `macos/AgentVoice/Resources/Info.plist`
- Modify: `scripts/build-macos-app.sh`
- Modify: `scripts/generate-macos-icon.sh`
- Modify: Swift source tests under `macos/AgentVoice/Tests/AgentVoiceCoreTests/`
- Modify: `README.md`

- [ ] **Step 1: Write failing rename checks**

Run:

```bash
test -d macos/AgentVoice; echo "macos/AgentVoice exit=$?"
rg -n 'macos/AgentVoiceApp|AgentVoiceApp|local\.agentvoice\.app|Sources/AgentVoiceApp' .gitignore README.md scripts macos/AgentVoiceApp || true
```

Expected before fix:

- `macos/AgentVoice exit=1`
- matches for old paths/identifiers.

- [ ] **Step 2: Rename directories and app source file**

Run:

```bash
git mv macos/AgentVoiceApp macos/AgentVoice
git mv macos/AgentVoice/Sources/AgentVoiceApp macos/AgentVoice/Sources/AgentVoice
git mv macos/AgentVoice/Sources/AgentVoice/AgentVoiceApp.swift macos/AgentVoice/Sources/AgentVoice/AgentVoice.swift
```

- [ ] **Step 3: Update `Package.swift`**

Modify `macos/AgentVoice/Package.swift`:

```swift
let package = Package(
    name: "AgentVoice",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "AgentVoiceCore", targets: ["AgentVoiceCore"]),
        .executable(name: "AgentVoice", targets: ["AgentVoice"])
    ],
    targets: [
        .target(name: "AgentVoiceCore"),
        .executableTarget(name: "AgentVoice", dependencies: ["AgentVoiceCore"]),
        .testTarget(name: "AgentVoiceCoreTests", dependencies: ["AgentVoiceCore"])
    ]
)
```

- [ ] **Step 4: Update `Info.plist`**

Modify `macos/AgentVoice/Resources/Info.plist`:

```xml
<key>CFBundleExecutable</key>
<string>AgentVoice</string>
<key>CFBundleIdentifier</key>
<string>com.dymayday.agentvoice</string>
```

Keep `CFBundleName` and `CFBundleDisplayName` as `Agent Voice`.

- [ ] **Step 5: Update build scripts**

Modify `scripts/build-macos-app.sh`:

```bash
PACKAGE_DIR="$ROOT_DIR/macos/AgentVoice"
...
install -m 755 "$BIN_DIR/AgentVoice" "$MACOS_DIR/AgentVoice"
```

Modify `scripts/generate-macos-icon.sh`:

```bash
OUTPUT_DIR="$ROOT_DIR/macos/AgentVoice/Resources"
```

The app bundle path remains `dist/Agent Voice.app`.

- [ ] **Step 6: Update Swift source tests**

In tests under `macos/AgentVoice/Tests/AgentVoiceCoreTests/`:

- Replace file lookups for `AgentVoiceApp.swift` with `AgentVoice.swift`.
- Replace helper paths `Sources/AgentVoiceApp/` with `Sources/AgentVoice/`.
- Keep test class names unless changing them is required for clarity.

Concrete replacements:

```text
appSource("AgentVoiceApp.swift") -> appSource("AgentVoice.swift")
Sources/AgentVoiceApp/\(fileName) -> Sources/AgentVoice/\(fileName)
```

- [ ] **Step 7: Update README macOS paths**

Replace all `macos/AgentVoiceApp` occurrences with `macos/AgentVoice`.

Update bundle smoke-test paths if needed:

```bash
"dist/Agent Voice.app/Contents/Resources/agent-voice/bin/agent-voice" status --json
```

The CLI path inside the app bundle does not change.

- [ ] **Step 8: Verify Swift rename**

Run:

```bash
rg -n 'macos/AgentVoiceApp|local\.agentvoice\.app|Sources/AgentVoiceApp|AgentVoiceApp' .gitignore README.md scripts macos/AgentVoice || true
swift test --package-path macos/AgentVoice
swift build --package-path macos/AgentVoice
```

Expected:

- No old path or bundle identifier matches.
- `AgentVoiceApp` matches should be limited to legacy references only if deliberately kept in test class names; prefer zero matches in public files.
- Swift tests and build pass.

- [ ] **Step 9: Commit**

Run:

```bash
git add -A .gitignore README.md scripts macos
git commit -m "chore: rename macOS app identifiers"
```

`git add -A ... macos` is intentional: it stages both the removed old `macos/AgentVoiceApp` paths and the new `macos/AgentVoice` paths after the directory rename.

---

## Task 3: Sanitize personal paths and scanner-triggering fake secrets

**Files:**

- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`
- Modify: `fixtures/event.sample.json`
- Modify: `tests/daemon.test.ts`
- Modify: `tests/queue.test.ts`
- Modify: `tests/enqueue-cli.test.ts`
- Modify: `tests/summarizers.test.ts`
- Modify: any remaining README/docs/test files that match the verification grep

- [ ] **Step 1: Run failing leak scan**

Run:

```bash
git grep -n -I -E '/Users/meidhy|dymayday@gmail\.com|sk-secret|OPENAI_API_KEY=sk-|ghp_secret|plain-password|BEGIN PRIVATE KEY' -- . ':!bun.lock' || true
```

Expected before fix: matches in config, fixtures, tests, and private docs.

- [ ] **Step 2: Neutralize default Kokoro path**

Modify `src/config.ts`:

```ts
tts: {
  kokoroScript: "/path/to/kokoro_tts_service.py",
  python: "python3",
  voice: "af_heart",
  timeoutSeconds: 30,
},
```

Do not introduce maintainer-specific path discovery.

- [ ] **Step 3: Update config tests**

Modify `tests/config.test.ts` so the default-config test expects the neutral placeholder. Recommended assertion:

```ts
expect(defaultConfig.tts.kokoroScript).toBe("/path/to/kokoro_tts_service.py");
```

Keep the test asserting the path is absolute if desired, because the placeholder starts with `/`.

- [ ] **Step 4: Sanitize fixture cwd**

Modify `fixtures/event.sample.json`:

```json
"cwd": "/Users/example/example-project"
```

- [ ] **Step 5: Sanitize ignored private cwd tests**

In `tests/daemon.test.ts` and `tests/queue.test.ts`, replace:

```ts
"/Users/meidhy/private/project"
"/Users/meidhy/private/**"
```

with:

```ts
"/Users/example/private/project"
"/Users/example/private/**"
```

- [ ] **Step 6: Replace scanner-triggering fake secrets with safe placeholders**

Use placeholders that do not resemble real tokens:

```text
Bearer TOKEN_PLACEHOLDER
OPENAI_API_KEY_PLACEHOLDER
GITHUB_TOKEN_PLACEHOLDER
PASSWORD_PLACEHOLDER
API_KEY_PLACEHOLDER
```

Concrete replacements:

```text
Bearer sk-secret123        -> Bearer TOKEN_PLACEHOLDER
sk-key-only                -> API_KEY_PLACEHOLDER
OPENAI_API_KEY=sk-test456  -> OPENAI_API_KEY_PLACEHOLDER
ghp_secret789              -> GITHUB_TOKEN_PLACEHOLDER
plain-password             -> PASSWORD_PLACEHOLDER
sk-secret-xyz              -> TOKEN_PLACEHOLDER
```

Update assertions in `tests/enqueue-cli.test.ts`, `tests/summarizers.test.ts`, and `tests/daemon.test.ts` to match the new placeholders.

- [ ] **Step 7: Verify sanitization before private docs removal**

Run:

```bash
git grep -n -I -E '/Users/meidhy|dymayday@gmail\.com|sk-secret|OPENAI_API_KEY=sk-|ghp_secret|plain-password' -- src tests fixtures README.md package.json macos scripts .gitignore || true
bun test
bun run typecheck
```

Expected:

- No matches in public source/test/fixture files.
- Bun tests pass.
- Typecheck passes.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/config.ts tests fixtures README.md package.json macos scripts .gitignore
git commit -m "chore: sanitize public fixtures and defaults"
```

---

## Task 4: Remove internal planning and generated design artifacts from public tree

**Files:**

- Remove: `docs/superpowers/`
- Remove: `docs/visual/`
- Remove: `generated-images/`
- Modify: `README.md` if it references removed files

- [ ] **Step 1: Confirm artifacts exist**

Run:

```bash
git ls-files docs/superpowers docs/visual generated-images | sed -n '1,80p'
git ls-files docs/superpowers docs/visual generated-images | wc -l
```

Expected: tracked internal/generated artifacts listed.

- [ ] **Step 2: Remove internal/private planning docs**

Run:

```bash
git rm -r docs/superpowers
```

This removes this implementation plan from the public tree; keep the private branch/history as the archival copy.

- [ ] **Step 3: Remove nonessential visual design artifacts**

Run:

```bash
git rm -r docs/visual generated-images
```

Keep the final app/icon assets under `assets/` and `macos/AgentVoice/Resources/`.

- [ ] **Step 4: Verify no README references removed artifact paths**

Run:

```bash
rg -n 'docs/superpowers|docs/visual|generated-images|AgentVoiceApp' README.md . || true
```

Expected: no references to removed artifact paths or old macOS path.

- [ ] **Step 5: Commit**

Run:

```bash
git add README.md
git commit -m "chore: remove private planning artifacts"
```

The `git rm -r ...` commands in earlier steps already stage the removals. Only add `README.md` here if it changed during reference cleanup.

---

## Task 5: Strengthen README privacy and public release docs

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Check current privacy section**

Run:

```bash
rg -n 'Privacy and data flow|heuristic|codex|pi-fast|model providers|AGENT_VOICE_HOME' README.md
```

Expected: privacy section exists but should be made more prominent for public users.

- [ ] **Step 2: Add a prominent privacy notice near the top**

Add after the intro paragraph:

```markdown
> **Privacy note:** Agent Voice stores completed agent text locally in SQLite under `AGENT_VOICE_HOME`. By default it may summarize through configured `pi` or `codex` CLIs, and those tools may contact their model providers. For local-only/no-network summarization, run `./bin/agent-voice summarizer mode heuristic`.
```

- [ ] **Step 3: Keep model-backed defaults documented**

In the privacy section, make sure this is explicit:

```markdown
The default summarizer priority favors model-backed summaries through `pi` and `codex` when those tools are available. This gives better summaries, but it can send completed agent text to the model provider configured by those tools. If that is not acceptable for a project, switch to heuristic mode before enqueueing sensitive turns.
```

Do not change `defaultConfig.summarizer.priority` to heuristic-only.

- [ ] **Step 4: Update public repo links after rename**

Add or update links to use:

```text
https://github.com/dymayday/agent-voice
```

- [ ] **Step 5: Verify README**

Run:

```bash
rg -n 'agent-voice-sum-up-hook|claude-sum-up-hook|macos/AgentVoiceApp|/Users/meidhy|OPENAI_API_KEY=sk-|ghp_' README.md || true
rg -n 'summarizer mode heuristic|model providers|AGENT_VOICE_HOME|macos/AgentVoice' README.md
```

Expected:

- No old names or personal paths.
- Privacy/local-only guidance present.

- [ ] **Step 6: Commit**

Run:

```bash
git add README.md
git commit -m "docs: clarify public privacy behavior"
```

---

## Task 6: Full local verification gate

**Files:** none, unless fixing failures.

- [ ] **Step 1: Run current-tree leak scans**

Run:

```bash
git grep -n -I -E '/Users/meidhy|dymayday@gmail\.com|agent-voice-sum-up-hook|claude-sum-up-hook|macos/AgentVoiceApp|local\.agentvoice\.app|sk-secret|OPENAI_API_KEY=sk-|ghp_secret|plain-password|BEGIN PRIVATE KEY' -- . ':!bun.lock' || true
```

Expected: no matches.

- [ ] **Step 2: Check tracked sensitive file extensions**

Run:

```bash
git ls-files | grep -E '(^|/)(\.env|\.npmrc|\.pypirc|id_rsa|id_ed25519|config\.json|queue\.db|.*\.sqlite|.*\.db|.*\.pem|.*\.key|.*\.crt|.*\.mobileprovision|.*\.log|.*\.wav)$' || true
```

Expected: no output.

- [ ] **Step 3: Check ignored local artifacts**

Run:

```bash
git status --ignored --short | sed -n '1,120p'
```

Expected: build outputs and `.superpowers/` are ignored; no unexpected untracked files that should be committed.

- [ ] **Step 4: Run TypeScript verification**

Run:

```bash
bun test
bun run typecheck
bun audit --json
```

Expected:

- All Bun tests pass.
- Typecheck exits 0.
- Audit returns `{}` or no actionable advisories.

- [ ] **Step 5: Run Swift verification**

Run:

```bash
swift test --package-path macos/AgentVoice
swift build --package-path macos/AgentVoice
```

Expected: tests and build pass.

- [ ] **Step 6: Run app bundle smoke test**

Run:

```bash
bash scripts/generate-macos-icon.sh
bash scripts/build-macos-app.sh
AGENT_VOICE_HOME="$(mktemp -d)" \
  "dist/Agent Voice.app/Contents/Resources/agent-voice/bin/agent-voice" status --json
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "dist/Agent Voice.app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "dist/Agent Voice.app/Contents/Info.plist"
test -x "dist/Agent Voice.app/Contents/MacOS/AgentVoice"
```

Expected:

- Bundled CLI status prints valid JSON.
- Bundle identifier is `com.dymayday.agentvoice`.
- Bundle executable is `AgentVoice`.
- Executable exists.

- [ ] **Step 7: Commit any verification fixes**

If any checks fail, fix them and commit focused patches before continuing.

---

## Task 7: Create clean public history while preserving final `master` default

**Files:** all sanitized public files.

**This task contains destructive remote operations. Stop and ask for explicit human confirmation before Step 6.**

- [ ] **Step 1: Make sure sanitized branch is clean**

Run:

```bash
git status --short --branch
git log --oneline --max-count=5
```

Expected: clean working tree on `chore/public-release-sanitization` with all sanitation commits present.

- [ ] **Step 2: Create local private-history backup branch**

Run:

```bash
git branch private-history-master master || true
git branch --unset-upstream private-history-master 2>/dev/null || true
```

Expected: local backup branch exists and is not tracking `origin/master`.

- [ ] **Step 3: Create orphan public staging branch from sanitized tree**

Run:

```bash
git switch --orphan public-main
git add -A
git commit -m "Initial public release"
```

Expected:

- `git log --oneline` shows a single commit on `public-main`.
- `git status --short` is clean.

- [ ] **Step 4: Verify orphan branch contents**

Run:

```bash
git log --oneline --max-count=5
git grep -n -I -E '/Users/meidhy|dymayday@gmail\.com|agent-voice-sum-up-hook|claude-sum-up-hook|macos/AgentVoiceApp|local\.agentvoice\.app|sk-secret|OPENAI_API_KEY=sk-|ghp_secret|plain-password|BEGIN PRIVATE KEY' -- . ':!bun.lock' || true
git ls-files docs/superpowers docs/visual generated-images || true
git ls-files | grep -E '(^|/)(\.env|.*\.pem|.*\.key|.*\.db|.*\.sqlite|.*\.log|.*\.wav)$' || true
```

Expected:

- One commit only.
- No leak-scan matches.
- Removed private/generated paths absent.
- No sensitive tracked file extensions.

- [ ] **Step 5: Push temporary public staging branch while repo is still private**

Run:

```bash
git push origin public-main
```

Expected: `public-main` exists remotely, but repository is still private.

- [ ] **Step 6: Stop for human confirmation before remote default/ref deletion**

Ask:

```text
The clean public-main branch is pushed while the repo is still private. Confirm before I change the GitHub default branch, delete old remote refs, and replace remote master with the clean public commit.
```

Do not continue without explicit confirmation.

- [ ] **Step 7: Change GitHub default branch from old `master` to temporary `public-main`**

Use GitHub UI:

1. Repository Settings → Branches.
2. Change default branch from `master` to `public-main`.
3. Confirm the repository is still private.

Alternative with GitHub CLI if authenticated:

```bash
gh repo edit dymayday/agent-voice-sum-up-hook --default-branch public-main
```

Expected: GitHub default branch is `public-main` temporarily.

- [ ] **Step 8: Delete old remote branches and tags while repo is private**

List remote heads/tags:

```bash
git ls-remote --heads origin
git ls-remote --tags origin
```

Delete old remote `master`:

```bash
git push origin --delete master
```

Delete any other old remote branches except `public-main`:

```bash
# Example only; run once per old branch after reviewing ls-remote output.
git push origin --delete OLD_BRANCH_NAME
```

Delete old remote tags if any:

```bash
# Example only; run once per old tag after reviewing ls-remote output.
git push origin :refs/tags/OLD_TAG_NAME
```

Expected: only `public-main` remains as a remote head, and no old tags remain.

- [ ] **Step 9: Push clean public commit as remote `master`**

Run:

```bash
git push origin public-main:master
```

Expected: remote `master` now points to the same clean single commit as `public-main`.

- [ ] **Step 10: Restore clean `master` as GitHub default branch**

Use GitHub UI:

1. Repository Settings → Branches.
2. Change default branch from `public-main` back to `master`.

Alternative with GitHub CLI:

```bash
gh repo edit dymayday/agent-voice-sum-up-hook --default-branch master
```

Expected: default branch is clean `master`.

- [ ] **Step 11: Delete temporary remote `public-main`**

Run:

```bash
git push origin --delete public-main
```

Expected: only clean `master` remains.

- [ ] **Step 12: Verify remote refs are public-safe**

Run:

```bash
git ls-remote --heads origin
git ls-remote --tags origin
```

Expected:

- One remote head: `refs/heads/master`.
- No remote tags unless they were created from the clean public commit.

- [ ] **Step 13: Create a local clean `master` branch without losing private backup**

Run:

```bash
git switch public-main
git switch -c master-public
git branch --set-upstream-to=origin/master master-public
```

Expected:

- Local `master-public` tracks clean remote `master`.
- Local `private-history-master` still preserves private history and has no upstream.

Optional after confirming you no longer need the old local branch name:

```bash
# Only if safe in your local workflow.
# git branch -D master
# git branch -m master-public master
```

---

## Task 8: Rename GitHub repo and make it public

**Files:** none.

**Stop for explicit human confirmation before changing visibility.**

- [ ] **Step 1: Confirm remote clean state one more time**

Run:

```bash
git ls-remote --heads origin
git ls-remote --tags origin
git ls-remote origin master
```

Expected: only clean `master`; no old tags.

- [ ] **Step 2: Rename repository while still private**

Use GitHub UI:

1. Repository Settings → General → Repository name.
2. Rename from `agent-voice-sum-up-hook` to `agent-voice`.

Alternative with GitHub CLI:

```bash
gh repo rename agent-voice --repo dymayday/agent-voice-sum-up-hook
```

- [ ] **Step 3: Update local origin URL after GitHub rename**

Run:

```bash
git remote set-url origin git@github.com:dymayday/agent-voice.git
git remote -v
```

Expected: origin points to `git@github.com:dymayday/agent-voice.git`.

- [ ] **Step 4: Make repository public**

Use GitHub UI:

1. Repository Settings → General → Danger Zone → Change visibility.
2. Choose Public.
3. Confirm only after remote refs have been verified clean.

Alternative with GitHub CLI if supported and authenticated:

```bash
gh repo edit dymayday/agent-voice --visibility public
```

- [ ] **Step 5: Final public verification**

Run:

```bash
git ls-remote --heads origin
git ls-remote --tags origin
```

Then check GitHub web UI:

- Public repo is `dymayday/agent-voice`.
- Default branch is `master`.
- Old private branch history is not visible.
- README renders correctly.
- License is detected as MIT.

---

## Final verification checklist

- [ ] `LICENSE` exists and GitHub detects MIT.
- [ ] `package.json` name is `agent-voice`, `private` remains `true`, and repository URLs point to `dymayday/agent-voice`.
- [ ] `macos/AgentVoice` is the Swift package path.
- [ ] App bundle executable is `AgentVoice`.
- [ ] Bundle identifier is `com.dymayday.agentvoice`.
- [ ] README clearly documents model-backed summarizer privacy behavior and heuristic local-only mode.
- [ ] No current-tree personal paths, maintainer email, old repo/package names, old app paths, or scanner-triggering fake secrets.
- [ ] No internal planning docs or generated image candidate artifacts in the public tree.
- [ ] `bun test` passes.
- [ ] `bun run typecheck` passes.
- [ ] `bun audit --json` has no actionable advisories.
- [ ] `swift test --package-path macos/AgentVoice` passes.
- [ ] `swift build --package-path macos/AgentVoice` passes.
- [ ] Remote public refs contain only clean `master` and no old tags.
