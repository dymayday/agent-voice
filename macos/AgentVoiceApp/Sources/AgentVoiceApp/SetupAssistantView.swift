import AgentVoiceCore
import SwiftUI

private struct AgentSetupSummary: Identifiable {
    var id: String { name }
    let name: String
    let enabled: Bool
    let summary: String
}

struct SetupAssistantView: View {
    @ObservedObject var model: AppModel
    @Environment(\.openWindow) private var openWindow
    @State private var selectedStep: SetupStep = .welcome

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            Divider()
            detailPanel
        }
        .frame(minWidth: 720, minHeight: 460)
        .task {
            await model.refresh()
        }
        .task(id: model.preferredSetupStep) {
            applyPreferredSetupStepIfNeeded()
        }
    }

    private func applyPreferredSetupStepIfNeeded() {
        guard let step = model.preferredSetupStep else { return }
        selectedStep = step
        model.clearPreferredSetupStep(step)
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Setup")
                .font(.headline)
                .padding(.horizontal, 12)
                .padding(.top, 12)

            ForEach(SetupStep.allCases) { step in
                Button {
                    selectedStep = step
                } label: {
                    HStack {
                        Text(step.title)
                        Spacer()
                    }
                    .padding(.vertical, 6)
                    .padding(.horizontal, 10)
                    .background(selectedStep == step ? Color.accentColor.opacity(0.14) : Color.clear)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 8)
            }

            Spacer()
        }
        .frame(width: 180)
    }

    private var detailPanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(selectedStep.title)
                    .font(.largeTitle.bold())
                stepContent
                repairChecks
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
        }
    }

    @ViewBuilder
    private var stepContent: some View {
        switch selectedStep {
        case .welcome:
            VStack(alignment: .leading, spacing: 8) {
                Text("Agent Voice speaks one-line summaries when coding agents finish.")
                Text("Use this assistant to verify local voice, summary mode, agents, and daemon state.")
                    .foregroundStyle(.secondary)
            }
        case .kokoro:
            VStack(alignment: .leading, spacing: 12) {
                labeledRow(title: "Kokoro script", detail: model.config?.tts.kokoroScript ?? "Unknown")
                labeledRow(title: "Current voice", detail: model.config?.tts.voice ?? "Unknown")
                Text(
                    "Automatic setup installs managed uv when needed, pinned Python dependencies, " +
                        "and Kokoro model files under Agent Voice Home. It uses local disk space " +
                        "and may download files from the network."
                )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Open Kokoro Installer") {
                    openWindow(id: AgentVoiceWindowID.kokoroSetup)
                }
                voiceControls
                Button("Run Voice Test") {
                    Task { await model.testVoice() }
                }
            }
        case .summaries:
            VStack(alignment: .leading, spacing: 12) {
                Text("Choose how summaries are generated.")
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Use Heuristic Only") {
                        Task { await model.setSummarizerMode("heuristic") }
                    }
                    Button("Use Default Fallback") {
                        Task { await model.setSummarizerMode("default") }
                    }
                }
            }
        case .summaryVoice:
            summaryVoiceContent
        case .agents:
            VStack(alignment: .leading, spacing: 12) {
                Text("Agent enable/disable controls are intentionally explicit.")
                    .foregroundStyle(.secondary)
                agentRows
            }
        case .daemon:
            VStack(alignment: .leading, spacing: 12) {
                labeledRow(title: "Status", detail: model.status?.daemon.state.rawValue ?? "Unknown")
                HStack {
                    Button("Start Daemon") {
                        Task { await model.startDaemon() }
                    }
                    Button("Stop Daemon") {
                        Task { await model.stopDaemon() }
                    }
                    Button("Refresh") {
                        Task { await model.refresh() }
                    }
                }
            }
        case .finish:
            VStack(alignment: .leading, spacing: 8) {
                Text("Setup is ready for manual mode.")
                Text(
                    "Pi and Claude hook install are available. Launch-at-login " +
                        "and other agent installers are not part of this build yet."
                )
                .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var summaryVoiceContent: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("How spoken notifications sound when an agent finishes.")
                .foregroundStyle(.secondary)

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

            Button("Save changes") {
                Task { await model.saveSummaryVoice() }
            }
            .disabled(!model.summaryVoiceCanSave)
        }
    }

    @ViewBuilder
    private var voiceControls: some View {
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

    private var agentRows: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(agentSummaries, id: \.id) { item in
                HStack {
                    VStack(alignment: .leading) {
                        Text(item.name.capitalized)
                            .font(.headline)
                        Text(item.summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if item.name == "pi" || item.name == "claude" {
                        VStack(alignment: .trailing, spacing: 4) {
                            Button("Install Hook") {
                                Task { await model.installAgentHook(item.name) }
                            }
                            Button("Uninstall Hook") {
                                Task { await model.uninstallAgentHook(item.name) }
                            }
                        }
                    } else {
                        Text("Hook install coming later")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            Text("Use CLI enable/disable for now")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var repairChecks: some View {
        let checks = SetupAssistantModel.checks(from: model.doctorReport, status: model.status)
        return VStack(alignment: .leading, spacing: 8) {
            Text("Repair checks")
                .font(.headline)
            if checks.isEmpty {
                Text("No setup repair checks from current status.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(checks) { check in
                    labeledRow(title: check.title, detail: check.action ?? check.detail)
                }
            }
            if let lastError = model.lastError {
                Text(lastError)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }
        }
    }

    private var agentSummaries: [AgentSetupSummary] {
        let agents = model.status?.config.agents ?? [:]
        let names = agents.isEmpty ? ["claude", "codex", "pi", "opencode"] : agents.keys.sorted()
        return names.map { name in
            let summary = agents[name]
            let enabled = summary?.enabled ?? false
            let mode = summary?.mode ?? "Not loaded"
            return AgentSetupSummary(
                name: name,
                enabled: enabled,
                summary: enabled ? "Enabled · \(mode)" : "Disabled · \(mode)"
            )
        }
    }

    private func labeledRow(title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.headline)
            Text(detail)
                .foregroundStyle(.secondary)
        }
    }
}
