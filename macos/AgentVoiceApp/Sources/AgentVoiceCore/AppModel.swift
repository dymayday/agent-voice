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
    public static let defaultDiagnosticsRefreshEveryTicks = 15  // 15 * 2s ≈ 30s
    public static let defaultHistoryPageSize = 10
    // Slower cadence when the app is visible but not frontmost (unfocused).
    public static let inactiveAutoRefreshIntervalNanoseconds: UInt64 = 12_000_000_000

    var autoRefreshSubscriberCount = 0
    var isAutoRefreshRunning: Bool { autoRefreshTask != nil }

    private var autoRefreshTask: Task<Void, Never>?
    // Cadence captured from the most recent startAutoRefresh, read each tick so a
    // visibility-driven restart reuses it and focus changes take effect live.
    private var autoRefreshIntervalNanoseconds = AppModel.defaultAutoRefreshIntervalNanoseconds
    private var diagnosticsRefreshEveryTicks = AppModel.defaultDiagnosticsRefreshEveryTicks
    // Loop runs only when subscribers exist AND the app is visible. Default true
    // so headless/unit contexts (no occlusion signals) behave as before.
    private var isHostVisible = true
    private var isHostActive = true
    private var summarizerModelsTask: Task<Void, Never>?
    private var kokoroSetupTask: Task<Void, Never>?
    private var isCancellingKokoroSetup = false
    private var didLoadSummarizerModels = false
    private var lastHistoryTerminalCounts: TerminalQueueCounts?
    private var loadedHistoryPageCount = 0
    private var shouldReplaceHistoryOnNextRefresh = false
    private var lastStatusError: String?
    private var lastDiagnosticsError: String?
    private var lastActionError: String?

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
            self.cli = AgentVoiceCLI(
                executableURL: settings.executableURL,
                agentVoiceHome: settings.agentVoiceHome,
                readsStatusSnapshot: true
            )
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
        await refreshStatusSection()
        await refreshDiagnosticsSection()
        recomputeLastError()
    }

    private func recomputeLastError() {
        let parts = [lastStatusError, lastDiagnosticsError, lastActionError].compactMap { $0 }
        lastError = parts.isEmpty ? nil : parts.joined(separator: "\n")
    }

    private func refreshStatusSection() async {
        var errors: [String] = []
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

        lastStatusError = errors.isEmpty ? nil : errors.joined(separator: "\n")
    }

    private func refreshDiagnosticsSection() async {
        var errors: [String] = []
        var kokoroDetectionErrors: [String] = []

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

        lastDiagnosticsError = errors.isEmpty ? nil : errors.joined(separator: "\n")
    }

    private func refreshStatus() async {
        await refreshStatusSection()
        recomputeLastError()
    }

    private func refreshDiagnostics() async {
        await refreshDiagnosticsSection()
        recomputeLastError()
    }

    public func startAutoRefresh(
        everyNanoseconds intervalNanoseconds: UInt64 = AppModel.defaultAutoRefreshIntervalNanoseconds,
        diagnosticsEveryTicks: Int = AppModel.defaultDiagnosticsRefreshEveryTicks
    ) {
        autoRefreshSubscriberCount += 1
        autoRefreshIntervalNanoseconds = max(intervalNanoseconds, 1_000_000)
        diagnosticsRefreshEveryTicks = max(1, diagnosticsEveryTicks)
        ensureLoopRunning()
    }

    public func stopAutoRefresh() {
        guard autoRefreshSubscriberCount > 0 else { return }
        autoRefreshSubscriberCount -= 1

        if autoRefreshSubscriberCount == 0 {
            cancelLoop()
        }
    }

    /// Hard-gate the refresh loop on app visibility. When the app is fully
    /// occluded/minimized/backgrounded we cancel the loop (no spawns, no file
    /// reads) but keep the subscriber count, so becoming visible again resumes
    /// it. Restarting begins at tick 0, which performs an immediate full refresh
    /// so a revealed window is never stale.
    public func setHostVisibility(_ visible: Bool) {
        guard isHostVisible != visible else { return }
        isHostVisible = visible
        if visible {
            ensureLoopRunning()
        } else {
            cancelLoop()
        }
    }

    /// Soft-gate on focus: when the app is visible but not frontmost, the loop
    /// reads the slower inactive interval on its next tick (no restart).
    public func setHostActive(_ active: Bool) {
        isHostActive = active
    }

    private var effectiveIntervalNanoseconds: UInt64 {
        isHostActive
            ? autoRefreshIntervalNanoseconds
            : max(autoRefreshIntervalNanoseconds, AppModel.inactiveAutoRefreshIntervalNanoseconds)
    }

    private func ensureLoopRunning() {
        guard autoRefreshSubscriberCount > 0, isHostVisible, autoRefreshTask == nil else { return }
        autoRefreshTask = Task { [weak self] in
            var tick = 0
            while !Task.isCancelled {
                guard let self else { return }
                if tick == 0 {
                    await self.refresh()
                } else {
                    await self.refreshStatus()
                    if tick % self.diagnosticsRefreshEveryTicks == 0 {
                        await self.refreshDiagnostics()
                    }
                }
                tick &+= 1
                do {
                    try await Task.sleep(nanoseconds: self.effectiveIntervalNanoseconds)
                } catch {
                    break
                }
            }
        }
    }

    private func cancelLoop() {
        autoRefreshTask?.cancel()
        autoRefreshTask = nil
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
            lastActionError = String(describing: error)
            recomputeLastError()
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
            lastActionError = nil
        } catch {
            lastActionError = "history: \(String(describing: error))"
        }
        recomputeLastError()
    }

    public func loadMoreHistory() async {
        guard !isLoadingHistoryPage else { return }
        guard history?.pageInfo.hasMore == true, let cursor = history?.pageInfo.nextCursor else { return }

        isLoadingHistoryPage = true
        defer { isLoadingHistoryPage = false }

        do {
            let nextPage = try await cli.history(limit: Self.defaultHistoryPageSize, before: cursor)
            appendHistoryPage(nextPage)
            lastActionError = nil
        } catch {
            lastActionError = "history: \(String(describing: error))"
        }
        recomputeLastError()
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
            lastActionError = nil
        } catch {
            availableSummarizerModels = []
            didLoadSummarizerModels = false
            lastActionError = "models: \(String(describing: error))"
        }
        recomputeLastError()
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
            lastActionError = String(describing: error)
            recomputeLastError()
        }
    }

    public func saveVoice() async {
        let voice = draftVoice.trimmingCharacters(in: .whitespacesAndNewlines)
        draftVoice = voice
        guard !voice.isEmpty else {
            lastActionError = "Voice cannot be empty"
            recomputeLastError()
            return
        }
        await perform { try await cli.setVoice(voice) }
    }

    public func saveThinking() async {
        let thinking = draftThinking.trimmingCharacters(in: .whitespacesAndNewlines)
        guard Self.summarizerThinkingOptions.contains(thinking) else {
            lastActionError = "Unsupported summarizer thinking effort"
            recomputeLastError()
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
            lastActionError = "Summarizer model cannot be empty"
            recomputeLastError()
            return
        }
        guard let binding = summarizerModelBinding() else {
            lastActionError = "No active summarizer model configuration available"
            recomputeLastError()
            return
        }

        await perform { try await cli.setSummarizerModel(binding.path, to: model) }
    }

    public func validateSummarizerModel() async {
        let model = draftSummarizerModel.trimmingCharacters(in: .whitespacesAndNewlines)
        draftSummarizerModel = model
        guard !model.isEmpty else {
            lastActionError = "Summarizer model cannot be empty"
            recomputeLastError()
            return
        }
        guard let binding = summarizerModelBinding() else {
            lastActionError = "No active summarizer model configuration available"
            recomputeLastError()
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
        if let kokoroSetupDetectionError {
            lines.append("Kokoro setup detection error: \(kokoroSetupDetectionError)")
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
        lastActionError = nil
        recomputeLastError()

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
                lastActionError = kokoroSetup.error
                recomputeLastError()
                return
            }

            if kokoroSetup.phase == .succeeded {
                await refresh()
            }
            lastActionError = kokoroSetup.phase == .failed ? kokoroSetup.error : nil
            recomputeLastError()
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
                lastActionError = kokoroSetup.error
                recomputeLastError()
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
            lastActionError = String(describing: error)
            recomputeLastError()
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
