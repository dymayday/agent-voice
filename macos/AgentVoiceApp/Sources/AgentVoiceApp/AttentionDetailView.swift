import AgentVoiceCore
import AppKit
import SwiftUI

struct AttentionDetailView: View {
    @ObservedObject var model: AppModel
    @State private var copyFeedback: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Diagnostics")
                    .font(.largeTitle.bold())
                    .accessibilityAddTraits(.isHeader)

                healthSummarySection
                runtimeSection
                queueSummarySection
                configurationSection
                doctorChecksSection
                rawSnapshotSection
                recentJobsSection
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
        }
        .frame(minWidth: 760, minHeight: 620)
        .onAppear { model.startAutoRefresh() }
        .onDisappear { model.stopAutoRefresh() }
    }
}

private extension AttentionDetailView {
    var attentionMessages: [String] {
        model.status?.ui.attention ?? []
    }

    var allDoctorChecks: [DoctorCheck] {
        model.doctorReport?.checks ?? []
    }

    var doctorIssues: [DoctorCheck] {
        allDoctorChecks.filter {
            !$0.ok || $0.severity == .warning || $0.severity == .error
        }
    }

    var recentJobs: [AgentVoiceHistoryJob] {
        model.history?.jobs ?? []
    }

    var failedJobs: [AgentVoiceHistoryJob] {
        recentJobs.filter { $0.status == .failed }
    }

    @ViewBuilder
    var healthSummarySection: some View {
        detailCard("Health summary", systemImage: "heart.text.square", tint: statusTint) {
            VStack(alignment: .leading, spacing: 12) {
                labeledRow("UI state", model.status?.ui.state.displayName ?? "Unknown", valueTint: statusTint)
                labeledRow("Daemon", daemonSummary, valueTint: daemonTint)

                if let queues = model.status?.queues {
                    labeledRow("Queue pressure", queuePressureSummary(queues), valueTint: queueTint(for: queues))
                } else {
                    labeledRow("Queue pressure", "Queue counts unavailable")
                }

                if attentionMessages.isEmpty {
                    emptyState("No active attention messages.")
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Attention messages")
                            .font(.headline)
                        ForEach(attentionMessages, id: \.self) { message in
                            Label(message, systemImage: "exclamationmark.circle.fill")
                                .foregroundStyle(.orange)
                                .textSelection(.enabled)
                        }
                    }
                }

                if let lastError = model.lastError, !lastError.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Last app error")
                            .font(.headline)
                        diagnosticTextBlock(lastError)
                    }
                }
            }
        }
    }

    @ViewBuilder
    var runtimeSection: some View {
        detailCard("Runtime and paths", systemImage: "terminal", tint: daemonTint) {
            VStack(alignment: .leading, spacing: 12) {
                if let daemon = model.status?.daemon {
                    labeledRow("Daemon state", daemon.state.rawValue)
                    labeledRow("Daemon running", daemon.running ? "Yes" : "No", valueTint: daemon.running ? .green : .orange)
                    labeledRow("Daemon PID", daemon.pid.map(String.init) ?? "None")
                } else {
                    labeledRow("Daemon state", "Status unavailable")
                    labeledRow("Daemon running", "Unknown")
                    labeledRow("Daemon PID", "Unknown")
                }

                labeledRow("CLI executable", model.cli.executableURL.path)
                labeledRow("CLI home override", model.cli.agentVoiceHome?.path ?? "Not set")
                labeledRow("Agent Voice home", model.status?.paths.home ?? "Unknown")
                labeledRow("Config path", model.status?.paths.config ?? "Unknown")
                labeledRow("Queue database", model.status?.paths.db ?? "Unknown")
            }
        }
    }

    @ViewBuilder
    var queueSummarySection: some View {
        detailCard("Queue summary", systemImage: "tray.full", tint: queueActivityTint) {
            VStack(alignment: .leading, spacing: 12) {
                if let queues = model.status?.queues {
                    labeledRow("Pending", String(queues.pending), valueTint: queues.pending > 0 ? .orange : .primary)
                    labeledRow("Processing", String(queues.processing), valueTint: queues.processing > 0 ? .blue : .primary)
                    labeledRow("Done", String(queues.done), valueTint: .green)
                    labeledRow("Failed", String(queues.failed), valueTint: queues.failed > 0 ? .red : .primary)
                    labeledRow("Skipped", String(queues.skipped), valueTint: queues.skipped > 0 ? .secondary : .primary)

                    HStack {
                        Text("Queue actions")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        Spacer()

                        Button("Clear Failed Jobs", role: .destructive) {
                            Task { await model.clearFailedJobs() }
                        }
                        .disabled(queues.failed == 0)
                    }
                    .accessibilityElement(children: .combine)
                } else {
                    emptyState("Queue counts unavailable. Refresh diagnostics to load queue state.")
                }
            }
        }
    }

    @ViewBuilder
    var configurationSection: some View {
        detailCard("Configuration context", systemImage: "slider.horizontal.3", tint: .teal) {
            VStack(alignment: .leading, spacing: 16) {
                if let statusConfig = model.status?.config {
                    labeledRow("Global enabled", statusConfig.enabled ? "Yes" : "No", valueTint: statusConfig.enabled ? .green : .orange)
                } else {
                    labeledRow("Global enabled", "Unknown")
                }

                if let config = model.config {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("TTS")
                            .font(.headline)
                        labeledRow("Voice", config.tts.voice)
                        labeledRow("Kokoro script", config.tts.kokoroScript)
                        labeledRow("Python", config.tts.python)
                        labeledRow("Timeout seconds", String(config.tts.timeoutSeconds))
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Summarizer")
                            .font(.headline)
                        labeledRow("Thinking", config.summarizer.thinking)
                    }
                } else {
                    emptyState("Full config unavailable. Refresh diagnostics to load TTS and summarizer settings.")
                }

                Divider()

                VStack(alignment: .leading, spacing: 12) {
                    Text("Agents")
                        .font(.headline)

                    let agents = model.status?.config.agents ?? [:]
                    if agents.isEmpty {
                        emptyState("Agent config unavailable.")
                    } else {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(agents.keys.sorted(), id: \.self) { name in
                                let agent = agents[name]
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(name.capitalized)
                                        .font(.subheadline.bold())
                                    labeledRow("Enabled", agent?.enabled == true ? "Yes" : "No", valueTint: agent?.enabled == true ? .green : .secondary)
                                    labeledRow("Mode", agent?.mode ?? "Unknown")
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
    }

    @ViewBuilder
    var doctorChecksSection: some View {
        detailCard("Doctor checks", systemImage: "stethoscope", tint: doctorIssues.isEmpty ? .green : .orange) {
            VStack(alignment: .leading, spacing: 12) {
                if model.doctorReport == nil {
                    emptyState("Diagnostics unavailable. Refresh diagnostics to load doctor checks.")
                } else if allDoctorChecks.isEmpty {
                    emptyState("No doctor checks returned.")
                } else {
                    Text("\(allDoctorChecks.count) total checks · \(doctorIssues.count) needing review")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)

                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(allDoctorChecks) { check in
                            doctorCheckCard(check)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    var rawSnapshotSection: some View {
        detailCard("Raw diagnostic snapshot", systemImage: "doc.text.magnifyingglass", tint: .purple) {
            VStack(alignment: .leading, spacing: 12) {
                Label(
                    "Includes full raw job text for loaded jobs only. Copy uses the local pasteboard only.",
                    systemImage: "exclamationmark.triangle.fill"
                )
                .font(.caption)
                .foregroundStyle(.orange)
                .textSelection(.enabled)

                HStack(spacing: 10) {
                    Button("Copy Raw Snapshot") {
                        copyRawSnapshot()
                    }

                    if let copyFeedback {
                        Text(copyFeedback)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                }

                diagnosticTextBlock(model.diagnosticSnapshotJSON())
            }
        }
    }

    @ViewBuilder
    var recentJobsSection: some View {
        detailCard("Recent jobs", systemImage: "clock.arrow.circlepath", tint: failedJobs.isEmpty ? .blue : .red) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text("Recent jobs")
                        .font(.headline)
                    Spacer()
                    Text("\(recentJobs.count) loaded jobs · \(failedJobs.count) failed")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button("Refresh history") {
                        Task { await model.refreshHistory() }
                    }
                    .disabled(model.isLoadingHistoryPage)
                }

                Text("Newest jobs refresh when terminal queue counts change. Raw snapshots include loaded jobs only.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)

                if model.history == nil {
                    emptyState("History unavailable. Refresh diagnostics to load recent jobs.")
                } else if recentJobs.isEmpty {
                    emptyState("No recent jobs in history.")
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(recentJobs) { job in
                            jobCard(job)
                        }

                        if model.history?.pageInfo.hasMore == true {
                            Button(model.isLoadingHistoryPage ? "Loading…" : "Load more") {
                                Task { await model.loadMoreHistory() }
                            }
                            .disabled(model.isLoadingHistoryPage)
                        } else {
                            Text("No more loaded history pages.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    }
                }
            }
        }
    }

    func jobCard(_ job: AgentVoiceHistoryJob) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text(job.agent.capitalized)
                        .font(.headline)
                    Spacer()
                    Text(job.status.rawValue.capitalized)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(jobStatusTint(job.status))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(jobStatusTint(job.status).opacity(0.12))
                        .clipShape(Capsule())
                        .textSelection(.enabled)
                }

                labeledRow("Job ID", job.id)
                labeledRow("Created", job.createdAt)
                labeledRow("Finished", job.finishedAt ?? "Not finished")
                labeledRow("Attempts", String(job.attempts))
                labeledRow("Working directory", job.cwd ?? "None")
                labeledRow("Summarizer used", job.summarizerUsed ?? "None")
                labeledRow("Skip reason", job.skipReason ?? "None")

                VStack(alignment: .leading, spacing: 6) {
                    Text("Summary")
                        .font(.subheadline.bold())
                    diagnosticTextBlock(job.summary ?? "No summary recorded")
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("Last error")
                        .font(.subheadline.bold())
                    diagnosticTextBlock(job.lastError ?? "No error recorded")
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("Full raw job text")
                        .font(.subheadline.bold())
                    diagnosticTextBlock(job.text.isEmpty ? "No raw job text recorded" : job.text)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 300)
        .background(jobStatusTint(job.status).opacity(0.08))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(jobStatusTint(job.status).opacity(0.24), lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    func doctorCheckCard(_ check: DoctorCheck) -> some View {
        let needsReview = !check.ok || check.severity == .warning || check.severity == .error
        let tint = needsReview ? severityTint(check.severity) : .green

        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Label(check.message, systemImage: needsReview ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                    .font(.headline)
                    .foregroundStyle(tint)
                    .textSelection(.enabled)
                Spacer()
                Text(needsReview ? "Needs review" : "Passing")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(tint)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(tint.opacity(0.12))
                    .clipShape(Capsule())
            }

            labeledRow("ID", check.id)
            labeledRow("Status", check.ok ? "OK" : "Failed", valueTint: check.ok ? .green : .red)
            labeledRow("Severity", check.severity.rawValue, valueTint: severityTint(check.severity))
            labeledRow("Action", check.action?.isEmpty == false ? check.action! : "None")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(tint.opacity(needsReview ? 0.10 : 0.06))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(tint.opacity(needsReview ? 0.34 : 0.18), lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    func copyRawSnapshot() {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        if pasteboard.setString(model.diagnosticSnapshotJSON(), forType: .string) {
            copyFeedback = "Copied to local pasteboard."
        } else {
            copyFeedback = "Copy failed."
        }
    }

    func labeledRow(_ title: String, _ value: String, valueTint: Color = .primary) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(value)
                .multilineTextAlignment(.trailing)
                .foregroundStyle(valueTint)
                .textSelection(.enabled)
        }
        .font(.subheadline)
        .accessibilityElement(children: .combine)
    }

    func diagnosticTextBlock(_ text: String) -> some View {
        Text(text)
            .font(.system(.body, design: .monospaced))
            .foregroundStyle(.primary)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(Color.secondary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    func detailCard<Content: View>(
        _ title: String,
        systemImage: String,
        tint: Color,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: systemImage)
                .font(.title3.bold())
                .foregroundStyle(tint)
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.regularMaterial)
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(tint.opacity(0.26), lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    func emptyState(_ message: String) -> some View {
        Text(message)
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
    }

    var daemonSummary: String {
        guard let daemon = model.status?.daemon else { return "Unknown" }
        let pid = daemon.pid.map { "pid \($0)" } ?? "no pid"
        return "\(daemon.state.rawValue) · \(daemon.running ? "running" : "not running") · \(pid)"
    }

    var statusTint: Color {
        switch model.status?.ui.state {
        case .ready:
            .green
        case .processing:
            .blue
        case .paused:
            .orange
        case .needsAttention:
            .red
        case .daemonStopped, .none:
            .secondary
        }
    }

    var daemonTint: Color {
        model.status?.daemon.running == true ? .green : .orange
    }

    var queueActivityTint: Color {
        guard let queues = model.status?.queues else { return .secondary }
        return queueTint(for: queues)
    }

    func queuePressureSummary(_ queues: QueueCounts) -> String {
        let active = queues.pending + queues.processing
        if queues.failed > 0 {
            return "\(queues.failed) failed · \(active) active"
        }
        if active > 0 {
            return "\(active) active"
        }
        return "No pending or processing jobs"
    }

    func queueTint(for queues: QueueCounts) -> Color {
        if queues.failed > 0 { return .red }
        if queues.pending + queues.processing > 0 { return .blue }
        return .green
    }

    func jobStatusTint(_ status: HistoryJobStatus) -> Color {
        switch status {
        case .done:
            .green
        case .failed:
            .red
        case .skipped:
            .secondary
        }
    }

    func severityTint(_ severity: DoctorCheck.Severity) -> Color {
        switch severity {
        case .info:
            .blue
        case .warning:
            .orange
        case .error:
            .red
        }
    }
}
