import AgentVoiceCore
import SwiftUI

struct DashboardView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                errorBanner
                daemonCard
                kokoroCard
                queueCards
                recentEventsSection
                failedJobsSection
                agentGridSection
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
        }
        .frame(minWidth: 820, minHeight: 620)
        .task {
            await model.refresh()
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Agent Voice Dashboard")
                    .font(.largeTitle.bold())
                Text(model.status?.ui.state.displayName ?? "Status unavailable")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Refresh") {
                Task { await model.refresh() }
            }
        }
    }

    @ViewBuilder
    private var errorBanner: some View {
        if let lastError = model.lastError {
            card("Last error") {
                Text(lastError)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }
        }
    }

    private var daemonCard: some View {
        card("Daemon") {
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
                Button("Start") {
                    Task { await model.startDaemon() }
                }
                Button("Stop") {
                    Task { await model.stopDaemon() }
                }
            }
        }
    }

    private var kokoroCard: some View {
        card("Kokoro and config") {
            labeledRow("Kokoro script", "Not exposed by current CLI yet")
            labeledRow("Voice", "Not exposed by current CLI yet")
            labeledRow("Agent Voice home", model.status?.paths.home ?? "Unknown")
            labeledRow("Config", model.status?.paths.config ?? "Unknown")
            labeledRow("Queue database", model.status?.paths.db ?? "Unknown")
            Button("Run Voice Test") {
                Task { await model.testVoice() }
            }
        }
    }

    @ViewBuilder
    private var queueCards: some View {
        if let queues = model.status?.queues {
            card("Queue") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 120))], spacing: 12) {
                    queueCount("Pending", queues.pending)
                    queueCount("Processing", queues.processing)
                    queueCount("Done", queues.done)
                    queueCount("Failed", queues.failed)
                    queueCount("Skipped", queues.skipped)
                }
            }
        } else {
            card("Queue") {
                Text("Queue counts unavailable")
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var recentEventsSection: some View {
        card("Recent events") {
            if let history = model.history {
                let jobs = history.jobs.filter { $0.status == .done }
                if jobs.isEmpty {
                    Text("No recent done events.")
                        .foregroundStyle(.secondary)
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(jobs) { job in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(job.summary ?? "No summary recorded")
                                    .font(.headline)
                                Text("\(job.agent) · \(job.finishedAt ?? job.createdAt)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } else {
                Text("History unavailable")
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var failedJobsSection: some View {
        card("Failed jobs") {
            if let history = model.history {
                let jobs = history.jobs.filter { $0.status == .failed }
                if jobs.isEmpty {
                    Text("No failed jobs.")
                        .foregroundStyle(.secondary)
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(jobs) { job in
                            VStack(alignment: .leading, spacing: 3) {
                                Text("\(job.agent) failed")
                                    .font(.headline)
                                Text(job.lastError ?? "No error exposed by current CLI yet")
                                    .foregroundStyle(.secondary)
                                Text("Attempts: \(job.attempts) · \(job.finishedAt ?? job.createdAt)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } else {
                Text("History unavailable")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var agentGridSection: some View {
        card("Agents") {
            let agents = model.status?.config.agents ?? [:]
            if agents.isEmpty {
                Text("Agent config unavailable")
                    .foregroundStyle(.secondary)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 180))], spacing: 12) {
                    ForEach(agents.keys.sorted(), id: \.self) { name in
                        let agent = agents[name]
                        VStack(alignment: .leading, spacing: 4) {
                            Text(name.capitalized)
                                .font(.headline)
                            Text(agent?.enabled == true ? "Enabled" : "Disabled")
                            Text(agent?.mode ?? "Not exposed by current CLI yet")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(Color.secondary.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
            }
        }
    }

    private func queueCount(_ title: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(String(value))
                .font(.title2.bold())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func card<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.title3.bold())
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func labeledRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .textSelection(.enabled)
        }
        .font(.subheadline)
    }
}
