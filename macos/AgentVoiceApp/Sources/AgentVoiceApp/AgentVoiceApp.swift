import AgentVoiceCore
import SwiftUI

@main
struct AgentVoiceApplication: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        MenuBarExtra("Agent Voice", systemImage: "waveform.circle") {
            MenuBarSentinelView(model: model)
        }

        WindowGroup("Dashboard", id: "dashboard") {
            VStack(alignment: .leading, spacing: 8) {
                Text("Agent Voice Dashboard")
                    .font(.title2)
                Text(model.status?.ui.state.displayName ?? "Status unavailable")
                    .foregroundStyle(.secondary)
            }
            .padding()
            .task {
                await model.refresh()
            }
        }

        WindowGroup("Setup", id: "setup") {
            VStack(alignment: .leading, spacing: 8) {
                Text("Agent Voice Setup")
                    .font(.title2)
                Text("Setup assistant coming next.")
                    .foregroundStyle(.secondary)
            }
            .padding()
        }
    }
}
