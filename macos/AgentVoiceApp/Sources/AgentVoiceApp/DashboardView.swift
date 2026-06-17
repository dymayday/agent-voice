import AgentVoiceCore
import AppKit
import SwiftUI

private let recentEventsPreviewLimit = 5
private let failedJobsPreviewLimit = 4
private let dashboardColumns = [GridItem(.adaptive(minimum: 340), spacing: 16)]
private let queueMetricColumns = [GridItem(.adaptive(minimum: 135), spacing: 12)]

struct DashboardView: View {
    @ObservedObject var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                errorBanner
                statusHero
                queueOverviewCard
                operationsGrid
                activityGrid
                agentGridSection
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
        }
        .frame(minWidth: 900, minHeight: 640)
        .onAppear { model.startAutoRefresh() }
        .onDisappear { model.stopAutoRefresh() }
    }
}

private extension DashboardView {
    func openAttentionDetails() {
        openWindow(id: AgentVoiceWindowID.attention)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    var header: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Agent Voice Dashboard")
                    .font(.largeTitle.bold())
                    .accessibilityAddTraits(.isHeader)
                Text("Local voice daemon, queue, and diagnostic console")
                    .foregroundStyle(.secondary)
            }

            Spacer()

            statusBadge

            Button("Refresh") {
                Task { await model.refresh() }
            }
            .keyboardShortcut("r", modifiers: .command)
        }
    }

    private var statusBadge: some View {
        Text(model.status?.ui.state.displayName ?? "Unknown")
            .font(.caption.weight(.semibold))
            .foregroundStyle(statusTint)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(statusTint.opacity(0.12))
            .clipShape(Capsule())
            .accessibilityLabel("Dashboard status")
            .accessibilityValue(model.status?.ui.state.displayName ?? "Unknown")
    }

    @ViewBuilder
    private var errorBanner: some View {
        if let lastError = model.lastError {
            card("Last error", systemImage: "exclamationmark.triangle.fill", tint: .red) {
                Text(lastError)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var statusHero: some View {
        LazyVGrid(columns: dashboardColumns, alignment: .leading, spacing: 16) {
            healthCard
            daemonCard
        }
    }

    private var healthCard: some View {
        card("System health", systemImage: "heart.text.square", tint: statusTint) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    Text(model.status?.ui.state.displayName ?? "Unknown")
                        .font(.title.bold())
                    Spacer()
                    Text(statusSubtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                if let attention = model.status?.ui.attention, !attention.isEmpty {
                    Button {
                        openAttentionDetails()
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(attention, id: \.self) { item in
                                Label(item, systemImage: "bell.badge.fill")
                                    .foregroundStyle(.orange)
                            }
                            Text("Open details")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .font(.subheadline)
                    .accessibilityLabel("Open attention details")
                    .accessibilityValue("\(attention.count) attention \(attention.count == 1 ? "message" : "messages")")
                } else if model.doctorReport == nil {
                    Label("Diagnostics unavailable", systemImage: "questionmark.circle")
                        .foregroundStyle(.secondary)
                        .font(.subheadline)
                } else if doctorIssues.isEmpty {
                    Label("No repair action currently surfaced", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(.green)
                        .font(.subheadline)
                }

                if !doctorIssues.isEmpty {
                    let noun = doctorIssues.count == 1 ? "check" : "checks"
                    Button {
                        openAttentionDetails()
                    } label: {
                        Label("\(doctorIssues.count) diagnostic \(noun) need review", systemImage: "stethoscope")
                            .foregroundStyle(.orange)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .font(.subheadline)
                    .accessibilityLabel("Open diagnostic review details")
                    .accessibilityValue("\(doctorIssues.count) diagnostic \(noun) need review")
                }
            }
        }
    }

    private var daemonCard: some View {
        card("Daemon", systemImage: "bolt.horizontal.circle", tint: daemonTint) {
            VStack(alignment: .leading, spacing: 12) {
                if let daemon = model.status?.daemon {
                    labeledRow("State", daemon.state.rawValue)
                    labeledRow("Running", daemon.running ? "Yes" : "No")
                    labeledRow("PID", daemon.pid.map(String.init) ?? "None")
                } else {
                    labeledRow("State", "Status unavailable")
                    labeledRow("Running", "Unknown")
                    labeledRow("PID", "Unknown")
                }

                HStack {
                    Button("Start Daemon") {
                        Task { await model.startDaemon() }
                    }
                    .disabled(model.status?.daemon.running == true)

                    Button("Stop Daemon", role: .destructive) {
                        Task { await model.stopDaemon() }
                    }
                    .disabled(model.status?.daemon.running != true)
                }
            }
        }
    }

    @ViewBuilder
    private var queueOverviewCard: some View {
        if let queues = model.status?.queues {
            card("Queue overview", systemImage: "tray.full", tint: queueTint(for: queues)) {
                VStack(alignment: .leading, spacing: 14) {
                    LazyVGrid(columns: queueMetricColumns, alignment: .leading, spacing: 12) {
                        queueMetric("Pending", queues.pending, systemImage: "clock", tint: .orange)
                        queueMetric("Processing", queues.processing, systemImage: "waveform", tint: .blue)
                        queueMetric("Done", queues.done, systemImage: "checkmark.circle", tint: .green)
                        queueMetric("Failed", queues.failed, systemImage: "xmark.octagon", tint: .red)
                        queueMetric("Skipped", queues.skipped, systemImage: "forward.end", tint: .secondary)
                    }

                    HStack {
                        Button("Clear Pending Queue", role: .destructive) {
                            Task { await model.clearQueue() }
                        }
                        .disabled(!canClearQueue)

                        Text("Clears pending and processing jobs only; completed history is preserved.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        } else {
            card("Queue overview", systemImage: "tray.full") {
                Text("Queue counts unavailable")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var operationsGrid: some View {
        LazyVGrid(columns: dashboardColumns, alignment: .leading, spacing: 16) {
            kokoroCard
            diagnosticsCard
        }
    }

    private var kokoroCard: some View {
        card("Voice and local config", systemImage: "speaker.wave.2", tint: .teal) {
            VStack(alignment: .leading, spacing: 12) {
                labeledRow("Voice", model.config?.tts.voice ?? "Unknown")
                voiceControls
                labeledRow("Summarizer thinking", model.config?.summarizer.thinking ?? "Unknown")
                thinkingControls
                labeledRow(model.summarizerModelInUseLabel, model.summarizerModelInUseValue)
                summarizerModelControls
                labeledRow("Kokoro script", model.config?.tts.kokoroScript ?? "Unknown")
                labeledRow("Agent Voice home", model.status?.paths.home ?? "Unknown")
                labeledRow("Config", model.status?.paths.config ?? "Unknown")
                labeledRow("Queue database", model.status?.paths.db ?? "Unknown")
                Button("Run Voice Test") {
                    Task { await model.testVoice() }
                }
            }
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

    @ViewBuilder
    private var thinkingControls: some View {
        let options = AppModel.summarizerThinkingOptions
        VStack(alignment: .leading, spacing: 8) {
            Picker("Thinking effort", selection: $model.draftThinking) {
                ForEach(options, id: \.self) { effort in
                    Text(effort).tag(effort)
                }
            }
            .pickerStyle(.menu)

            Button("Save Thinking") {
                Task { await model.saveThinking() }
            }
            .disabled(!options.contains(model.draftThinking.trimmingCharacters(in: .whitespacesAndNewlines)))
        }
    }

    @ViewBuilder
    private var summarizerModelControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("Model identifier", text: $model.draftSummarizerModel)
                    .textFieldStyle(.roundedBorder)

                Button("Save") {
                    Task { await model.saveSummarizerModel() }
                }
                .disabled(
                    !model.isSummarizerModelEditable
                        || model.draftSummarizerModel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                )

                Button("Validate") {
                    Task { await model.validateSummarizerModel() }
                }
                .disabled(
                    !model.isSummarizerModelEditable
                        || model.draftSummarizerModel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                )
            }
            if !model.availableSummarizerModels.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Choose from models discovered at startup")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Menu("Use known model") {
                        ForEach(model.availableSummarizerModels, id: \.self) { availableModel in
                            Button(availableModel) {
                                self.model.draftSummarizerModel = availableModel
                            }
                        }
                    }
                    .disabled(!model.isSummarizerModelEditable)
                }
            }
            if !model.isSummarizerModelEditable {
                Text("Summarizer model cannot be determined from current config")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var diagnosticsCard: some View {
        card("Diagnostics", systemImage: "stethoscope", tint: doctorIssues.isEmpty ? .green : .orange) {
            VStack(alignment: .leading, spacing: 10) {
                if let report = model.doctorReport {
                    if doctorIssues.isEmpty {
                        Label(
                            "All \(report.checks.count) doctor checks are passing or informational.",
                            systemImage: "checkmark.seal.fill"
                        )
                        .foregroundStyle(.green)
                    } else {
                        Button {
                            openAttentionDetails()
                        } label: {
                            VStack(alignment: .leading, spacing: 10) {
                                ForEach(doctorIssues.prefix(5)) { check in
                                    let icon = check.ok ? "info.circle" : "exclamationmark.triangle.fill"
                                    VStack(alignment: .leading, spacing: 3) {
                                        Label(check.message, systemImage: icon)
                                            .foregroundStyle(severityTint(check.severity))
                                        if let action = check.action, !action.isEmpty {
                                            Text(action)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                                Text("Open all details")
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Open diagnostic details")
                        .accessibilityValue("\(doctorIssues.count) diagnostic \(doctorIssues.count == 1 ? "check" : "checks") need review")
                    }
                } else {
                    Text("Diagnostics unavailable")
                        .foregroundStyle(.secondary)
                }
            }
            .font(.subheadline)
        }
    }

    private var activityGrid: some View {
        LazyVGrid(columns: dashboardColumns, alignment: .leading, spacing: 16) {
            failedJobsSection
            recentEventsSection
        }
    }

    @ViewBuilder
    private var failedJobsSection: some View {
        card("Failed jobs", systemImage: "xmark.octagon", tint: failedJobs.isEmpty ? .green : .red) {
            if model.history == nil {
                Text("History unavailable")
                    .foregroundStyle(.secondary)
            } else if failedJobs.isEmpty {
                Text("No failed jobs.")
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(failedJobs.prefix(failedJobsPreviewLimit)) { job in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(job.agent.capitalized) failed")
                                .font(.headline)
                            Text(job.lastError ?? "No error exposed by current CLI yet")
                                .foregroundStyle(.secondary)
                                .lineLimit(3)
                            Text("Attempts: \(job.attempts) · \(job.finishedAt ?? job.createdAt)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var recentEventsSection: some View {
        card("Recent spoken events", systemImage: "text.bubble", tint: .blue) {
            if model.history == nil {
                Text("History unavailable")
                    .foregroundStyle(.secondary)
            } else if recentDoneJobs.isEmpty {
                Text("No recent done events.")
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(recentDoneJobs.prefix(recentEventsPreviewLimit)) { job in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(job.summary ?? "No summary recorded")
                                .font(.headline)
                                .lineLimit(2)
                            Text("\(job.agent.capitalized) · \(job.finishedAt ?? job.createdAt)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }

    private var agentGridSection: some View {
        card("Agents", systemImage: "point.3.connected.trianglepath.dotted") {
            let agents = model.status?.config.agents ?? [:]
            if agents.isEmpty {
                Text("Agent config unavailable")
                    .foregroundStyle(.secondary)
            } else {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 190), spacing: 12)],
                    alignment: .leading,
                    spacing: 12
                ) {
                    ForEach(agents.keys.sorted(), id: \.self) { name in
                        let agent = agents[name]
                        let isEnabled = agent?.enabled == true
                        VStack(alignment: .leading, spacing: 8) {
                            Text(name.capitalized)
                                .font(.headline)
                                .accessibilityAddTraits(.isHeader)
                            Label(
                                isEnabled ? "Enabled" : "Disabled",
                                systemImage: isEnabled ? "checkmark.circle.fill" : "pause.circle"
                            )
                            .foregroundStyle(isEnabled ? .green : .secondary)
                            Text(agent?.mode ?? "Not exposed by current CLI yet")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if name == "pi" || name == "claude" {
                                VStack(alignment: .leading, spacing: 6) {
                                    Button("Install \(name.capitalized) Hook") {
                                        Task { await model.installAgentHook(name) }
                                    }
                                    Button("Uninstall \(name.capitalized) Hook", role: .destructive) {
                                        Task { await model.uninstallAgentHook(name) }
                                    }
                                }
                                .font(.caption)
                            } else {
                                Text("Hook install coming later")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(Color.secondary.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
            }
        }
    }

}
