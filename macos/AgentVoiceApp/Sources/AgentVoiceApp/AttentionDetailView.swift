import AgentVoiceCore
import SwiftUI

struct AttentionDetailView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Attention details")
                    .font(.largeTitle.bold())
                    .accessibilityAddTraits(.isHeader)

                attentionMessagesSection
                doctorIssuesSection
                failedJobsSection
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
        }
        .frame(minWidth: 620, minHeight: 480)
        .onAppear { model.startAutoRefresh() }
        .onDisappear { model.stopAutoRefresh() }
    }
}

private extension AttentionDetailView {
    var attentionMessages: [String] {
        model.status?.ui.attention ?? []
    }

    var doctorIssues: [DoctorCheck] {
        model.doctorReport?.checks.filter {
            !$0.ok || $0.severity == .warning || $0.severity == .error
        } ?? []
    }

    var failedJobs: [AgentVoiceHistoryJob] {
        model.history?.jobs.filter { $0.status == .failed } ?? []
    }

    @ViewBuilder
    var attentionMessagesSection: some View {
        detailCard("Attention messages", systemImage: "bell.badge.fill", tint: .orange) {
            if model.status == nil {
                emptyState("Status unavailable. Refresh the dashboard and try again.")
            } else if attentionMessages.isEmpty {
                emptyState("No active attention messages.")
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(attentionMessages, id: \.self) { message in
                        Label(message, systemImage: "exclamationmark.circle.fill")
                            .foregroundStyle(.orange)
                            .textSelection(.enabled)
                    }
                }
            }
        }
    }

    @ViewBuilder
    var doctorIssuesSection: some View {
        detailCard("Doctor checks needing review", systemImage: "stethoscope", tint: doctorIssues.isEmpty ? .green : .orange) {
            if model.doctorReport == nil {
                emptyState("Diagnostics unavailable. Run doctor or refresh the dashboard.")
            } else if doctorIssues.isEmpty {
                emptyState("No doctor checks currently need review.")
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(doctorIssues) { check in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Image(systemName: check.ok ? "info.circle" : "exclamationmark.triangle.fill")
                                Text(check.message)
                                    .textSelection(.enabled)
                            }
                            .foregroundStyle(severityTint(check.severity))
                            Text("Severity: \(check.severity.rawValue)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                            if let action = check.action, !action.isEmpty {
                                Text(action)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .textSelection(.enabled)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }

    @ViewBuilder
    var failedJobsSection: some View {
        detailCard("Failed jobs and recent errors", systemImage: "xmark.octagon", tint: failedJobs.isEmpty ? .green : .red) {
            if model.history == nil {
                emptyState("History unavailable. Refresh the dashboard and try again.")
            } else if failedJobs.isEmpty {
                emptyState("No failed jobs in recent history.")
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(failedJobs) { job in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(job.agent.capitalized) failed")
                                .font(.headline)
                            Text(job.lastError ?? "No error exposed by current CLI yet")
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                            Text("Attempts: \(job.attempts) · \(job.finishedAt ?? job.createdAt)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if let cwd = job.cwd, !cwd.isEmpty {
                                Text(cwd)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .textSelection(.enabled)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
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
