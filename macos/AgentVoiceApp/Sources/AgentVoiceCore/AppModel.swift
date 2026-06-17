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

    public static let defaultAutoRefreshIntervalNanoseconds: UInt64 = 2_000_000_000

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
        var errors: [String] = []

        do {
            status = try await cli.status()
        } catch {
            errors.append("status: \(String(describing: error))")
        }

        do {
            history = try await cli.history(limit: 50)
        } catch {
            errors.append("history: \(String(describing: error))")
        }

        do {
            doctorReport = try await cli.doctor()
        } catch {
            errors.append("doctor: \(String(describing: error))")
        }

        do {
            let refreshedConfig = try await cli.config()
            config = refreshedConfig
            draftVoice = refreshedConfig.tts.voice
            draftThinking = refreshedConfig.summarizer.thinking
        } catch {
            errors.append("config: \(String(describing: error))")
        }

        lastError = errors.isEmpty ? nil : errors.joined(separator: "\n")
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
            status: status,
            history: history,
            doctorReport: doctorReport,
            config: config,
            executablePath: cli.executableURL.path,
            agentVoiceHome: cli.agentVoiceHome?.path,
            lastError: lastError
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
    private let statusState: String?
    private let daemon: Daemon?
    private let queues: QueueCounts?
    private let attention: [String]
    private let doctorChecks: [DiagnosticDoctorCheck]
    private let doctorIssues: [DiagnosticDoctorCheck]
    private let recentJobs: [DiagnosticJob]
    private let failedJobs: [DiagnosticJob]
    private let paths: Paths?
    private let config: DiagnosticConfig?
    private let executablePath: String
    private let agentVoiceHome: String?
    private let lastError: String?

    init(
        status: AgentVoiceStatusSnapshot?,
        history: AgentVoiceHistorySnapshot?,
        doctorReport: DoctorReport?,
        config: AgentVoiceFullConfig?,
        executablePath: String,
        agentVoiceHome: String?,
        lastError: String?
    ) {
        statusState = status?.ui.state.rawValue
        daemon = status.map {
            Daemon(
                state: $0.daemon.state.rawValue,
                running: $0.daemon.running,
                pid: $0.daemon.pid
            )
        }
        queues = status?.queues
        attention = status?.ui.attention ?? []

        let checks = doctorReport?.checks ?? []
        doctorChecks = checks.map(DiagnosticDoctorCheck.init)
        doctorIssues = checks
            .filter { !$0.ok || $0.severity == .warning || $0.severity == .error }
            .map(DiagnosticDoctorCheck.init)

        let jobs = history?.jobs ?? []
        recentJobs = jobs.map(DiagnosticJob.init)
        failedJobs = jobs.filter { $0.status == .failed }.map(DiagnosticJob.init)

        paths = status.map {
            Paths(
                home: $0.paths.home,
                config: $0.paths.config,
                queueDatabase: $0.paths.db
            )
        }
        self.config = status == nil && config == nil
            ? nil
            : DiagnosticConfig(statusConfig: status?.config, fullConfig: config)
        self.executablePath = executablePath
        self.agentVoiceHome = agentVoiceHome
        self.lastError = lastError
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(statusState, forKey: .statusState)
        try container.encode(daemon, forKey: .daemon)
        try container.encode(queues, forKey: .queues)
        try container.encode(attention, forKey: .attention)
        try container.encode(doctorChecks, forKey: .doctorChecks)
        try container.encode(doctorIssues, forKey: .doctorIssues)
        try container.encode(recentJobs, forKey: .recentJobs)
        try container.encode(failedJobs, forKey: .failedJobs)
        try container.encode(paths, forKey: .paths)
        try container.encode(config, forKey: .config)
        try container.encode(executablePath, forKey: .executablePath)
        try container.encode(agentVoiceHome, forKey: .agentVoiceHome)
        try container.encode(lastError, forKey: .lastError)
    }

    private enum CodingKeys: String, CodingKey {
        case statusState
        case daemon
        case queues
        case attention
        case doctorChecks
        case doctorIssues
        case recentJobs
        case failedJobs
        case paths
        case config
        case executablePath
        case agentVoiceHome
        case lastError
    }

    private struct Daemon: Encodable {
        let state: String
        let running: Bool
        let pid: Int?

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(state, forKey: .state)
            try container.encode(running, forKey: .running)
            try container.encode(pid, forKey: .pid)
        }

        private enum CodingKeys: String, CodingKey {
            case state
            case running
            case pid
        }
    }

    private struct DiagnosticDoctorCheck: Encodable {
        let id: String
        let ok: Bool
        let severity: String
        let message: String
        let action: String?

        init(_ check: DoctorCheck) {
            id = check.id
            ok = check.ok
            severity = check.severity.rawValue
            message = check.message
            action = check.action
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(id, forKey: .id)
            try container.encode(ok, forKey: .ok)
            try container.encode(severity, forKey: .severity)
            try container.encode(message, forKey: .message)
            try container.encode(action, forKey: .action)
        }

        private enum CodingKeys: String, CodingKey {
            case id
            case ok
            case severity
            case message
            case action
        }
    }

    private struct DiagnosticJob: Encodable {
        let id: String
        let agent: String
        let status: String
        let text: String
        let cwd: String?
        let createdAt: String
        let finishedAt: String?
        let summary: String?
        let summarizerUsed: String?
        let skipReason: String?
        let lastError: String?
        let attempts: Int
        let timestamp: String

        init(_ job: AgentVoiceHistoryJob) {
            id = job.id
            agent = job.agent
            status = job.status.rawValue
            text = job.text
            cwd = job.cwd
            createdAt = job.createdAt
            finishedAt = job.finishedAt
            summary = job.summary
            summarizerUsed = job.summarizerUsed
            skipReason = job.skipReason
            lastError = job.lastError
            attempts = job.attempts
            timestamp = job.finishedAt ?? job.createdAt
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(id, forKey: .id)
            try container.encode(agent, forKey: .agent)
            try container.encode(status, forKey: .status)
            try container.encode(text, forKey: .text)
            try container.encode(cwd, forKey: .cwd)
            try container.encode(createdAt, forKey: .createdAt)
            try container.encode(finishedAt, forKey: .finishedAt)
            try container.encode(summary, forKey: .summary)
            try container.encode(summarizerUsed, forKey: .summarizerUsed)
            try container.encode(skipReason, forKey: .skipReason)
            try container.encode(lastError, forKey: .lastError)
            try container.encode(attempts, forKey: .attempts)
            try container.encode(timestamp, forKey: .timestamp)
        }

        private enum CodingKeys: String, CodingKey {
            case id
            case agent
            case status
            case text
            case cwd
            case createdAt
            case finishedAt
            case summary
            case summarizerUsed
            case skipReason
            case lastError
            case attempts
            case timestamp
        }
    }

    private struct DiagnosticConfig: Encodable {
        let enabled: Bool?
        let agents: [String: AgentSummary]?
        let tts: TTSConfig?
        let summarizer: SummarizerConfig?

        init(statusConfig: ConfigSummary?, fullConfig: AgentVoiceFullConfig?) {
            enabled = statusConfig?.enabled
            agents = statusConfig?.agents
            tts = fullConfig?.tts
            summarizer = fullConfig?.summarizer
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(enabled, forKey: .enabled)
            try container.encode(agents, forKey: .agents)
            try container.encode(tts, forKey: .tts)
            try container.encode(summarizer, forKey: .summarizer)
        }

        private enum CodingKeys: String, CodingKey {
            case enabled
            case agents
            case tts
            case summarizer
        }
    }

    private struct Paths: Encodable {
        let home: String
        let config: String
        let queueDatabase: String
    }
}
