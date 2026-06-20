import Combine
import Foundation

public struct SummarizerPromptStyleInfo: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let detail: String
    public let example: String

    public init(id: String, name: String, detail: String, example: String) {
        self.id = id
        self.name = name
        self.detail = detail
        self.example = example
    }
}

@MainActor
public final class AppModel: ObservableObject {
    @Published public private(set) var status: AgentVoiceStatusSnapshot?
    @Published public private(set) var history: AgentVoiceHistorySnapshot?
    @Published public private(set) var doctorReport: DoctorReport?
    @Published public private(set) var config: AgentVoiceFullConfig?
    @Published public private(set) var lastError: String?
    @Published public private(set) var kokoroSetup = KokoroSetupSnapshot()
    @Published public private(set) var kokoroSetupDetectionError: String?
    @Published public private(set) var cliDetectionError: String?
    @Published public private(set) var isLoadingHistoryPage = false
    @Published public private(set) var availableSummarizerModels: [String] = []
    @Published public private(set) var preferredSetupStep: SetupStep?
    @Published public var draftVoice: String = ""
    @Published public var draftThinking: String = "off"
    @Published public var draftSummarizerModel: String = ""
    @Published public var draftPromptStyle: String = ""
    @Published public var draftMaxSentences: String = ""
    @Published public var draftMaxSummaryChars: String = ""
    @Published public var draftSpeakQuestionsVerbatim: Bool = false

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
    // Loop runs only when subscribers exist AND a surface is visible. Default true
    // so headless/unit contexts (no occlusion signals) behave as before.
    private var isHostVisible = true
    private var isHostActive = true
    // The menu-bar popover is its own surface: when open it is inherently visible
    // and is NOT covered by app-window occlusion accounting, so it gets a
    // dedicated flag and bypasses the occlusion gate.
    private var isMenuPopoverOpen = false
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
    // The app bundle's own build id (nil for dev / unstamped builds). Compared to
    // each refreshed snapshot's buildId to spot a daemon still running an older
    // bundle after an app update.
    private let appBuildId: String?
    // The stale daemon build id we last issued a restart for: guards the
    // version-skew restart to at most once per distinct stale daemon, so a failed
    // restart or overlapping refresh never spins into a loop.
    private var lastRestartedForBuildId: String?
    private var didSeedSummaryVoiceToggle = false

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
    public nonisolated static let summarizerPromptStyleCatalog: [SummarizerPromptStyleInfo] = [
        .init(id: "default", name: "Default",
              detail: "A neutral summary of what happened.",
              example: "Updated the fee calculation and reran the tests."),
        .init(id: "terse", name: "Terse",
              detail: "Fewest words, outcome first.",
              example: "Fee split done; tests pass."),
        .init(id: "status-about", name: "Status + topic",
              detail: "State first, then the subject.",
              example: "Done — split client and platform fees."),
        .init(id: "triage", name: "Triage",
              detail: "Leads with what you need to do.",
              example: "Need your call — which auth provider?"),
        .init(id: "conversational", name: "Conversational",
              detail: "Warm, first person.",
              example: "I wired up the fee split and it's green."),
    ]

    public nonisolated static var summarizerPromptStyleOptions: [String] {
        summarizerPromptStyleCatalog.map(\.id)
    }

    public let cli: AgentVoiceCLI

    public init(cli: AgentVoiceCLI? = nil, appBuildId: String? = nil) {
        if let cli {
            self.cli = cli
            self.appBuildId = appBuildId
        } else {
            let settings = AppSettings.defaultSettings()
            self.cli = AgentVoiceCLI(
                executableURL: settings.executableURL,
                agentVoiceHome: settings.agentVoiceHome,
                readsStatusSnapshot: true
            )
            self.appBuildId = appBuildId ?? settings.appBuildId
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
            if let restartError = await restartDaemonIfBuildSkew(snapshot) {
                errors.append(restartError)
            }
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

    /// Restart the daemon when the freshly-read snapshot reports a build id that
    /// differs from this app bundle's — i.e. the daemon is still running an older
    /// bundle (it captured its build id at startup and never reloads). Returns an
    /// error string to surface, or nil on success / when no restart is warranted.
    private func restartDaemonIfBuildSkew(_ snapshot: AgentVoiceStatusSnapshot) async -> String? {
        guard Self.shouldRestartStaleDaemon(
            appBuildId: appBuildId,
            snapshot: snapshot,
            alreadyRestartedForBuildId: lastRestartedForBuildId
        ) else { return nil }
        // Record the target before awaiting: a restart fires at most once per
        // distinct stale daemon build id, even if it fails or refreshes overlap.
        lastRestartedForBuildId = snapshot.buildId
        do {
            try await cli.stopDaemon()
            try await cli.startDaemon()
            return nil
        } catch {
            return "daemon-restart: \(String(describing: error))"
        }
    }

    /// Pure predicate (no I/O) for the version-skew restart, so the decision is
    /// unit-testable in isolation: restart only a *running* daemon whose known
    /// build id differs from the app's, and only once per distinct stale id.
    nonisolated static func shouldRestartStaleDaemon(
        appBuildId: String?,
        snapshot: AgentVoiceStatusSnapshot?,
        alreadyRestartedForBuildId: String?
    ) -> Bool {
        guard let appBuildId,
              let snapshot,
              snapshot.daemon.running,
              let daemonBuildId = snapshot.buildId,
              daemonBuildId != appBuildId,
              alreadyRestartedForBuildId != daemonBuildId
        else { return false }
        return true
    }

    private func refreshDiagnosticsSection() async {
        var errors: [String] = []
        var cliErrors: [String] = []

        do {
            doctorReport = try await cli.doctor()
        } catch {
            let message = "doctor: \(String(describing: error))"
            errors.append(message)
            appendCLIUnavailableError(error, message: message, to: &cliErrors)
        }

        do {
            let refreshedConfig = try await cli.config()
            config = refreshedConfig
            let currentVoice = refreshedConfig.tts.voice
            if draftVoice.isEmpty || draftVoice == currentVoice {
                draftVoice = currentVoice
            }

            draftThinking = refreshedConfig.summarizer.thinking

            let currentPromptStyle = refreshedConfig.summarizer.promptStyle
            if draftPromptStyle.isEmpty || draftPromptStyle == currentPromptStyle {
                draftPromptStyle = currentPromptStyle
            }
            let currentMaxSentences = String(refreshedConfig.summarizer.maxSentences)
            if draftMaxSentences.isEmpty || draftMaxSentences == currentMaxSentences {
                draftMaxSentences = currentMaxSentences
            }
            let currentMaxSummaryChars = String(refreshedConfig.summarizer.maxSummaryChars)
            if draftMaxSummaryChars.isEmpty || draftMaxSummaryChars == currentMaxSummaryChars {
                draftMaxSummaryChars = currentMaxSummaryChars
            }

            if !didSeedSummaryVoiceToggle {
                draftSpeakQuestionsVerbatim = refreshedConfig.summarizer.speakQuestionsVerbatim
                didSeedSummaryVoiceToggle = true
            }

            let currentSummarizerModel = summarizerModelBinding(from: refreshedConfig.summarizer)?.current ?? ""
            if draftSummarizerModel.isEmpty || draftSummarizerModel == currentSummarizerModel {
                draftSummarizerModel = currentSummarizerModel
            }
        } catch {
            let message = "config: \(String(describing: error))"
            errors.append(message)
            appendCLIUnavailableError(error, message: message, to: &cliErrors)
        }

        cliDetectionError = cliErrors.isEmpty ? nil : cliErrors.joined(separator: "\n")
        kokoroSetupDetectionError = nil
        resetStaleKokoroSetupSuccessIfNeeded()

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

    /// Hard-gate the refresh loop on window occlusion. When the app's windows are
    /// fully occluded/minimized we cancel the loop (no spawns, no file reads) but
    /// keep the subscriber count, so becoming visible again resumes it. Mere loss
    /// of focus (the app still has a visible window) does NOT cancel — that only
    /// backs off the cadence via setHostActive. Restarting begins at tick 0, which
    /// performs an immediate full refresh so a revealed window is never stale.
    public func setHostVisibility(_ visible: Bool) {
        guard isHostVisible != visible else { return }
        isHostVisible = visible
        reconcileLoop()
    }

    /// The menu-bar popover is a visible surface independent of window occlusion;
    /// drive it from the popover view's appear/disappear so it keeps refreshing
    /// even when all windows are closed/occluded.
    public func setMenuPopoverOpen(_ open: Bool) {
        guard isMenuPopoverOpen != open else { return }
        isMenuPopoverOpen = open
        reconcileLoop()
    }

    /// Soft-gate on focus: when the app is visible but not frontmost, the loop
    /// reads the slower inactive interval on its next tick (no restart).
    public func setHostActive(_ active: Bool) {
        isHostActive = active
    }

    private var hasVisibleSurface: Bool { isHostVisible || isMenuPopoverOpen }

    var effectiveIntervalNanoseconds: UInt64 {
        isHostActive
            ? autoRefreshIntervalNanoseconds
            : max(autoRefreshIntervalNanoseconds, AppModel.inactiveAutoRefreshIntervalNanoseconds)
    }

    private func reconcileLoop() {
        if hasVisibleSurface {
            ensureLoopRunning()
        } else {
            cancelLoop()
        }
    }

    private func ensureLoopRunning() {
        guard autoRefreshSubscriberCount > 0, hasVisibleSurface, autoRefreshTask == nil else { return }
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
        kokoroSetup.phase != .running && hasMissingKokoroDiagnostics
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

    public var summaryVoiceCanSave: Bool {
        guard let summarizer = config?.summarizer else { return false }
        let style = draftPromptStyle.trimmingCharacters(in: .whitespacesAndNewlines)
        let sentencesText = draftMaxSentences.trimmingCharacters(in: .whitespacesAndNewlines)
        let charsText = draftMaxSummaryChars.trimmingCharacters(in: .whitespacesAndNewlines)
        guard Self.summarizerPromptStyleOptions.contains(style),
              let sentences = Int(sentencesText), sentences >= 1,
              let chars = Int(charsText), chars >= 1
        else { return false }
        return style != summarizer.promptStyle
            || sentences != summarizer.maxSentences
            || chars != summarizer.maxSummaryChars
            || draftSpeakQuestionsVerbatim != summarizer.speakQuestionsVerbatim
    }

    public func saveSummaryVoice() async {
        let style = draftPromptStyle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard Self.summarizerPromptStyleOptions.contains(style) else {
            lastActionError = "Unsupported prompt style"
            recomputeLastError()
            return
        }
        guard let sentences = Int(draftMaxSentences.trimmingCharacters(in: .whitespacesAndNewlines)), sentences >= 1 else {
            lastActionError = "Max sentences must be a whole number of at least 1"
            recomputeLastError()
            return
        }
        guard let chars = Int(draftMaxSummaryChars.trimmingCharacters(in: .whitespacesAndNewlines)), chars >= 1 else {
            lastActionError = "Max characters must be a whole number of at least 1"
            recomputeLastError()
            return
        }
        draftMaxSentences = String(sentences)
        draftMaxSummaryChars = String(chars)
        let verbatim = draftSpeakQuestionsVerbatim
        await perform {
            try await self.cli.setSummarizerPromptStyle(style)
            try await self.cli.setSummarizerMaxSentences(sentences)
            try await self.cli.setSummarizerMaxSummaryChars(chars)
            try await self.cli.setSummarizerSpeakQuestionsVerbatim(verbatim)
        }
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
        if let cliDetectionError {
            lines.append("Agent Voice CLI error: \(cliDetectionError)")
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

    private func appendCLIUnavailableError(_ error: Error, message: String, to errors: inout [String]) {
        guard Self.isCLIUnavailableError(error) else { return }
        errors.append(message)
    }

    private static func isCLIUnavailableError(_ error: Error) -> Bool {
        let nsError = error as NSError
        return nsError.domain == NSCocoaErrorDomain &&
            nsError.code == CocoaError.Code.fileNoSuchFile.rawValue
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
