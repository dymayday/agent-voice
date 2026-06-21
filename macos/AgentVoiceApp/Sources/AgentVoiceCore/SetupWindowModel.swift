import Foundation

/// Derived readiness for the redesigned Setup window ("Soundcheck").
///
/// The window has two faces — a guided "Soundcheck" strip and a "Board" — and
/// which one shows is computed *live* from already-published state on every
/// refresh. There is intentionally no persisted "setup complete" flag (and the
/// project forbids adding caching/flags): readiness is a pure function of the
/// current snapshot, so the window is correct on first launch and self-heals
/// back into the guided panel if something later breaks.
///
/// The reducer is deliberately conservative: every signal defaults to `false`
/// when unknown, so ambiguous state shows the guided panel rather than a
/// falsely-calm Board.
public struct SetupReadiness: Equatable, Sendable {
    /// Kokoro is installed: either this session's install succeeded, or the
    /// doctor confirms the Kokoro script resolves.
    public let enginePresent: Bool
    /// A non-empty voice id is configured.
    public let voiceSet: Bool
    /// The background daemon is running.
    public let daemonHealthy: Bool

    public init(enginePresent: Bool, voiceSet: Bool, daemonHealthy: Bool) {
        self.enginePresent = enginePresent
        self.voiceSet = voiceSet
        self.daemonHealthy = daemonHealthy
    }

    /// True only when all three signals are satisfied. Drives the face switch.
    public var isReady: Bool { enginePresent && voiceSet && daemonHealthy }

    /// The doctor check id that confirms the Kokoro script exists.
    public static let kokoroScriptCheckID = "tts.kokoroScript.exists"

    /// Compute readiness from published state. No I/O, no caching.
    public static func evaluate(
        status: AgentVoiceStatusSnapshot?,
        config: AgentVoiceFullConfig?,
        doctor: DoctorReport?,
        kokoroPhase: KokoroSetupPhase
    ) -> SetupReadiness {
        let engine = kokoroPhase == .succeeded || doctorCheckIsOK(doctor, id: kokoroScriptCheckID)
        let voice = !(config?.tts.voice ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty
        let daemon = status?.daemon.running == true
        return SetupReadiness(enginePresent: engine, voiceSet: voice, daemonHealthy: daemon)
    }

    private static func doctorCheckIsOK(_ doctor: DoctorReport?, id: String) -> Bool {
        doctor?.checks.first { $0.id == id }?.ok == true
    }
}

/// The configurable concerns the Setup window owns. These are the same nouns in
/// both faces: panels a new user completes in Soundcheck are the channels they
/// monitor on the Board.
public enum SetupConcern: String, CaseIterable, Identifiable, Sendable {
    case engine
    case voice
    case summaries
    case model
    case agents
    case daemon

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .engine: "Voice engine"
        case .voice: "Voice"
        case .summaries: "Summaries"
        case .model: "Model"
        case .agents: "Agents"
        case .daemon: "Daemon"
        }
    }

    /// SF Symbol used for the concern's glyph (paired with text — never color
    /// alone — to match the rest of the app's accessibility pattern).
    public var symbol: String {
        switch self {
        case .engine: "shippingbox"
        case .voice: "waveform"
        case .summaries: "text.bubble"
        case .model: "cpu"
        case .agents: "person.2"
        case .daemon: "bolt.horizontal.circle"
        }
    }

    /// Maps a legacy `SetupStep` deep-link target (from `preferredSetupStep`,
    /// e.g. the Dashboard's "tune the words" jump) onto the concern to surface.
    public static func from(step: SetupStep) -> SetupConcern {
        switch step {
        case .kokoro: .engine
        case .summaries, .summaryVoice: .summaries
        case .agents: .agents
        case .daemon: .daemon
        case .welcome, .finish: .voice
        }
    }
}

/// Three-level health for a concern, matching the app's canonical tints:
/// `.ok` → green, `.attention` → orange, `.critical` → red.
public enum SetupConcernStatus: String, Equatable, Sendable {
    case ok
    case attention
    case critical
}

public enum SetupConcernHealth {
    /// Per-concern health, used for the channel/panel status dots. Derived from
    /// readiness + the live snapshot; never color-only at the view layer.
    public static func status(
        for concern: SetupConcern,
        readiness: SetupReadiness,
        status: AgentVoiceStatusSnapshot?,
        doctor: DoctorReport?,
        summarizerModelEditable: Bool = true,
        summarizerModelValue: String = ""
    ) -> SetupConcernStatus {
        switch concern {
        case .engine:
            return readiness.enginePresent ? .ok : .critical
        case .voice:
            // Voice can't be healthy without an engine to speak it.
            guard readiness.enginePresent else { return .attention }
            return readiness.voiceSet ? .ok : .critical
        case .daemon:
            return readiness.daemonHealthy ? .ok : .attention
        case .summaries:
            let paused = status?.ui.attention.contains("system_paused") == true
            return paused ? .attention : .ok
        case .model:
            return summarizerModelEditable && hasUsableSummarizerModelValue(summarizerModelValue) ? .ok : .attention
        case .agents:
            // Informational: agent enable/disable is an explicit user choice,
            // not a broken state.
            return .ok
        }
    }

    public static func hasUsableSummarizerModelValue(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed != "Unknown"
    }

    /// All items for the single bottom repair rail: the concern-mapped checks
    /// from `SetupAssistantModel`, plus a catch-all for any *failing* doctor
    /// check that maps to no specific concern — so findings can never silently
    /// vanish (only three doctor ids map to concerns today).
    public static func repairItems(
        doctor: DoctorReport?,
        status: AgentVoiceStatusSnapshot?
    ) -> [SetupCheck] {
        // Only *failing* checks belong on the repair rail. `SetupAssistantModel.checks`
        // maps the mapped doctor ids (kokoroScript / daemon / failed-jobs) regardless of
        // their `ok` state, so without this filter a healthy system — whose doctor emits
        // all three as ok — would render a false "N things need attention" Board.
        var items = SetupAssistantModel.checks(from: doctor, status: status).filter { !$0.ok }
        let mappedIDs = Set(items.map(\.id))
        if let doctor {
            for check in doctor.checks where !check.ok && !mappedIDs.contains(check.id) {
                items.append(SetupCheck(
                    id: check.id,
                    ok: false,
                    title: check.message,
                    detail: check.message,
                    targetStep: .finish,
                    action: check.action
                ))
            }
        }
        return items
    }
}
