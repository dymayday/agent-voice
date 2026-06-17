import AgentVoiceCore
import SwiftUI

enum AgentVoiceWindowID {
    static let dashboard = "dashboard"
    static let setup = "setup"
    static let attention = "attention"
}

@main
struct AgentVoiceApplication: App {
    @NSApplicationDelegateAdaptor(AgentVoiceDockMenuDelegate.self) private var dockMenuDelegate
    @StateObject private var model: AppModel

    init() {
        let appModel = AppModel()
        _model = StateObject(wrappedValue: appModel)
        appModel.preloadSummarizerModels()
        AgentVoiceDockMenuDelegate.configure(model: appModel)
    }

    var body: some Scene {
        MenuBarExtra {
            MenuBarSentinelView(model: model)
        } label: {
            StatusBarIconLabel()
                .background(DockMenuWindowBridge())
        }
        .menuBarExtraStyle(.window)

        Window("Dashboard", id: AgentVoiceWindowID.dashboard) {
            DashboardView(model: model)
        }
        .defaultSize(width: 960, height: 720)

        Window("Attention", id: AgentVoiceWindowID.attention) {
            AttentionDetailView(model: model)
        }
        .defaultSize(width: 760, height: 620)

        WindowGroup("Setup", id: AgentVoiceWindowID.setup) {
            SetupAssistantView(model: model)
        }
    }
}

struct StatusBarIconLabel: View {
    var body: some View {
        Image(systemName: "waveform")
            .accessibilityLabel("Agent Voice")
    }
}

extension DashboardView {
    func queueMetric(_ title: String, _ value: Int, systemImage: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                Text(title)
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            Text(String(value))
                .font(.title2.bold().monospacedDigit())
                .foregroundStyle(value > 0 ? tint : .primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(tint.opacity(value > 0 ? 0.12 : 0.06))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title) jobs")
        .accessibilityValue(String(value))
    }

    func card<Content: View>(
        _ title: String,
        systemImage: String? = nil,
        tint: Color = .secondary,
        fillHeight: Bool = false,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .foregroundStyle(tint)
                }
                Text(title)
                    .font(.title3.bold())
                    .accessibilityAddTraits(.isHeader)
                Spacer()
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: fillHeight ? .infinity : nil, alignment: .topLeading)
        .background(.regularMaterial)
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(tint.opacity(0.26), lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    func labeledRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(value)
                .multilineTextAlignment(.trailing)
                .lineLimit(2)
                .textSelection(.enabled)
        }
        .font(.subheadline)
        .accessibilityElement(children: .combine)
    }

    var canClearQueue: Bool {
        guard let queues = model.status?.queues else { return false }
        return queues.pending + queues.processing > 0
    }

    var canClearFailedQueue: Bool {
        guard let queues = model.status?.queues else { return false }
        return queues.failed > 0
    }

    var doctorIssues: [DoctorCheck] {
        model.doctorReport?.checks.filter {
            !$0.ok || $0.severity == .warning || $0.severity == .error
        } ?? []
    }

    var failedJobs: [AgentVoiceHistoryJob] {
        model.history?.jobs.filter { $0.status == .failed } ?? []
    }

    var recentDoneJobs: [AgentVoiceHistoryJob] {
        model.history?.jobs.filter { $0.status == .done } ?? []
    }

    var statusSubtitle: String {
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

    var canClearWarningState: Bool {
        guard model.status != nil else { return false }

        if model.status?.ui.attention.contains("failed_jobs") == true {
            return true
        }
        if model.status?.ui.attention.contains("system_paused") == true {
            return true
        }
        if model.status?.ui.attention.contains("stale_daemon_lock") == true {
            return true
        }
        if model.status?.ui.state == .daemonStopped {
            return true
        }

        return model.doctorReport?.checks.contains {
            (!$0.ok && $0.id == "daemon.running") || (!$0.ok && $0.id == "queue.failed.empty")
        } == true
    }

    func queueTint(for queues: QueueCounts) -> Color {
        if queues.failed > 0 { return .red }
        if queues.pending + queues.processing > 0 { return .blue }
        return .green
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
