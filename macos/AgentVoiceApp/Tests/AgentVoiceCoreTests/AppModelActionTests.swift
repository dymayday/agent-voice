import XCTest
@testable import AgentVoiceCore

@MainActor
final class AppModelActionTests: XCTestCase {
    func testInstallAgentHookDelegatesToCLIAndRefreshes() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "installed\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(uiState: "daemon_stopped"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.installAgentHook("pi")

        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["install", "--agents", "pi"],
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testUninstallAgentHookDelegatesToCLIAndRefreshes() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "uninstalled\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(uiState: "daemon_stopped"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.uninstallAgentHook("pi")

        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["uninstall", "--agents", "pi"],
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testClearQueueDelegatesToCLIAndRefreshes() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "Cleared 2 queued job(s).\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.clearQueue()

        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["queue", "clear"],
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testClearFailedJobsDelegatesToCLIAndRefreshes() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "Cleared 1 failed job.\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.clearFailedJobs()
        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["queue", "clear", "--failed"],
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testClearFailedJobsDropsDeletedFailedRowsFromCachedHistory() async throws {
        let failedHistory = historyPageJSON(jobs: [historyJobJSON(id: "failed-1", status: "failed")])
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(done: 0, failed: 1), stderr: ""),
            ProcessResult(exitCode: 0, stdout: failedHistory, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: "Cleared 1 failed job.\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(done: 0, failed: 0), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()
        XCTAssertEqual(model.history?.jobs.map(\.id), ["failed-1"])

        await model.clearFailedJobs()

        XCTAssertEqual(model.status?.queues.failed, 0)
        XCTAssertEqual(model.history?.jobs, [])
        XCTAssertNil(model.lastError)
    }

    func testStartDaemonIfNeededOnLaunchStartsStoppedDaemonAndRefreshes() async throws {
        let stoppedStatus = statusJSON(
            uiState: "daemon_stopped",
            daemonState: "stopped",
            daemonRunning: false,
            daemonPid: "null"
        )
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: stoppedStatus, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: "started pid=456\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()
        await model.startDaemonIfNeededOnLaunch()

        XCTAssertEqual(model.status?.daemon.running, true)
        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"],
            ["start"],
            ["status", "--json"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testStopDaemonBeforeQuitStopsAndRefreshesOnSuccess() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "stopped pid=123\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(uiState: "daemon_stopped"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        let shouldQuit = await model.stopDaemonBeforeQuit()

        XCTAssertTrue(shouldQuit)
        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["stop"],
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testStopDaemonBeforeQuitDoesNotQuitWhenStopFails() async throws {
        let runner = RecordingRunner(stdout: "", stderr: "stop failed\n", exitCode: 1)
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        let shouldQuit = await model.stopDaemonBeforeQuit()

        XCTAssertFalse(shouldQuit)
        XCTAssertEqual(model.lastError, "AgentVoiceCLIError(exitCode: 1, stderr: \"stop failed\\n\")")
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [["stop"]])
    }

    func testSaveVoiceTrimsDelegatesAndRefreshes() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(voice: "bf_emma"), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)
        model.draftVoice = "  bf_emma  "

        await model.saveVoice()

        XCTAssertNil(model.lastError)
        XCTAssertEqual(model.config?.tts.voice, "bf_emma")
        XCTAssertEqual(model.draftVoice, "bf_emma")
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["config", "set", "tts.voice", "bf_emma"],
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testSaveVoiceRejectsEmptyDraftWithoutCallingCLI() async throws {
        let runner = RecordingRunner(results: [])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)
        model.draftVoice = "   "

        await model.saveVoice()

        XCTAssertEqual(model.lastError, "Voice cannot be empty")
        let requests = await runner.capturedRequests()
        XCTAssertTrue(requests.isEmpty)
    }

    func testSaveThinkingTrimsDelegatesAndRefreshes() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(thinking: "xhigh"), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)
        model.draftThinking = "  xhigh  "

        await model.saveThinking()

        XCTAssertNil(model.lastError)
        XCTAssertEqual(model.config?.summarizer.thinking, "xhigh")
        XCTAssertEqual(model.draftThinking, "xhigh")
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["config", "set", "summarizer.thinking", "xhigh"],
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testSaveThinkingRejectsUnsupportedDraftWithoutCallingCLI() async throws {
        let runner = RecordingRunner(results: [])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)
        model.draftThinking = "maximum"

        await model.saveThinking()

        XCTAssertEqual(model.lastError, "Unsupported summarizer thinking effort")
        let requests = await runner.capturedRequests()
        XCTAssertTrue(requests.isEmpty)
    }

    func testSaveSummarizerModelTrimsDelegatesAndRefreshes() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: "", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(piModel: "custom-openai-model"), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()
        model.draftSummarizerModel = "  custom-openai-model  "

        await model.saveSummarizerModel()

        XCTAssertNil(model.lastError)
        XCTAssertEqual(model.draftSummarizerModel, "custom-openai-model")
        XCTAssertEqual(model.config?.summarizer.piModel, "custom-openai-model")
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"],
            ["config", "set", "summarizer.piModel", "custom-openai-model"],
            ["status", "--json"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testSaveSummarizerModelRejectsEmptyDraftWithoutCallingCLI() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()
        model.draftSummarizerModel = "   "

        await model.saveSummarizerModel()

        XCTAssertEqual(model.lastError, "Summarizer model cannot be empty")
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testSummarizerModelDraftPreservedDuringRefresh() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(piModel: "pi-original"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(piModel: "pi-updated"), stderr: ""),
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()
        XCTAssertEqual(model.draftSummarizerModel, "pi-original")

        model.draftSummarizerModel = "user-typed-model"
        await model.refresh()

        XCTAssertEqual(model.draftSummarizerModel, "user-typed-model")
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"],
            ["status", "--json"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testSummarizerModelInUseUsesPriority() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(
                exitCode: 0,
                stdout: fullConfigJSON(
                    piModel: "pi-model",
                    codexModel: "codex-model",
                    opencodeModel: "opencode-model",
                    priority: ["opencode", "codex-fast", "pi-fast"]
                ),
                stderr: ""
            )
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()

        XCTAssertEqual(model.summarizerModelInUseLabel, "OpenCode model")
        XCTAssertEqual(model.summarizerModelInUseValue, "opencode-model")
    }

    func testValidateSummarizerModelTemporarilyWritesAndRestoresConfig() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(piModel: "pi-original"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: "", stderr: ""),
            ProcessResult(exitCode: 0, stdout: "", stderr: ""),
            ProcessResult(exitCode: 0, stdout: "", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(piModel: "pi-original"), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()
        model.draftSummarizerModel = "  pi-validated-model  "

        await model.validateSummarizerModel()

        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"],
            ["config", "set", "summarizer.piModel", "pi-validated-model"],
            ["test", "Agent voice model validation check."],
            ["config", "set", "summarizer.piModel", "pi-original"],
            ["status", "--json"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testValidateSummarizerModelRestoresOriginalAfterValidationFailure() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(piModel: "pi-original"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: "", stderr: ""),
            ProcessResult(exitCode: 7, stdout: "", stderr: "model rejected\n"),
            ProcessResult(exitCode: 0, stdout: "", stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()
        model.draftSummarizerModel = "pi-bad-model"

        await model.validateSummarizerModel()

        XCTAssertEqual(model.lastError, "AgentVoiceCLIError(exitCode: 7, stderr: \"model rejected\\n\")")
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"],
            ["config", "set", "summarizer.piModel", "pi-bad-model"],
            ["test", "Agent voice model validation check."],
            ["config", "set", "summarizer.piModel", "pi-original"]
        ])
    }

    func testValidateSummarizerModelReportsRestoreFailureAfterSuccessfulValidation() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(piModel: "pi-original"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: "", stderr: ""),
            ProcessResult(exitCode: 0, stdout: "validation ok\n", stderr: ""),
            ProcessResult(exitCode: 3, stdout: "", stderr: "restore denied\n")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()
        model.draftSummarizerModel = "pi-temporary-model"

        await model.validateSummarizerModel()

        let lastError = try XCTUnwrap(model.lastError)
        XCTAssertTrue(lastError.contains("Restore failed after validation"))
        XCTAssertTrue(lastError.contains("restore denied"))
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"],
            ["config", "set", "summarizer.piModel", "pi-temporary-model"],
            ["test", "Agent voice model validation check."],
            ["config", "set", "summarizer.piModel", "pi-original"]
        ])
    }

    func testSummarizerModelsLoadOnceAtStartup() async throws {
        let modelsPayload = """
        {
          "providers": {
            "pi-fast": ["openai-codex/gpt-5.5"],
            "codex-fast": ["gpt-5.3-codex"]
          },
          "models": ["gpt-5.3-codex", "openai-codex/gpt-5.5"]
        }
        """
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: modelsPayload, stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refreshSummarizerModels()
        XCTAssertEqual(model.availableSummarizerModels, ["gpt-5.3-codex", "openai-codex/gpt-5.5"])

        await model.refreshSummarizerModels()
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [["models", "list"]])
    }

    func testSummarizerModelsFailureIsReportedAndCanRetry() async throws {
        let modelsPayload = """
        {
          "providers": { "pi-fast": ["openai-codex/gpt-5.5"] },
          "models": ["openai-codex/gpt-5.5"]
        }
        """
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 9, stdout: "", stderr: "models unavailable\n"),
            ProcessResult(exitCode: 0, stdout: modelsPayload, stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refreshSummarizerModels()
        XCTAssertEqual(model.availableSummarizerModels, [])
        XCTAssertEqual(model.lastError, "models: AgentVoiceCLIError(exitCode: 9, stderr: \"models unavailable\\n\")")

        await model.refreshSummarizerModels()
        XCTAssertEqual(model.availableSummarizerModels, ["openai-codex/gpt-5.5"])
        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [["models", "list"], ["models", "list"]])
    }
}
