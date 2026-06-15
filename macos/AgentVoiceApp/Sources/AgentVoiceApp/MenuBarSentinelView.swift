import AgentVoiceCore
import SwiftUI

struct MenuBarSentinelView: View {
    @ObservedObject var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            queueCounts
            Divider()
            controls
            if let lastError = model.lastError {
                Divider()
                Text(lastError)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }
        }
        .padding(12)
        .frame(width: 280)
        .task {
            await model.refresh()
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Agent Voice")
                .font(.headline)
            Text(model.status?.ui.state.displayName ?? "Unknown")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var queueCounts: some View {
        if let queues = model.status?.queues {
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
                GridRow {
                    queueLabel("Pending", queues.pending)
                    queueLabel("Processing", queues.processing)
                }
                GridRow {
                    queueLabel("Done", queues.done)
                    queueLabel("Failed", queues.failed)
                }
                GridRow {
                    queueLabel("Skipped", queues.skipped)
                    Spacer()
                }
            }
        } else {
            Text("Queue counts unavailable")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func queueLabel(_ title: String, _ value: Int) -> some View {
        HStack(spacing: 4) {
            Text(title)
                .foregroundStyle(.secondary)
            Text(String(value))
                .fontWeight(value > 0 ? .semibold : .regular)
        }
        .font(.caption)
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button("Refresh") {
                Task { await model.refresh() }
            }
            HStack {
                Button("Pause") {
                    Task { await model.pause() }
                }
                Button("Resume") {
                    Task { await model.resume() }
                }
            }
            HStack {
                Button("Start Daemon") {
                    Task { await model.startDaemon() }
                }
                Button("Stop Daemon") {
                    Task { await model.stopDaemon() }
                }
            }
            Button("Run Voice Test") {
                Task { await model.testVoice() }
            }
            HStack {
                Button("Open Dashboard") {
                    openWindow(id: "dashboard")
                }
                Button("Open Setup") {
                    openWindow(id: "setup")
                }
            }
        }
        .buttonStyle(.borderless)
    }
}
