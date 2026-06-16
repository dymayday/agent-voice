# Pi Agent Install Buttons Design

## Goal

Add real install/uninstall support for the Pi agent hook first, then expose it in the macOS app as Install Hook and Uninstall Hook buttons on the Pi agent row.

## Scope

In scope:
- Implement `agent-voice install --agents pi`.
- Implement `agent-voice uninstall --agents pi`.
- Generate one owned Pi global extension at `~/.pi/agent/extensions/agent-voice.ts`.
- Add app model and UI actions for Pi install/uninstall.
- Keep install buttons for Claude, Codex, and OpenCode disabled or marked as coming later.

Out of scope:
- Claude, Codex, or OpenCode installation.
- LaunchAgent installation.
- Wrapper installation.
- Editing unrelated Pi config files.

## Pi Extension Behavior

The generated Pi extension should use Pi's public TypeScript extension API and subscribe to `turn_end`.

On each `turn_end`:
- If `AGENT_VOICE_DISABLE=1`, do nothing.
- Extract assistant turn text from the event as safely as possible.
- If no usable text is available, enqueue a generic Pi completion sentence.
- Run the installed `agent-voice` executable with:
  - `enqueue`
  - `--format text`
  - `--agent pi`
  - `--cwd <ctx.cwd>`
- Pass final text on stdin.
- Use non-blocking/bounded child-process behavior so Pi is not slowed by voice processing.

## Install Behavior

`agent-voice install --agents pi` should:
- Resolve the current `agent-voice` executable path for use by the generated extension.
- Create `~/.pi/agent/extensions/` if needed.
- Write `agent-voice.ts` with an ownership marker.
- Be idempotent: running install again updates the owned file without duplicating anything.
- Refuse to overwrite an existing `agent-voice.ts` that lacks the ownership marker.

## Uninstall Behavior

`agent-voice uninstall --agents pi` should:
- Delete `~/.pi/agent/extensions/agent-voice.ts` only if it contains the ownership marker.
- Succeed as a no-op if the owned file is absent.
- Refuse to delete a non-owned file and return a clear error.

## CLI UX

Supported commands:

```bash
agent-voice install --agents pi
agent-voice uninstall --agents pi
```

Unsupported agents should be rejected in this slice with a clear message such as `install currently supports only pi`.

## App UX

In the Agents card:
- Pi row shows enabled Install Hook and Uninstall Hook buttons.
- Claude, Codex, and OpenCode rows show disabled install/uninstall buttons or `coming later` text.
- Button actions call the CLI and then refresh app state.
- Errors surface through existing `lastError` display.

## Safety

- No writes outside the Pi extension path for this slice.
- Never mutate real user files during tests; tests use fake HOME and/or injectable env.
- Generated extension includes a clear ownership marker.
- Uninstall removes only files owned by agent-voice.

## Testing

TypeScript tests:
- `install --agents pi` writes a marked Pi extension under a fake home.
- Install is idempotent.
- Install refuses to overwrite an unowned file.
- `uninstall --agents pi` removes an owned extension.
- Uninstall succeeds when the owned extension is absent.
- Uninstall refuses an unowned file.
- Unsupported agents are rejected for install/uninstall.

Swift tests:
- `AgentVoiceCLI.installAgentHook("pi")` runs `install --agents pi`.
- `AgentVoiceCLI.uninstallAgentHook("pi")` runs `uninstall --agents pi`.
- `AppModel.installAgentHook("pi")` delegates and refreshes.
- `AppModel.uninstallAgentHook("pi")` delegates and refreshes.
