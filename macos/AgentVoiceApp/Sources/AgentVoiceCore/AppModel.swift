import Combine
import Foundation

@MainActor
public final class AppModel: ObservableObject {
    @Published public private(set) var status: AgentVoiceStatusSnapshot?
    @Published public private(set) var history: AgentVoiceHistorySnapshot?
    @Published public private(set) var doctorReport: DoctorReport?
    @Published public private(set) var lastError: String?

    public let cli: AgentVoiceCLI

    public init(cli: AgentVoiceCLI? = nil) {
        if let cli {
            self.cli = cli
        } else {
            let settings = AppSettings.defaultSettings()
            self.cli = AgentVoiceCLI(executableURL: settings.executableURL, agentVoiceHome: settings.agentVoiceHome)
        }
    }

    public func refresh() async {
        do {
            status = try await cli.status()
            history = try await cli.history(limit: 50)
            doctorReport = try await cli.doctor()
            lastError = nil
        } catch {
            lastError = String(describing: error)
        }
    }

    public func pause() async {
        await perform { try await cli.pause() }
    }

    public func resume() async {
        await perform { try await cli.resume() }
    }

    public func startDaemon() async {
        await perform { try await cli.startDaemon() }
    }

    public func stopDaemon() async {
        await perform { try await cli.stopDaemon() }
    }

    public func testVoice() async {
        await perform { try await cli.runVoiceTest("Agent Voice test.") }
    }

    public func setSummarizerMode(_ mode: String) async {
        await perform { try await cli.setSummarizerMode(mode) }
    }

    private func perform(_ operation: () async throws -> Void) async {
        do {
            try await operation()
            await refresh()
        } catch {
            lastError = String(describing: error)
        }
    }
}
