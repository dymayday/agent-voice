import AgentVoiceCore
import AppKit
import SwiftUI

/// Face B — "The Board". The same window once setup is healthy: a calm set of
/// channel strips (Voice · Summaries · Model · Agents · Daemon) plus a single bottom
/// repair rail. Broken concerns re-disclose their controls inline here, so the
/// guided flow is never a dead one-time artifact.
struct SetupBoardView: View {
    @ObservedObject var model: AppModel
    let readiness: SetupReadiness
    var preferredConcern: SetupConcern?

    @Environment(\.openWindow) private var openWindow
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @State private var expanded: SetupConcern?

    private var channels: [SetupConcern] { [.voice, .summaries, .model, .agents, .daemon] }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    ForEach(channels) { concern in
                        channelCard(concern)
                    }
                }
                .padding(24)
            }
            repairRail
        }
        .onAppear { applyPreferred() }
        .onChange(of: preferredConcern) { _ in applyPreferred() }
    }

    private func applyPreferred() {
        guard let preferredConcern else { return }
        withAnimation(.easeInOut(duration: 0.2)) { expanded = preferredConcern }
    }

    // MARK: Header

    private var header: some View {
        let items = boardRepairItems
        let ok = items.isEmpty && readiness.isReady
        return HStack(spacing: 12) {
            Image(systemName: ok ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                .font(.title)
                .foregroundStyle(ok ? .green : .orange)
            VStack(alignment: .leading, spacing: 2) {
                Text(ok ? "Everything's set" : "\(items.count) thing\(items.count == 1 ? "" : "s") need attention")
                    .font(.title2.bold())
                Text(ok ? "Agent Voice will speak when your agents finish." : "Fix below, or expand a channel to adjust it.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Channels

    @ViewBuilder
    private func channelCard(_ concern: SetupConcern) -> some View {
        let status = SetupConcernHealth.status(
            for: concern,
            readiness: readiness,
            status: model.status,
            doctor: model.doctorReport,
            summarizerModelEditable: model.isSummarizerModelEditable,
            summarizerModelValue: model.summarizerModelInUseValue
        )
        let isOpen = expanded == concern
        SetupCard(tint: status.tint, fill: status == .ok ? 0.0 : 0.06) {
            VStack(alignment: .leading, spacing: isOpen ? 14 : 0) {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { expanded = isOpen ? nil : concern }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: concern.symbol).foregroundStyle(status.tint)
                        Text(concern.title).font(.headline)
                        SetupStatusDot(status: status)
                        Spacer()
                        if !isOpen {
                            Text(summary(for: concern))
                                .font(.callout)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Image(systemName: isOpen ? "chevron.up" : "chevron.down")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if isOpen {
                    channelContent(concern)
                }
            }
        }
    }

    @ViewBuilder
    private func channelContent(_ concern: SetupConcern) -> some View {
        switch concern {
        case .voice:
            VoiceChannelContent(model: model, enginePresent: readiness.enginePresent)
        case .summaries:
            SummariesChannelContent(model: model)
        case .model:
            ModelChannelContent(model: model)
        case .agents:
            AgentsChannelContent(model: model)
        case .daemon:
            DaemonChannelContent(model: model)
        case .engine:
            // Unreachable: `channels` never includes .engine (engine is folded into
            // the Voice channel). Arm exists only for switch exhaustiveness.
            KokoroInstallInlineView(model: model)
        }
    }

    private func summary(for concern: SetupConcern) -> String {
        switch concern {
        case .voice:
            return readiness.enginePresent ? (model.config?.tts.voice ?? "—") : "Engine not installed"
        case .summaries:
            let style = model.config?.summarizer.promptStyle ?? "default"
            let sentences = model.config?.summarizer.maxSentences ?? 1
            return "\(style.capitalized) · ≤\(sentences) sentence\(sentences == 1 ? "" : "s")"
        case .model:
            return modelSummary
        case .agents:
            let agents = model.status?.config.agents ?? [:]
            let enabled = agents.filter { $0.value.enabled }.keys.sorted().map(\.capitalized)
            return enabled.isEmpty ? "None enabled" : enabled.joined(separator: " · ")
        case .daemon:
            return model.status?.daemon.running == true ? "Running" : "Stopped"
        case .engine:
            // Unreachable (see channelContent) — engine status lives on the Voice channel.
            return readiness.enginePresent ? "Kokoro ready" : "Not installed"
        }
    }

    private var modelSummary: String {
        guard model.isSummarizerModelEditable,
              SetupConcernHealth.hasUsableSummarizerModelValue(model.summarizerModelInUseValue)
        else {
            return "Model unavailable"
        }
        return model.summarizerModelInUseValue
    }

    private var boardRepairItems: [SetupCheck] {
        var items = SetupConcernHealth.repairItems(doctor: model.doctorReport, status: model.status)
        let modelStatus = SetupConcernHealth.status(
            for: .model,
            readiness: readiness,
            status: model.status,
            doctor: model.doctorReport,
            summarizerModelEditable: model.isSummarizerModelEditable,
            summarizerModelValue: model.summarizerModelInUseValue
        )
        if modelStatus == .attention {
            items.append(SetupCheck(
                id: "summarizer.model.available",
                ok: false,
                title: "Model unavailable",
                detail: "Active summarizer model cannot be determined.",
                targetStep: .summaries,
                action: "Open Model"
            ))
        }
        return items
    }

    // MARK: Repair rail

    @ViewBuilder
    private var repairRail: some View {
        let items = boardRepairItems
        Divider()
        Group {
            if items.isEmpty {
                Label("All clear", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .font(.callout)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(items) { item in
                        HStack(spacing: 10) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.orange)
                            Text(item.title)
                                .font(.callout)
                                .lineLimit(2)
                            Spacer()
                            if let action = item.action {
                                Button(action) { performFix(for: item) }
                                    .buttonStyle(.bordered)
                            }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
        .background(reduceTransparency ? AnyShapeStyle(Color(nsColor: .windowBackgroundColor)) : AnyShapeStyle(.thinMaterial))
        if let lastError = model.lastError {
            Text(lastError)
                .font(.caption)
                .foregroundStyle(.red)
                .textSelection(.enabled)
                .padding(.horizontal, 24)
                .padding(.bottom, 8)
        }
    }

    private func performFix(for item: SetupCheck) {
        switch item.id {
        case "daemon.running":
            Task { await model.startDaemon() }
        case "system.paused":
            Task { await model.resume() }
        case "queue.failed.empty":
            // The chip's label is "Open dashboard failed jobs" — honor it.
            openWindow(id: AgentVoiceWindowID.dashboard)
        case SetupReadiness.kokoroScriptCheckID:
            withAnimation(.easeInOut(duration: 0.2)) { expanded = .voice }
        case "summarizer.model.available":
            withAnimation(.easeInOut(duration: 0.2)) { expanded = .model }
        default:
            Task { await model.refresh() }
        }
    }
}

// MARK: - Channel contents

/// Voice channel: re-discloses the inline installer when the engine is missing;
/// otherwise the voice picker plus a one-click "hear it" test.
struct VoiceChannelContent: View {
    @ObservedObject var model: AppModel
    let enginePresent: Bool
    @State private var isSpeaking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if enginePresent {
                VoicePicker(model: model)
                HStack(spacing: 12) {
                    Button {
                        speak()
                    } label: {
                        Label("Speak a test line", systemImage: "speaker.wave.2.fill")
                    }
                    .disabled(isSpeaking)
                    VoiceMeter(isActive: isSpeaking, tint: .accentColor, height: 22)
                }
            } else {
                Text("The voice engine isn't installed yet — set it up to choose a voice.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                KokoroInstallInlineView(model: model)
            }
        }
    }

    private func speak() {
        guard !isSpeaking else { return }
        isSpeaking = true
        SetupAccessibility.announce("Speaking test line")
        Task {
            let ok = await model.testVoice()
            isSpeaking = false
            SetupAccessibility.announce(ok ? "Test complete." : "Voice test failed.")
        }
    }
}

/// Summaries channel: generation mode plus the full summary-voice controls.
struct SummariesChannelContent: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("GENERATION")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Use Heuristic Only") { Task { await model.setSummarizerMode("heuristic") } }
                    Button("Use Default Fallback") { Task { await model.setSummarizerMode("default") } }
                }
            }
            SummaryVoiceSection(model: model)
        }
    }
}

/// The spoken-summary style/length controls, including the live "What the model
/// is told" preview with its debounced refresh — preserved from the original.
struct SummaryVoiceSection: View {
    @ObservedObject var model: AppModel
    @State private var promptExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("STYLE")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Picker("Style", selection: $model.draftPromptStyle) {
                    ForEach(AppModel.summarizerPromptStyleCatalog) { style in
                        Text(style.name).tag(style.id)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                if let info = AppModel.summarizerPromptStyleCatalog.first(where: { $0.id == model.draftPromptStyle }) {
                    Text(info.detail)
                    Text("e.g. \"\(info.example)\"")
                        .foregroundStyle(.secondary)
                        .italic()
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("LENGTH")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack {
                    Text("Max sentences")
                    TextField("1", text: $model.draftMaxSentences)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 80)
                }
                HStack {
                    Text("Max characters")
                    TextField("180", text: $model.draftMaxSummaryChars)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 80)
                    if let chars = Int(model.draftMaxSummaryChars.trimmingCharacters(in: .whitespacesAndNewlines)), chars > 0 {
                        Text("~\(max(1, chars / 15))s of speech")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("QUESTIONS")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Toggle("Speak questions and approvals word-for-word", isOn: $model.draftSpeakQuestionsVerbatim)
                Text("Off shortens them like other summaries; you may lose the exact options.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("IGNORED PHRASES")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("done, ok", text: $model.draftIgnoreTextPhrases)
                    .textFieldStyle(.roundedBorder)
                Text("Comma-separated exact matches. Done — updated tests still speaks.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            DisclosureGroup("What the model is told", isExpanded: $promptExpanded) {
                VStack(alignment: .leading, spacing: 8) {
                    if model.summaryVoicePromptPreview.isEmpty {
                        Text("Loading…").foregroundStyle(.secondary)
                    } else {
                        ScrollView {
                            Text(model.summaryVoicePromptPreview)
                                .font(.system(.caption, design: .monospaced))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(maxHeight: 220)
                    }
                    Button("Copy") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(model.summaryVoicePromptPreview, forType: .string)
                    }
                    .disabled(model.summaryVoicePromptPreview.isEmpty)
                }
                .padding(.top, 4)
            }

            Button("Save changes") {
                Task { await model.saveSummaryVoice() }
            }
            .disabled(!model.summaryVoiceCanSave)
        }
        // Refresh the preview when the disclosure is open and the draft changes.
        .task(id: "\(promptExpanded)|\(model.draftPromptStyle)|\(model.draftMaxSentences)|\(model.draftMaxSummaryChars)") {
            guard promptExpanded else { return }
            try? await Task.sleep(nanoseconds: 250_000_000)  // debounce rapid edits
            if Task.isCancelled { return }
            await model.refreshSummaryVoicePrompt()
        }
    }
}

/// Model channel: mirrors the Dashboard's active summarizer model controls.
struct ModelChannelContent: View {
    @ObservedObject var model: AppModel

    var body: some View {
        SummarizerModelControls(model: model)
    }
}

/// Agents channel: per-agent enable state + hook install/uninstall.
struct AgentsChannelContent: View {
    @ObservedObject var model: AppModel

    private struct AgentSummary: Identifiable {
        let name: String
        let enabled: Bool
        let mode: String

        var id: String { name }
    }

    private var agentSummaries: [AgentSummary] {
        let agents = model.status?.config.agents ?? [:]
        let names = agents.isEmpty ? ["claude", "codex", "pi", "opencode"] : agents.keys.sorted()
        return names.map { name in
            let summary = agents[name]
            return AgentSummary(
                name: name,
                enabled: summary?.enabled ?? false,
                mode: summary?.mode ?? "Mode unavailable"
            )
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(agentSummaries) { item in
                let installState = model.status?.install?[item.name] ?? .unknown
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.name.capitalized).font(.headline)
                        installBadge(installState)
                        if installState == .installed && item.enabled == false {
                            Text("Voice disabled")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Text(item.mode).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    agentHookControls(name: item.name, state: installState)
                }
            }
            Text("Use CLI enable/disable for now")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func installBadge(_ state: InstallState) -> some View {
        switch state {
        case .installed:
            Label("Installed", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .notInstalled:
            Label("Not installed", systemImage: "xmark.circle")
                .foregroundStyle(.orange)
        case .unsupported:
            Label("Not available yet", systemImage: "clock")
                .foregroundStyle(.secondary)
        case .unknown:
            Label("Checking…", systemImage: "circle.dotted")
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func agentHookControls(name: String, state: InstallState) -> some View {
        switch state {
        case .notInstalled:
            Button("Install \(name.capitalized) Hook") {
                Task { await model.installAgentHook(name) }
            }
            .font(.caption)
        case .installed:
            Button("Uninstall \(name.capitalized) Hook", role: .destructive) {
                Task { await model.uninstallAgentHook(name) }
            }
            .font(.caption)
        case .unsupported:
            Text("Hook install coming later")
                .font(.caption)
                .foregroundStyle(.secondary)
        case .unknown:
            EmptyView()
        }
    }
}

/// Daemon channel: run state + start/stop/refresh.
struct DaemonChannelContent: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Status: \(model.status?.daemon.state.rawValue ?? "Unknown")")
                .foregroundStyle(.secondary)
            HStack {
                Button("Start Daemon") { Task { await model.startDaemon() } }
                Button("Stop Daemon") { Task { await model.stopDaemon() } }
                Button("Refresh") { Task { await model.refresh() } }
            }
        }
    }
}
