# Dashboard Summarizer Thinking Control Design

## Goal

Expose the existing `summarizer.thinking` setting in the macOS dashboard so users can choose how much reasoning effort the Pi summarizer uses, then save that choice through the existing CLI config system.

## Scope

In scope:
- Add a summarizer thinking control to the existing Dashboard **Voice and local config** card.
- Support every currently configured thinking value: `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`.
- Decode `summarizer.thinking` from `agent-voice config get` in the Swift app.
- Save changes with `agent-voice config set summarizer.thinking <value>`.
- Refresh app state after saving and use the existing `lastError` pattern for failures.
- Add tests for Swift config decoding, CLI command construction, AppModel behavior, and Dashboard source structure.

Out of scope:
- Changing summarizer defaults or model selection.
- Dynamic discovery of supported Pi thinking values.
- Adding setup-assistant controls.
- Changing the TypeScript summarizer invocation, which already reads `summarizer.thinking`.

## UX

The existing Dashboard **Voice and local config** card will gain a compact section:

- A row showing the saved value: `Summarizer thinking: <value>`.
- A picker bound to a draft value with all six allowed options.
- A **Save Thinking** button.

The save behavior should match the existing voice picker pattern: selecting a value only updates the draft, while the explicit save button persists it. Invalid or empty draft values should be rejected locally before invoking the CLI.

## Architecture

### CLI bridge

Add `AgentVoiceCLI.setSummarizerThinking(_:)` that runs:

```bash
agent-voice config set summarizer.thinking <value>
```

No TypeScript CLI command is needed because scalar config writes already work through `config set`.

### Swift models

Extend `AgentVoiceFullConfig` to decode a `summarizer` section with a `thinking` string. The model should continue decoding the existing `tts` section and can ignore extra config keys.

Recommended structures:

- `AgentVoiceFullConfig.tts`
- `AgentVoiceFullConfig.summarizer`
- `SummarizerConfig.thinking`

### AppModel

Add:

- `@Published public var draftThinking: String`
- `public static let summarizerThinkingOptions = ["off", "minimal", "low", "medium", "high", "xhigh"]`
- `saveThinking()` that trims the draft, checks it is one of the allowed options, calls `cli.setSummarizerThinking`, then refreshes.

`refresh()` should sync `draftThinking` from `config.summarizer.thinking`, just like `draftVoice` syncs from `config.tts.voice`.

### Dashboard view

Add a small `thinkingControls` view inside `kokoroCard` below the current voice controls. The card can keep its existing title to minimize IA churn for this small setting.

## Error Handling

- Empty or unsupported thinking value: set `lastError` to a local validation message and do not call the CLI.
- CLI failure: preserve existing `lastError = String(describing: error)` behavior.
- Config decoding failure: surface through `refresh()` as it already does for config/status/history/doctor failures.

## Testing

Swift tests:

- `AgentVoiceCLITests` decodes `summarizer.thinking` from `config get`.
- `AgentVoiceCLITests` verifies `setSummarizerThinking(_:)` runs `config set summarizer.thinking <value>`.
- `AppModelTests` verifies `refresh()` populates `draftThinking`.
- `AppModelTests` verifies `saveThinking()` delegates, refreshes, and syncs the saved value.
- `AppModelTests` verifies invalid thinking values are rejected without CLI calls.
- `DashboardViewSourceTests` verifies the dashboard includes the thinking control and save action in the local config card.

Verification commands after implementation:

```bash
swift test --package-path macos/AgentVoiceApp
swift build --package-path macos/AgentVoiceApp
bun test
bun run typecheck
```
