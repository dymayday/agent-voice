# Kokoro Voice Picker Design

## Goal

Expose the existing `tts.voice` setting in the macOS app so users can choose a common Kokoro voice or enter a custom voice id, save it through the CLI, and immediately run a voice test with the selected voice.

## Scope

In scope:
- Add an editable voice control to the Kokoro sections of the Dashboard and Setup Assistant.
- Parse `agent-voice config get` in the Swift app so the current `tts.voice` can be displayed.
- Save voice changes via the existing scalar CLI command: `agent-voice config set tts.voice <voice>`.
- Refresh app state after saving and show existing `lastError` feedback on failure.
- Keep the direct voice-test command using the saved config voice.

Out of scope:
- Dynamic voice discovery from Kokoro internals.
- Validating that a voice exists before saving.
- New daemon protocol or database changes.

## UX

The app should provide an editable combo-box style control:
- Common presets are visible as buttons or a picker menu.
- A text field allows arbitrary custom Kokoro voice ids.
- A Save Voice action is enabled only when the trimmed text is non-empty.
- Run Voice Test remains available and uses the currently saved config.

Initial common presets:
- `af_heart`
- `af_sky`
- `af_bella`
- `af_nicole`
- `am_adam`
- `am_michael`
- `bf_emma`
- `bm_george`

## Architecture

### CLI bridge

Add `AgentVoiceCLI.config()` to run `config get` and decode the full config JSON. Add `AgentVoiceCLI.setVoice(_:)` to run `config set tts.voice <voice>`.

### Swift models

Extend `AgentVoiceConfig.swift` from status-only summaries to also include a full config model with `tts.voice`. This model only needs fields used by the app and can ignore extra JSON fields.

### AppModel

Add:
- `@Published public private(set) var config: AgentVoiceFullConfig?`
- `@Published public var draftVoice: String`
- `saveVoice()` that trims the draft voice, rejects empty values, calls `cli.setVoice`, and refreshes.

`refresh()` should load status, history, doctor, and full config. After config loads, sync `draftVoice` to `config.tts.voice` unless the user is actively editing is not needed for this simple slice.

### Views

Dashboard Kokoro card and Setup Assistant Kokoro step should show:
- Current voice.
- Preset picker/buttons that update the draft voice.
- Editable text field bound to `draftVoice`.
- Save Voice button.
- Run Voice Test button.

## Error Handling

- Empty voice: set `lastError` to a local validation message and do not call CLI.
- CLI failure: preserve existing `lastError = String(describing: error)` behavior.
- Config decoding failure: refresh should surface the error through `lastError`, matching current app behavior for status/history/doctor failures.

## Testing

Swift tests:
- `AgentVoiceCLITests` verifies `config get` decodes `tts.voice`.
- `AgentVoiceCLITests` verifies `setVoice` runs `config set tts.voice <voice>`.
- `AppModelTests` verifies `refresh()` populates `draftVoice` from config.
- `AppModelTests` verifies `saveVoice()` trims and calls CLI, then refreshes.
- `AppModelTests` verifies empty voice is rejected without a CLI call.

Existing TypeScript config tests already cover scalar `tts.voice` persistence.
