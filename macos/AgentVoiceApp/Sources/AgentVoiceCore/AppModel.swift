import Combine
import Foundation

@MainActor
public final class AppModel: ObservableObject {
    @Published public private(set) var status: AgentVoiceStatusSnapshot?
    @Published public private(set) var history: AgentVoiceHistorySnapshot?
    @Published public private(set) var doctorReport: DoctorReport?
    @Published public private(set) var config: AgentVoiceFullConfig?
    @Published public private(set) var lastError: String?
    @Published public private(set) var kokoroSetup = KokoroSetupSnapshot()
    @Published public private(set) var kokoroSetupDetectionError: String?
    @Published public private(set) var isLoadingHistoryPage = false
    @Published public private(set) var availableSummarizerModels: [String] = []
    @Published public private(set) var preferredSetupStep: SetupStep?
    @Published public var draftVoice: String = ""
    @Published public var draftThinking: String = "off"
    @Published public var draftSummarizerModel: String = ""

    public static let defaultAutoRefreshIntervalNanoseconds: UInt64 = 2_000_000_000
    public static let defaultHistoryPageSize = 10

    var autoRefreshSubscriberCount = 0
    var isAutoRefreshRunning: Bool { autoRefreshTask != nil }

    private var autoRefreshTask: Task<Void, Never>?
    private var summarizerModelsTask: Task<Void, Never>?
    private var kokoroSetupTask: Task<Void, Never>?
    private var isCancellingKokoroSetup = false
    private var didLoadSummarizerModels = false
    private var lastHistoryTerminalCounts: TerminalQueueCounts?
    private var loadedHistoryPageCount = 0
    private var shouldReplaceHistoryOnNextRefresh = false

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
        summarizerModelsTask?.cancel()
        kokoroSetupTask?.cancel()
    }
}

extension AppModel {
    public func refresh() async {
        var errors: [String] = []
        var kokoroDetectionErrors: [String] = []
        var refreshedStatus: AgentVoiceStatusSnapshot?

        do {
            let snapshot = try await cli.status()
            status = snapshot
            refreshedStatus = snapshot
        } catch {
            errors.append("status: \(String(describing: error))")
        }

        if shouldRefreshHistory(after: refreshedStatus) {
            do {
                try await refreshNewestHistoryPage(preserveLoadedPages: true)
                if let refreshedStatus {
                    lastHistoryTerminalCounts = TerminalQueueCounts(refreshedStatus.queues)
                }
            } catch {
                errors.append("history: \(String(describing: error))")
            }
        }

        do {
            doctorReport = try await cli.doctor()
        } catch {
            let message = "doctor: \(String(describing: error))"
            errors.append(message)
            kokoroDetectionErrors.append(message)
        }

        do {
            let refreshedConfig = try await cli.config()
            config = refreshedConfig
            let currentVoice = refreshedConfig.tts.voice
            if draftVoice.isEmpty || draftVoice == currentVoice {
                draftVoice = currentVoice
            }

            draftThinking = refreshedConfig.summarizer.thinking

            let currentSummarizerModel = summarizerModelBinding(from: refreshedConfig.summarizer)?.current ?? ""
            if draftSummarizerModel.isEmpty || draftSummarizerModel == currentSummarizerModel {
                draftSummarizerModel = currentSummarizerModel
            }
        } catch {
            let message = "config: \(String(describing: error))"
            errors.append(message)
            kokoroDetectionErrors.append(message)
        }

        kokoroSetupDetectionError = kokoroDetectionErrors.isEmpty ? nil : kokoroDetectionErrors.joined(separator: "\n")
        if kokoroDetectionErrors.isEmpty {
            resetStaleKokoroSetupSuccessIfNeeded()
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

    public var shouldPromptForKokoroSetup: Bool {
        kokoroSetup.phase != .running && (hasMissingKokoroDiagnostics || kokoroSetupDetectionError != nil)
    }

    public func requestSetupStep(_ step: SetupStep) {
        preferredSetupStep = step
    }

    public func clearPreferredSetupStep(_ step: SetupStep) {
        guard preferredSetupStep == step else { return }
        preferredSetupStep = nil
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

    public func refreshHistory() async {
        do {
            try await refreshNewestHistoryPage(preserveLoadedPages: true)
            if let status {
                lastHistoryTerminalCounts = TerminalQueueCounts(status.queues)
            }
            lastError = nil
        } catch {
            lastError = "history: \(String(describing: error))"
        }
    }

    public func loadMoreHistory() async {
        guard !isLoadingHistoryPage else { return }
        guard history?.pageInfo.hasMore == true, let cursor = history?.pageInfo.nextCursor else { return }

        isLoadingHistoryPage = true
        defer { isLoadingHistoryPage = false }

        do {
            let nextPage = try await cli.history(limit: Self.defaultHistoryPageSize, before: cursor)
            appendHistoryPage(nextPage)
            lastError = nil
        } catch {
            lastError = "history: \(String(describing: error))"
        }
    }

}

extension AppModel {
    public func setSummarizerMode(_ mode: String) async {
        await perform { try await cli.setSummarizerMode(mode) }
    }

    public func preloadSummarizerModels() {
        guard !didLoadSummarizerModels, summarizerModelsTask == nil else { return }
        summarizerModelsTask = Task {
            await self.refreshSummarizerModels()
        }
    }

    public func refreshSummarizerModels() async {
        guard !didLoadSummarizerModels else { return }

        do {
            let response = try await cli.summarizerModels()
            availableSummarizerModels = response.models
            didLoadSummarizerModels = true
            lastError = nil
        } catch {
            availableSummarizerModels = []
            didLoadSummarizerModels = false
            lastError = "models: \(String(describing: error))"
        }
        summarizerModelsTask = nil
    }

    public func clearQueue() async {
        await perform { try await cli.clearQueue() }
    }

    public func clearFailedJobs() async {
        do {
            try await cli.clearFailedJobs()
            shouldReplaceHistoryOnNextRefresh = true
            await refresh()
        } catch {
            shouldReplaceHistoryOnNextRefresh = false
            lastError = String(describing: error)
        }
    }

    public func saveVoice() async {
        let voice = draftVoice.trimmingCharacters(in: .whitespacesAndNewlines)
        draftVoice = voice
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

    public var summarizerModelInUseLabel: String {
        summarizerModelBinding()?.label ?? "Summarizer model"
    }

    public var summarizerModelInUseValue: String {
        summarizerModelBinding()?.current ?? "Unknown"
    }

    public var isSummarizerModelEditable: Bool {
        summarizerModelBinding() != nil
    }

    public func saveSummarizerModel() async {
        let model = draftSummarizerModel.trimmingCharacters(in: .whitespacesAndNewlines)
        draftSummarizerModel = model
        guard !model.isEmpty else {
            lastError = "Summarizer model cannot be empty"
            return
        }
        guard let binding = summarizerModelBinding() else {
            lastError = "No active summarizer model configuration available"
            return
        }

        await perform { try await cli.setSummarizerModel(binding.path, to: model) }
    }

    public func validateSummarizerModel() async {
        let model = draftSummarizerModel.trimmingCharacters(in: .whitespacesAndNewlines)
        draftSummarizerModel = model
        guard !model.isEmpty else {
            lastError = "Summarizer model cannot be empty"
            return
        }
        guard let binding = summarizerModelBinding() else {
            lastError = "No active summarizer model configuration available"
            return
        }

        await perform {
            let shouldRestore = binding.current != model

            if shouldRestore {
                try await self.cli.setSummarizerModel(binding.path, to: model)
            }

            var validationError: Error?
            do {
                try await self.cli.runVoiceTest("Agent voice model validation check.")
            } catch {
                validationError = error
            }

            if shouldRestore {
                do {
                    try await self.cli.setSummarizerModel(binding.path, to: binding.current)
                } catch {
                    throw SummarizerModelRestoreError(validationError: validationError, restoreError: error)
                }
            }

            if let validationError {
                throw validationError
            }
        }
    }

}

extension AppModel {
    public func installKokoro() async {
        guard kokoroSetupTask == nil, kokoroSetup.phase != .running else { return }

        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.runKokoroSetup()
        }
        kokoroSetupTask = task
        await task.value
    }

    public func cancelKokoroSetup() {
        guard kokoroSetup.phase == .running || kokoroSetupTask != nil else { return }
        isCancellingKokoroSetup = true
        kokoroSetupTask?.cancel()
        kokoroSetup.phase = .cancelled
        kokoroSetup.currentTitle = "Kokoro setup cancelled"
        kokoroSetup.error = nil
    }

    public func retryKokoroSetup() async {
        guard kokoroSetup.phase != .running else { return }
        await installKokoro()
    }

    public func kokoroSetupDiagnostics() -> String {
        var lines: [String] = ["Kokoro setup phase: \(kokoroSetup.phase.rawValue)"]
        if let currentTitle = kokoroSetup.currentTitle {
            lines.append("Current step: \(currentTitle)")
        }
        if let error = kokoroSetup.error {
            lines.append("Error: \(error)")
        }
        lines.append(contentsOf: kokoroSetup.logs)
        return lines.joined(separator: "\n")
    }

    public func installAgentHook(_ agent: String) async {
        await perform { try await cli.installAgentHook(agent) }
    }

    public func uninstallAgentHook(_ agent: String) async {
        await perform { try await cli.uninstallAgentHook(agent) }
    }

    private func runKokoroSetup() async {
        isCancellingKokoroSetup = false
        kokoroSetup = KokoroSetupSnapshot(phase: .running, currentTitle: "Starting Kokoro setup")
        lastError = nil

        var sawComplete = false
        defer {
            kokoroSetupTask = nil
            isCancellingKokoroSetup = false
        }

        do {
            try Task.checkCancellation()
            for try await event in cli.streamKokoroSetupEvents() {
                try Task.checkCancellation()
                if event.type == .complete {
                    sawComplete = true
                }
                applyKokoroSetupEvent(event)
            }

            if isCancellingKokoroSetup || Task.isCancelled {
                kokoroSetup.phase = .cancelled
                kokoroSetup.currentTitle = "Kokoro setup cancelled"
                kokoroSetup.error = nil
                return
            }

            if !sawComplete {
                kokoroSetup.phase = .failed
                kokoroSetup.error = kokoroSetup.error ?? "Kokoro setup ended before a complete event."
                lastError = kokoroSetup.error
                return
            }

            if kokoroSetup.phase == .succeeded {
                await refresh()
            }
            lastError = kokoroSetup.phase == .failed ? kokoroSetup.error : nil
        } catch is CancellationError {
            kokoroSetup.phase = .cancelled
            kokoroSetup.currentTitle = "Kokoro setup cancelled"
            kokoroSetup.error = nil
        } catch {
            if isCancellingKokoroSetup {
                kokoroSetup.phase = .cancelled
                kokoroSetup.currentTitle = "Kokoro setup cancelled"
                kokoroSetup.error = nil
            } else {
                kokoroSetup.phase = .failed
                let existingSetupError = kokoroSetup.error?.trimmingCharacters(in: .whitespacesAndNewlines)
                if let existingSetupError, !existingSetupError.isEmpty {
                    kokoroSetup.error = existingSetupError
                } else {
                    kokoroSetup.error = String(describing: error)
                }
                lastError = kokoroSetup.error
            }
        }
    }

    private func applyKokoroSetupEvent(_ event: KokoroSetupEvent) {
        switch event.type {
        case .step:
            applyKokoroSetupStepEvent(event)
        case .log:
            if let message = event.message, !message.isEmpty {
                if let stream = event.stream, !stream.isEmpty {
                    kokoroSetup.logs.append("[\(stream)] \(message)")
                } else {
                    kokoroSetup.logs.append(message)
                }
            }
        case .complete:
            if event.ok == true {
                kokoroSetup.phase = .succeeded
                kokoroSetup.currentStepID = nil
                kokoroSetup.currentTitle = "Kokoro is ready"
                for step in KokoroSetupSteps.all where !kokoroSetup.completedStepIDs.contains(step.id) {
                    kokoroSetup.completedStepIDs.append(step.id)
                }
            } else {
                kokoroSetup.phase = .failed
                kokoroSetup.error = event.error ?? kokoroSetup.error ?? "Kokoro setup failed."
                kokoroSetup.currentTitle = "Kokoro setup failed"
            }
        }
    }

    private func applyKokoroSetupStepEvent(_ event: KokoroSetupEvent) {
        let status = event.status ?? "running"
        let knownStepID = KokoroSetupSteps.isKnownStepID(event.id) ? event.id : nil
        kokoroSetup.currentStepID = knownStepID
        kokoroSetup.currentTitle = event.title

        switch status {
        case "done":
            kokoroSetup.phase = .running
            appendUnique(knownStepID, to: &kokoroSetup.completedStepIDs)
        case "skipped":
            kokoroSetup.phase = .running
            appendUnique(knownStepID, to: &kokoroSetup.skippedStepIDs)
        case "failed":
            kokoroSetup.phase = .failed
            kokoroSetup.failedStepID = knownStepID
            kokoroSetup.error = event.error ?? event.title ?? "Kokoro setup failed."
        default:
            kokoroSetup.phase = .running
        }
    }

    private func appendUnique(_ id: String?, to ids: inout [String]) {
        guard let id, !ids.contains(id) else { return }
        ids.append(id)
    }

    private func resetStaleKokoroSetupSuccessIfNeeded() {
        guard kokoroSetup.phase == .succeeded else { return }
        guard hasMissingKokoroDiagnostics else { return }
        kokoroSetup = KokoroSetupSnapshot()
    }

    private var hasMissingKokoroDiagnostics: Bool {
        if config?.tts.kokoroScript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true {
            return true
        }
        if config?.tts.python.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true {
            return true
        }

        return doctorReport?.checks.contains {
            ["tts.kokoroScript.exists", "tts.python.exists"].contains($0.id) && !$0.ok
        } == true
    }

}

extension AppModel {
    private func summarizerModelBinding() -> SummarizerModelBinding? {
        guard let summarizer = config?.summarizer else { return nil }
        return summarizerModelBinding(from: summarizer)
    }

    private func summarizerModelBinding(from summarizer: SummarizerConfig) -> SummarizerModelBinding? {
        for name in summarizer.priority {
            if let binding = summarizerModelBinding(for: name, in: summarizer) {
                return binding
            }
        }

        for name in ["pi-fast", "codex-fast", "opencode"] {
            if let binding = summarizerModelBinding(for: name, in: summarizer) {
                return binding
            }
        }

        return nil
    }

    private func summarizerModelBinding(for name: String, in summarizer: SummarizerConfig) -> SummarizerModelBinding? {
        switch name {
        case "pi-fast" where !summarizer.piModel.isEmpty:
            return SummarizerModelBinding(path: "summarizer.piModel", label: "Pi model", current: summarizer.piModel)
        case "codex-fast" where !summarizer.codexModel.isEmpty:
            return SummarizerModelBinding(path: "summarizer.codexModel", label: "Codex model", current: summarizer.codexModel)
        case "opencode":
            guard let value = summarizer.opencodeModel, !value.isEmpty else { return nil }
            return SummarizerModelBinding(path: "summarizer.opencodeModel", label: "OpenCode model", current: value)
        default:
            return nil
        }
    }

    private func shouldRefreshHistory(after refreshedStatus: AgentVoiceStatusSnapshot?) -> Bool {
        guard let refreshedStatus else { return history == nil }
        let terminalCounts = TerminalQueueCounts(refreshedStatus.queues)
        return history == nil || terminalCounts != lastHistoryTerminalCounts
    }

    private func refreshNewestHistoryPage(preserveLoadedPages: Bool) async throws {
        guard !isLoadingHistoryPage else { return }
        isLoadingHistoryPage = true
        defer { isLoadingHistoryPage = false }

        let newestPage = try await cli.history(limit: Self.defaultHistoryPageSize)
        let shouldPreservePages = preserveLoadedPages && !shouldReplaceHistoryOnNextRefresh
        shouldReplaceHistoryOnNextRefresh = false
        if shouldPreservePages, let existingHistory = history, !existingHistory.jobs.isEmpty {
            let mergedJobs = mergeHistoryJobs(newestPage.jobs + existingHistory.jobs)
            let pageInfo = loadedHistoryPageCount > 1 ? existingHistory.pageInfo : newestPage.pageInfo
            history = AgentVoiceHistorySnapshot(version: newestPage.version, jobs: mergedJobs, pageInfo: pageInfo)
        } else {
            history = newestPage
            loadedHistoryPageCount = 0
        }

        loadedHistoryPageCount = max(loadedHistoryPageCount, 1)
    }

    private func appendHistoryPage(_ nextPage: AgentVoiceHistorySnapshot) {
        if let existingHistory = history {
            let mergedJobs = mergeHistoryJobs(existingHistory.jobs + nextPage.jobs)
            history = AgentVoiceHistorySnapshot(version: nextPage.version, jobs: mergedJobs, pageInfo: nextPage.pageInfo)
        } else {
            history = nextPage
        }
        loadedHistoryPageCount += 1
    }

    private func mergeHistoryJobs(_ jobs: [AgentVoiceHistoryJob]) -> [AgentVoiceHistoryJob] {
        var seen = Set<String>()
        var merged: [AgentVoiceHistoryJob] = []
        for job in jobs where !seen.contains(job.id) {
            seen.insert(job.id)
            merged.append(job)
        }
        return merged
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

private struct SummarizerModelBinding {
    let path: String
    let label: String
    let current: String
}

private struct SummarizerModelRestoreError: Error, CustomStringConvertible {
    let validationError: Error?
    let restoreError: Error

    var description: String {
        if let validationError {
            return "Validation failed with \(String(describing: validationError)); restore also failed with \(String(describing: restoreError))"
        }
        return "Restore failed after validation: \(String(describing: restoreError))"
    }
}

private struct TerminalQueueCounts: Equatable {
    let done: Int
    let failed: Int
    let skipped: Int

    init(_ queues: QueueCounts) {
        done = queues.done
        failed = queues.failed
        skipped = queues.skipped
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
    private let historyPageInfo: DiagnosticHistoryPageInfo?
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
            .filter(\.needsReview)
            .map(DiagnosticDoctorCheck.init)

        let jobs = history?.jobs ?? []
        recentJobs = jobs.map(DiagnosticJob.init)
        failedJobs = jobs.filter { $0.status == .failed }.map(DiagnosticJob.init)
        historyPageInfo = history.map { DiagnosticHistoryPageInfo($0.pageInfo) }

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
        try container.encode(historyPageInfo, forKey: .historyPageInfo)
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
        case historyPageInfo
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

    private struct DiagnosticHistoryPageInfo: Encodable {
        let limit: Int
        let hasMore: Bool
        let nextCursor: String?

        init(_ pageInfo: AgentVoiceHistoryPageInfo) {
            limit = pageInfo.limit
            hasMore = pageInfo.hasMore
            nextCursor = pageInfo.nextCursor
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(limit, forKey: .limit)
            try container.encode(hasMore, forKey: .hasMore)
            try container.encode(nextCursor, forKey: .nextCursor)
        }

        private enum CodingKeys: String, CodingKey {
            case limit
            case hasMore
            case nextCursor
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
