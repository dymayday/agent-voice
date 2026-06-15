import AgentVoiceCore
import SwiftUI

struct SetupAssistantView: View {
    @ObservedObject var model: AppModel
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
                labeledRow(title: "Kokoro script", detail: "Choose path support coming later")
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
                Text("Adapter installation and launch-at-login support are not part of this build yet.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var agentRows: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(agentSummaries, id: \.name) { item in
                HStack {
                    VStack(alignment: .leading) {
                        Text(item.name.capitalized)
                            .font(.headline)
                        Text(item.summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button(item.enabled ? "Disable" : "Enable") {}
                        .disabled(true)
                }
            }
            Text("Use CLI enable/disable for now")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var repairChecks: some View {
        let checks = SetupAssistantModel.checks(from: nil, status: model.status)
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

    private var agentSummaries: [(name: String, enabled: Bool, summary: String)] {
        let agents = model.status?.config.agents ?? [:]
        let names = agents.isEmpty ? ["claude", "codex", "pi", "opencode"] : agents.keys.sorted()
        return names.map { name in
            let summary = agents[name]
            let enabled = summary?.enabled ?? false
            let mode = summary?.mode ?? "Not loaded"
            return (name: name, enabled: enabled, summary: enabled ? "Enabled · \(mode)" : "Disabled · \(mode)")
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
