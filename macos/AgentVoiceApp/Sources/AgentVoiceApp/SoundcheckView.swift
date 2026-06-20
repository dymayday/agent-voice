import AgentVoiceCore
import SwiftUI

/// Face A — the guided "Soundcheck" strip shown to a new user (or when setup is
/// incomplete). Three gated panels — Engine, Voice, Speak — walk the user to
/// their agent's first spoken word, ending on a literal "Speak it" climax.
struct SoundcheckView: View {
    @ObservedObject var model: AppModel
    let readiness: SetupReadiness
    /// Flip to the Board. Optional concern is expanded there ("Tune the words").
    var onFinish: (SetupConcern?) -> Void

    private enum Panel { case engine, voice, speak }

    @State private var manualExpand: Panel?
    @State private var isSpeaking = false
    @State private var hasSpoken = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                progressRail
                enginePanel
                voicePanel
                speakPanel
            }
            .frame(maxWidth: 520, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding(24)
        }
    }

    // MARK: Header + rail

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Soundcheck")
                .font(.largeTitle.bold())
                .accessibilityAddTraits(.isHeader)
            Text("Three steps to your agent's voice.")
                .foregroundStyle(.secondary)
        }
    }

    private var progressRail: some View {
        HStack(spacing: 8) {
            railSegment("Engine", done: readiness.enginePresent, active: activePanel == .engine)
            railSegment("Voice", done: readiness.voiceSet, active: activePanel == .voice)
            railSegment("Speak", done: hasSpoken, active: activePanel == .speak)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(railAccessibilityLabel)
    }

    private func railSegment(_ title: String, done: Bool, active: Bool) -> some View {
        VStack(spacing: 6) {
            Capsule()
                .fill(done ? Color.green : (active ? Color.accentColor : Color.secondary.opacity(0.25)))
                .frame(height: 5)
            Text(title)
                .font(.caption)
                .foregroundStyle(done || active ? .primary : .secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private var railAccessibilityLabel: String {
        let step: String
        switch activePanel {
        case .engine: step = "step 1 of 3, Engine"
        case .voice: step = "step 2 of 3, Voice"
        case .speak: step = "step 3 of 3, Speak"
        }
        return step
    }

    // MARK: Panels

    private var enginePanel: some View {
        panel(
            .engine,
            title: "Voice engine",
            status: readiness.enginePresent ? .ok : .critical,
            locked: false,
            collapsedSummary: readiness.enginePresent ? "Kokoro ready" : "Not installed"
        ) {
            KokoroInstallInlineView(model: model)
        }
    }

    private var voicePanel: some View {
        let locked = !readiness.enginePresent
        return panel(
            .voice,
            title: "Voice",
            status: readiness.voiceSet ? .ok : (locked ? .attention : .critical),
            locked: locked,
            lockedReason: "Locked until the engine is installed",
            collapsedSummary: readiness.voiceSet ? model.config?.tts.voice ?? "Set" : "Pick a voice"
        ) {
            VoicePicker(model: model)
        }
    }

    private var speakPanel: some View {
        let locked = !(readiness.enginePresent && readiness.voiceSet)
        return panel(
            .speak,
            title: "Speak it",
            status: hasSpoken ? .ok : (locked ? .attention : .critical),
            locked: locked,
            lockedReason: "Locked until a voice is set",
            collapsedSummary: hasSpoken ? "You heard it" : "Hear it work"
        ) {
            speakContent
        }
    }

    @ViewBuilder
    private var speakContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            if hasSpoken {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 12) {
                        SoundwaveBloom(tint: .green)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(SetupNarration.heardVoice(model.config?.tts.voice ?? "your voice"))
                                .font(.headline)
                            Text("Sound good?")
                                .foregroundStyle(.secondary)
                        }
                    }
                    HStack {
                        Button("Sounds good → Finish") { finish(nil) }
                            .keyboardShortcut(.defaultAction)
                        Button("Tune the words") { finish(.summaries) }
                        Spacer()
                        Button("Speak again") { speak() }
                            .disabled(isSpeaking)
                    }
                }
                .transition(.opacity)
            } else {
                Text(SetupNarration.speakPrompt)
                    .foregroundStyle(.secondary)
                HStack(spacing: 12) {
                    Button {
                        speak()
                    } label: {
                        Label("Speak it", systemImage: "speaker.wave.2.fill")
                            .font(.title3.bold())
                            .padding(.vertical, 4)
                            .padding(.horizontal, 8)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isSpeaking)

                    VoiceMeter(isActive: isSpeaking, tint: .accentColor)
                }
            }
        }
    }

    // MARK: Generic collapsible panel

    @ViewBuilder
    private func panel<Content: View>(
        _ panel: Panel,
        title: String,
        status: SetupConcernStatus,
        locked: Bool,
        lockedReason: String? = nil,
        collapsedSummary: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        let expanded = isExpanded(panel) && !locked
        SetupCard(tint: locked ? .secondary : status.tint) {
            VStack(alignment: .leading, spacing: expanded ? 12 : 0) {
                Button {
                    guard !locked else { return }
                    withAnimation(.easeInOut(duration: 0.2)) {
                        manualExpand = expanded ? nil : panel
                    }
                } label: {
                    HStack(spacing: 10) {
                        if locked {
                            Image(systemName: "lock.fill").foregroundStyle(.secondary)
                        } else {
                            SetupStatusDot(status: status)
                        }
                        Text(title).font(.headline)
                        Spacer()
                        if !expanded {
                            Text(locked ? (lockedReason ?? "Locked") : collapsedSummary)
                                .font(.callout)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        if !locked {
                            Image(systemName: expanded ? "chevron.up" : "chevron.down")
                                .foregroundStyle(.secondary)
                                .font(.caption)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(locked)

                if expanded {
                    content()
                }
            }
        }
    }

    // MARK: Logic

    /// The first incomplete panel — the default focus.
    private var activePanel: Panel {
        if !readiness.enginePresent { return .engine }
        if !readiness.voiceSet { return .voice }
        return .speak
    }

    private func isExpanded(_ panel: Panel) -> Bool {
        (manualExpand ?? activePanel) == panel
    }

    private func speak() {
        guard !isSpeaking else { return }
        isSpeaking = true
        Task {
            await model.testVoice("Agent Voice is ready. I'll speak when your agents finish.")
            isSpeaking = false
            withAnimation(.easeInOut(duration: 0.25)) { hasSpoken = true }
        }
    }

    private func finish(_ concern: SetupConcern?) {
        if model.status?.daemon.running != true {
            Task { await model.startDaemon() }
        }
        onFinish(concern)
    }
}

/// Voice preset picker + custom id, reused by the Soundcheck Voice panel and the
/// Board's Voice channel.
struct VoicePicker: View {
    @ObservedObject var model: AppModel

    var body: some View {
        let presets = AppModel.kokoroVoicePresets
        VStack(alignment: .leading, spacing: 8) {
            Picker("Preset", selection: $model.draftVoice) {
                ForEach(presets, id: \.self) { voice in
                    Text(voice).tag(voice)
                }
                if !presets.contains(model.draftVoice), !model.draftVoice.isEmpty {
                    Text("Custom: \(model.draftVoice)").tag(model.draftVoice)
                }
            }
            .pickerStyle(.menu)

            HStack {
                TextField("Kokoro voice id", text: $model.draftVoice)
                    .textFieldStyle(.roundedBorder)
                Button("Save Voice") {
                    Task { await model.saveVoice() }
                }
                .disabled(model.draftVoice.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }
}
