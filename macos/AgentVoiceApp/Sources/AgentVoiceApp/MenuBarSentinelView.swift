import AgentVoiceCore
import AppKit
import SwiftUI

struct MenuBarSentinelView: View {
    @ObservedObject var model: AppModel
    var quitApplication: () -> Void = { NSApplication.shared.terminate(nil) }
    @Environment(\.openWindow) private var openWindow
    @State private var localActionError: String?

    private let actionColumns = [
        GridItem(.flexible(), spacing: 8),
        GridItem(.flexible(), spacing: 8)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            errorBanner
            attentionBanner
            queueOverview
            latestSummary
            Divider()
            controls
            Divider()
            footer
        }
        .padding(14)
        .frame(width: 340)
        .onAppear { model.startAutoRefresh() }
        .onDisappear { model.stopAutoRefresh() }
        // The popover is a visible surface that window-occlusion does not track,
        // so signal it explicitly to keep refreshing while all windows are closed.
        .onAppear { model.setMenuPopoverOpen(true) }
        .onDisappear { model.setMenuPopoverOpen(false) }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 10) {
            menuHeaderStatusIcon

            VStack(alignment: .leading, spacing: 2) {
                Text("Agent Voice")
                    .font(.headline)
                Text(statusSubtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            Text(model.status?.ui.state.displayName ?? "Unknown")
                .font(.caption.weight(.semibold))
                .foregroundStyle(statusTint)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(statusTint.opacity(0.12))
                .clipShape(Capsule())
        }
    }

    @ViewBuilder
    private var errorBanner: some View {
        if let lastError = surfacedError {
            card(tint: .red) {
                VStack(alignment: .leading, spacing: 6) {
                    Label("Last error", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.red)
                    Text(lastError)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(4)
                        .textSelection(.enabled)
                }
            }
        }
    }

    @ViewBuilder
    private var attentionBanner: some View {
        if let attention = model.status?.ui.attention, !attention.isEmpty {
            Button {
                openAttentionDetails()
            } label: {
                card(tint: .orange) {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Needs attention", systemImage: "bell.badge.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.orange)
                        Text(attention.joined(separator: "\n"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
                        Text("Open details")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open attention details")
            .accessibilityValue("\(attention.count) attention \(attention.count == 1 ? "message" : "messages")")
        }
    }

    @ViewBuilder
    private var queueOverview: some View {
        if let queues = model.status?.queues {
            card {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        sectionTitle("Queue")
                        Spacer()
                        Text(activeQueueLabel(for: queues))
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                    }

                    LazyVGrid(columns: actionColumns, alignment: .leading, spacing: 8) {
                        queueMetric("Pending", queues.pending, tint: .orange)
                        queueMetric("Processing", queues.processing, tint: .blue)
                        queueMetric("Done", queues.done, tint: .green)
                        queueMetric("Failed", queues.failed, tint: .red)
                    }

                    if queues.skipped > 0 {
                        HStack(spacing: 6) {
                            Image(systemName: "forward.end.fill")
                            Text("Skipped: \(queues.skipped)")
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                }
            }
        } else {
            card {
                Text("Queue counts unavailable")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var latestSummary: some View {
        if let job = latestDoneJob, let summary = job.summary, !summary.isEmpty {
            card {
                VStack(alignment: .leading, spacing: 6) {
                    sectionTitle("Latest spoken")
                    Text(summary)
                        .font(.subheadline)
                        .lineLimit(3)
                    Text("\(job.agent.capitalized) · \(job.finishedAt ?? job.createdAt)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("Controls")

            LazyVGrid(columns: actionColumns, spacing: 8) {
                actionButton("Refresh", systemImage: "arrow.clockwise") {
                    Task { await model.refresh() }
                }
                actionButton(daemonButtonTitle, systemImage: daemonButtonIcon) {
                    Task {
                        if model.status?.daemon.running == true {
                            await model.stopDaemon()
                        } else {
                            await model.startDaemon()
                        }
                    }
                }
                actionButton("Voice Test", systemImage: "speaker.wave.2.fill") {
                    Task { await model.testVoice() }
                }
                actionButton("Clear Queue", systemImage: "trash", role: .destructive, disabled: !canClearQueue) {
                    Task { await model.clearQueue() }
                }
                actionButton(
                    "Clear Failed Jobs",
                    systemImage: "xmark.octagon",
                    role: .destructive,
                    disabled: !canClearFailedQueue
                ) {
                    Task { await model.clearFailedJobs() }
                }
            }
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 10) {
            smartActionsMenu

            LazyVGrid(columns: actionColumns, spacing: 8) {
                actionButton("Dashboard", systemImage: "gauge") {
                    openDashboard()
                }
                actionButton("Setup", systemImage: "wrench.and.screwdriver") {
                    openSetup()
                }
            }

            actionButton("Quit Agent Voice", systemImage: "power", role: .destructive) {
                Task {
                    if await model.stopDaemonBeforeQuit() {
                        quitApplication()
                    }
                }
            }
        }
    }

    private var smartActionsMenu: some View {
        Menu {
            switch smartActionMenuMode {
            case .needsAttention:
                Button("Open Attention Details") {
                    openAttentionDetails()
                }
                if model.status?.daemon.running == false {
                    Button("Start Daemon") {
                        Task { await model.startDaemon() }
                    }
                }
            case .daemonStopped:
                Button("Start Daemon") {
                    Task { await model.startDaemon() }
                }
            case .unavailable:
                Button("Run Voice Test") {
                    Task { await model.testVoice() }
                }
            case .daily:
                if let summary = latestSummaryText {
                    Button("Replay Last Summary") {
                        Task { await model.testVoice(summary) }
                    }
                } else {
                    Button("No Summary to Replay") {}
                        .disabled(true)
                }
                Button("Run Voice Test") {
                    Task { await model.testVoice() }
                }
            }

            Divider()

            Button("Refresh Diagnostics") {
                Task { await model.refresh() }
            }

            Button("Open Setup") {
                openSetup()
            }

            Button("Copy Diagnostic Snapshot") {
                copyDiagnosticSnapshot()
            }

            if canRevealAgentVoiceHome {
                Button("Reveal Agent Voice Home") {
                    revealAgentVoiceHome()
                }
            } else {
                Button("Agent Voice Home Unavailable") {}
                    .disabled(true)
            }
        } label: {
            Label("Smart Actions", systemImage: "sparkles")
                .font(.caption.weight(.medium))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 8)
                .padding(.horizontal, 9)
                .background(Color.accentColor.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .menuStyle(.borderlessButton)
        .accessibilityLabel("Smart Actions")
        .accessibilityValue("Best next steps for current Agent Voice state")
    }

    private func openAttentionDetails() {
        openWindow(id: AgentVoiceWindowID.attention)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    private func openSetup() {
        openWindow(id: AgentVoiceWindowID.setup)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    private func openDashboard() {
        openWindow(id: AgentVoiceWindowID.dashboard)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    private func diagnosticSnapshotJSON() -> String {
        model.diagnosticSnapshotJSON()
    }

    private func copyDiagnosticSnapshot() {
        let pasteboard = NSPasteboard.general
        let previousString = pasteboard.string(forType: .string)
        pasteboard.clearContents()
        if pasteboard.setString(diagnosticSnapshotJSON(), forType: .string) {
            localActionError = nil
        } else {
            if let previousString {
                pasteboard.setString(previousString, forType: .string)
            }
            localActionError = "Could not copy diagnostic snapshot"
        }
    }

    private func revealAgentVoiceHome() {
        guard let homePath = model.status?.paths.home.trimmingCharacters(in: .whitespacesAndNewlines),
              !homePath.isEmpty
        else {
            localActionError = "Agent Voice home path unavailable"
            return
        }

        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: homePath, isDirectory: &isDirectory), isDirectory.boolValue else {
            localActionError = "Agent Voice home path does not exist: \(homePath)"
            return
        }

        let url = URL(fileURLWithPath: homePath, isDirectory: true)
        if NSWorkspace.shared.open(url) {
            localActionError = nil
        } else {
            localActionError = "Could not reveal Agent Voice home: \(homePath)"
        }
    }

}

extension MenuBarSentinelView {
    private var menuHeaderStatusIcon: some View {
        ZStack {
            Circle()
                .fill(statusTint.opacity(0.10))
            Circle()
                .stroke(statusTint.opacity(0.12), lineWidth: 6)
            Circle()
                .stroke(statusTint.opacity(0.78), lineWidth: 2)
            Image(systemName: "waveform")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(statusTint)
        }
        .frame(width: 40, height: 40)
        .accessibilityHidden(true)
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.secondary)
            .tracking(0.6)
    }

    private func queueMetric(_ title: String, _ value: Int, tint: Color) -> some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(tint.opacity(value > 0 ? 0.85 : 0.25))
                .frame(width: 4, height: 28)
            VStack(alignment: .leading, spacing: 1) {
                Text(String(value))
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(value > 0 ? tint : .primary)
                Text(title)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(nsColor: .textBackgroundColor).opacity(0.65))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func actionButton(
        _ title: String,
        systemImage: String,
        role: ButtonRole? = nil,
        disabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(role: role, action: action) {
            Label(title, systemImage: systemImage)
                .font(.caption.weight(.medium))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 8)
                .padding(.horizontal, 9)
                .background(Color(nsColor: .controlBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.45 : 1)
    }

    private func card<Content: View>(tint: Color? = nil, @ViewBuilder content: () -> Content) -> some View {
        content()
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(nsColor: .controlBackgroundColor).opacity(0.72))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke((tint ?? Color(nsColor: .separatorColor)).opacity(tint == nil ? 0.35 : 0.55), lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var surfacedError: String? {
        localActionError ?? model.lastError
    }

    private var smartActionMenuMode: SmartActionMenuMode {
        if hasAttentionWork {
            return .needsAttention
        }
        if model.status?.daemon.running == false {
            return .daemonStopped
        }
        if model.status == nil {
            return .unavailable
        }
        return .daily
    }

    private var hasAttentionWork: Bool {
        !(model.status?.ui.attention ?? []).isEmpty || !doctorIssues.isEmpty || !failedJobs.isEmpty
    }

    private var doctorIssues: [DoctorCheck] {
        model.doctorReport?.checks.filter(\.needsReview) ?? []
    }

    private var failedJobs: [AgentVoiceHistoryJob] {
        model.history?.jobs.filter { $0.status == .failed } ?? []
    }

    private var latestSummaryText: String? {
        latestDoneJob?.summary?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
    }

    private var canRevealAgentVoiceHome: Bool {
        model.status?.paths.home.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    private var latestDoneJob: AgentVoiceHistoryJob? {
        model.history?.jobs.first { $0.status == .done && ($0.summary?.isEmpty == false) }
    }

    private var canClearQueue: Bool {
        guard let queues = model.status?.queues else { return false }
        return queues.pending + queues.processing > 0
    }

    private var canClearFailedQueue: Bool {
        guard let queues = model.status?.queues else { return false }
        return queues.failed > 0
    }

    private var daemonButtonTitle: String {
        model.status?.daemon.running == true ? "Stop Daemon" : "Start Daemon"
    }

    private var daemonButtonIcon: String {
        model.status?.daemon.running == true ? "stop.fill" : "bolt.fill"
    }

    private var statusSubtitle: String {
        guard let status = model.status else { return "Status unavailable" }
        let active = status.queues.pending + status.queues.processing
        if active > 0 {
            return "\(active) active \(active == 1 ? "job" : "jobs")"
        }
        if status.daemon.running {
            return "Daemon running"
        }
        return "Daemon stopped"
    }

    private var statusTint: Color {
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

    private func activeQueueLabel(for queues: QueueCounts) -> String {
        let active = queues.pending + queues.processing
        if active == 0 { return "Idle" }
        return "\(active) active"
    }
}

private enum SmartActionMenuMode {
    case needsAttention
    case daemonStopped
    case unavailable
    case daily
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
