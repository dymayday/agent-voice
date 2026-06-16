import Combine
import Foundation

@MainActor
public final class AppModel: ObservableObject {
    @Published public private(set) var status: AgentVoiceStatusSnapshot?
    @Published public private(set) var history: AgentVoiceHistorySnapshot?
    @Published public private(set) var doctorReport: DoctorReport?
    @Published public private(set) var config: AgentVoiceFullConfig?
    @Published public private(set) var lastError: String?
    @Published public var draftVoice: String = ""
    @Published public var draftThinking: String = "off"

    public static let defaultAutoRefreshIntervalNanoseconds: UInt64 = 5_000_000_000

    var autoRefreshSubscriberCount = 0
    var isAutoRefreshRunning: Bool { autoRefreshTask != nil }

    private var autoRefreshTask: Task<Void, Never>?

    public static let kokoroVoicePresets = [
        "af_heart",
        "af_sky",
        "af_bella",
        "af_nicole",
        "am_adam",
        "am_michael",
        "bf_emma",
        "bm_george"
    ]

    public static let summarizerThinkingOptions = ["off", "minimal", "low", "medium", "high", "xhigh"]

    public let cli: AgentVoiceCLI

    public init(cli: AgentVoiceCLI? = nil) {
        if let cli {
            self.cli = cli
        } else {
            let settings = AppSettings.defaultSettings()
            self.cli = AgentVoiceCLI(executableURL: settings.executableURL, agentVoiceHome: settings.agentVoiceHome)
        }
    }

    deinit {
        autoRefreshTask?.cancel()
    }

    public func refresh() async {
        do {
            status = try await cli.status()
            history = try await cli.history(limit: 50)
            doctorReport = try await cli.doctor()
            config = try await cli.config()
            draftVoice = config?.tts.voice ?? ""
            draftThinking = config?.summarizer.thinking ?? "off"
            lastError = nil
        } catch {
            lastError = String(describing: error)
        }
    }

    public func startAutoRefresh(
        everyNanoseconds intervalNanoseconds: UInt64 = AppModel.defaultAutoRefreshIntervalNanoseconds
    ) {
        autoRefreshSubscriberCount += 1
        guard autoRefreshTask == nil else { return }

        let intervalNanoseconds = max(intervalNanoseconds, 1_000_000)
        autoRefreshTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                do {
                    try await Task.sleep(nanoseconds: intervalNanoseconds)
                } catch {
                    break
                }
            }
        }
    }

    public func stopAutoRefresh() {
        guard autoRefreshSubscriberCount > 0 else { return }
        autoRefreshSubscriberCount -= 1

        if autoRefreshSubscriberCount == 0 {
            autoRefreshTask?.cancel()
            autoRefreshTask = nil
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

    public func stopDaemonBeforeQuit() async -> Bool {
        do {
            try await cli.stopDaemon()
            await refresh()
            return true
        } catch {
            lastError = String(describing: error)
            return false
        }
    }

    public func testVoice(_ text: String = "Agent Voice test.") async {
        await perform { try await cli.runVoiceTest(text) }
    }

    public func diagnosticSnapshotJSON() -> String {
        let snapshot = AgentVoiceDiagnosticSnapshot(
            statusState: status?.ui.state.rawValue,
            daemon: status.map {
                AgentVoiceDiagnosticSnapshot.Daemon(
                    state: $0.daemon.state.rawValue,
                    running: $0.daemon.running,
                    pid: $0.daemon.pid
                )
            },
            queues: status?.queues,
            attention: status?.ui.attention ?? [],
            doctorIssues: diagnosticDoctorIssues.map {
                AgentVoiceDiagnosticSnapshot.DoctorIssue(
                    id: $0.id,
                    severity: $0.severity.rawValue,
                    message: $0.message,
                    action: $0.action
                )
            },
            failedJobs: diagnosticFailedJobs.prefix(5).map {
                AgentVoiceDiagnosticSnapshot.FailedJob(
                    id: $0.id,
                    agent: $0.agent,
                    attempts: $0.attempts,
                    timestamp: $0.finishedAt ?? $0.createdAt,
                    lastError: $0.lastError
                )
            },
            paths: status.map {
                AgentVoiceDiagnosticSnapshot.Paths(
                    home: $0.paths.home,
                    config: $0.paths.config,
                    queueDatabase: $0.paths.db
                )
            }
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard
            let data = try? encoder.encode(snapshot),
            let json = String(data: data, encoding: .utf8)
        else {
            return "{}"
        }
        return json
    }

    public func setSummarizerMode(_ mode: String) async {
        await perform { try await cli.setSummarizerMode(mode) }
    }

    public func clearQueue() async {
        await perform { try await cli.clearQueue() }
    }

    public func saveVoice() async {
        let voice = draftVoice.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !voice.isEmpty else {
            lastError = "Voice cannot be empty"
            return
        }
        await perform { try await cli.setVoice(voice) }
    }

    public func saveThinking() async {
        let thinking = draftThinking.trimmingCharacters(in: .whitespacesAndNewlines)
        guard Self.summarizerThinkingOptions.contains(thinking) else {
            lastError = "Unsupported summarizer thinking effort"
            return
        }
        await perform { try await cli.setSummarizerThinking(thinking) }
    }

    public func installAgentHook(_ agent: String) async {
        await perform { try await cli.installAgentHook(agent) }
    }

    public func uninstallAgentHook(_ agent: String) async {
        await perform { try await cli.uninstallAgentHook(agent) }
    }

    private var diagnosticDoctorIssues: [DoctorCheck] {
        doctorReport?.checks.filter {
            !$0.ok || $0.severity == .warning || $0.severity == .error
        } ?? []
    }

    private var diagnosticFailedJobs: [AgentVoiceHistoryJob] {
        history?.jobs.filter { $0.status == .failed } ?? []
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

private struct AgentVoiceDiagnosticSnapshot: Encodable {
    let statusState: String?
    let daemon: Daemon?
    let queues: QueueCounts?
    let attention: [String]
    let doctorIssues: [DoctorIssue]
    let failedJobs: [FailedJob]
    let paths: Paths?

    struct Daemon: Encodable {
        let state: String
        let running: Bool
        let pid: Int?
    }

    struct DoctorIssue: Encodable {
        let id: String
        let severity: String
        let message: String
        let action: String?
    }

    struct FailedJob: Encodable {
        let id: String
        let agent: String
        let attempts: Int
        let timestamp: String
        let lastError: String?
    }

    struct Paths: Encodable {
        let home: String
        let config: String
        let queueDatabase: String
    }
}
