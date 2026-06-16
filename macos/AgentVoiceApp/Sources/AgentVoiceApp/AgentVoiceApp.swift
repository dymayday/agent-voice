import AgentVoiceCore
import SwiftUI

@main
struct AgentVoiceApplication: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        MenuBarExtra("Agent Voice", systemImage: "waveform.circle") {
            MenuBarSentinelView(model: model)
        }
        .menuBarExtraStyle(.window)

        WindowGroup("Dashboard", id: "dashboard") {
            DashboardView(model: model)
        }

        WindowGroup("Setup", id: "setup") {
            SetupAssistantView(model: model)
        }
    }
}
