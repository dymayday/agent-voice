import XCTest
@testable import AgentVoiceCore

private func statusJSON(uiState: String = "ready") -> String {
    """
    {
      "version": 1,
      "daemon": { "state": "running", "running": true, "pid": 123 },
      "queues": { "pending": 0, "processing": 0, "done": 1, "failed": 0, "skipped": 0 },
      "config": { "enabled": true, "agents": { "pi": { "enabled": true, "mode": "native" } } },
      "paths": { "home": "/tmp/av", "config": "/tmp/av/config.json", "db": "/tmp/av/queue.db" },
      "ui": { "state": "\(uiState)", "attention": [] }
    }
    """
}

private func fullConfigJSON(voice: String = "af_heart", thinking: String = "off") -> String {
    """
    {
      "enabled": true,
      "agents": {},
      "tts": {
        "kokoroScript": "/tmp/kokoro.py",
        "python": "python3",
        "voice": "\(voice)",
        "timeoutSeconds": 30
      },
      "summarizer": {
        "thinking": "\(thinking)"
      }
    }
    """
}

private let emptyHistoryJSON = """
{ "version": 1, "jobs": [] }
"""

private let emptyDoctorJSON = """
{ "version": 1, "checks": [] }
"""

private let doneHistoryJSON = """
{
  "version": 1,
  "jobs": [
    {
      "id": "done-1",
      "agent": "claude",
      "status": "done",
      "text": "raw",
      "createdAt": "2026-06-15T00:00:00.000Z",
      "summary": "Claude finished.",
      "attempts": 1
    }
  ]
}
"""

private let runningDoctorJSON = """
{
  "version": 1,
  "checks": [
    {
      "id": "daemon.running",
      "ok": true,
      "severity": "info",
      "message": "Daemon running"
    }
  ]
}
"""

private let diagnosticFailedText = "Full raw failed job input text should be preserved without truncation in diagnostics."
private let diagnosticSkippedText = "Full raw skipped job input text should also be preserved without truncation."

private let diagnosticHistoryJSON = """
{
  "version": 1,
  "jobs": [
    {
      "id": "failed-diagnostic-1",
      "agent": "pi",
      "status": "failed",
      "text": "\(diagnosticFailedText)",
      "cwd": "/repo/project-a",
      "createdAt": "2026-06-15T00:00:00.000Z",
      "finishedAt": "2026-06-15T00:01:30.000Z",
      "summary": "Failure summary kept for diagnostics.",
      "summarizerUsed": "claude",
      "skipReason": null,
      "lastError": "tts crashed with exit 2",
      "attempts": 3
    },
    {
      "id": "skipped-diagnostic-1",
      "agent": "claude",
      "status": "skipped",
      "text": "\(diagnosticSkippedText)",
      "cwd": "/repo/project-b",
      "createdAt": "2026-06-15T00:02:00.000Z",
      "finishedAt": "2026-06-15T00:02:05.000Z",
      "summary": "Skipped summary kept for diagnostics.",
      "summarizerUsed": "heuristic",
      "skipReason": "agent disabled",
      "lastError": null,
      "attempts": 1
    }
  ]
}
"""

private let diagnosticDoctorJSON = """
{
  "version": 1,
  "checks": [
    {
      "id": "runtime.home",
      "ok": true,
      "severity": "info",
      "message": "Using configured home",
      "action": null
    },
    {
      "id": "tts.script",
      "ok": false,
      "severity": "error",
      "message": "Kokoro script missing",
      "action": "Set tts.kokoroScript"
    }
  ]
}
"""

private func refreshResults(cycles: Int) -> [ProcessResult] {
    (0..<cycles).flatMap { _ in
        [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ]
    }
}

private func waitForRequestCount(
    _ minimumRequestCount: Int,
    runner: RecordingRunner,
    timeoutNanoseconds: UInt64 = 1_000_000_000
) async throws {
    let startedAt = Date()
    let timeoutSeconds = Double(timeoutNanoseconds) / 1_000_000_000

    while Date().timeIntervalSince(startedAt) < timeoutSeconds {
        if await runner.capturedRequests().count >= minimumRequestCount {
            return
        }
        try await Task.sleep(nanoseconds: 5_000_000)
    }

    XCTFail("Timed out waiting for \(minimumRequestCount) process requests")
    throw XCTSkip("Cannot verify auto-refresh without recorded process requests.")
}

@MainActor
final class AppModelTests: XCTestCase {
    func testRefreshLoadsStatusHistoryDoctorAndConfig() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: doneHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: runningDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(voice: "af_sky", thinking: "medium"), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()

        XCTAssertEqual(model.status?.ui.state, .ready)
        XCTAssertEqual(model.history?.jobs.first?.summary, "Claude finished.")
        XCTAssertEqual(model.doctorReport?.checks.first?.id, "daemon.running")
        XCTAssertEqual(model.config?.tts.voice, "af_sky")
        XCTAssertEqual(model.config?.summarizer.thinking, "medium")
        XCTAssertEqual(model.draftVoice, "af_sky")
        XCTAssertEqual(model.draftThinking, "medium")
        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "50"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testDefaultAutoRefreshIntervalIsTwoSeconds() {
        XCTAssertEqual(AppModel.defaultAutoRefreshIntervalNanoseconds, 2_000_000_000)
    }

    func testAutoRefreshUsesSharedReferenceCountForVisibleSurfaces() async throws {
        let runner = RecordingRunner(results: refreshResults(cycles: 1))
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        model.startAutoRefresh(everyNanoseconds: 1_000_000_000)
        model.startAutoRefresh(everyNanoseconds: 1_000_000_000)

        XCTAssertEqual(model.autoRefreshSubscriberCount, 2)
        XCTAssertTrue(model.isAutoRefreshRunning)

        model.stopAutoRefresh()

        XCTAssertEqual(model.autoRefreshSubscriberCount, 1)
        XCTAssertTrue(model.isAutoRefreshRunning)

        model.stopAutoRefresh()

        XCTAssertEqual(model.autoRefreshSubscriberCount, 0)
        XCTAssertFalse(model.isAutoRefreshRunning)
    }

    func testAutoRefreshImmediatelyRefreshesWhenFirstSurfaceAppears() async throws {
        let runner = RecordingRunner(results: refreshResults(cycles: 1))
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        model.startAutoRefresh(everyNanoseconds: 1_000_000_000)
        try await waitForRequestCount(4, runner: runner)
        model.stopAutoRefresh()

        XCTAssertEqual(model.status?.ui.state, .ready)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "50"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testPauseDelegatesToCLIAndRecordsErrors() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "paused\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(uiState: "paused"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.pause()

        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["pause"])
    }

    func testMutatingActionsRefreshStatusHistoryDoctorAndConfig() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "paused\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(uiState: "paused"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.pause()

        XCTAssertEqual(model.status?.ui.state, .paused)
        XCTAssertEqual(model.history?.jobs.count, 0)
        XCTAssertEqual(model.config?.tts.voice, "af_heart")
        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["pause"],
            ["status", "--json"],
            ["history", "--json", "--limit", "50"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testTestVoiceCanSpeakCustomTextAndRefreshes() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "ok\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.testVoice("Claude finished the refactor.")

        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["test", "Claude finished the refactor."],
            ["status", "--json"],
            ["history", "--json", "--limit", "50"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testDiagnosticSnapshotJSONBeforeRefreshIncludesRequiredFieldsWithNullUnavailableValues() throws {
        let runner = RecordingRunner(results: [])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        let data = try XCTUnwrap(model.diagnosticSnapshotJSON().data(using: .utf8))
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let requiredKeys = [
            "statusState",
            "daemon",
            "queues",
            "attention",
            "doctorChecks",
            "doctorIssues",
            "recentJobs",
            "failedJobs",
            "paths",
            "config",
            "executablePath",
            "agentVoiceHome",
            "lastError"
        ]

        for key in requiredKeys {
            XCTAssertNotNil(root[key], "Expected diagnostic snapshot to include \(key)")
        }
        XCTAssertTrue(root["statusState"] is NSNull)
        XCTAssertTrue(root["daemon"] is NSNull)
        XCTAssertTrue(root["queues"] is NSNull)
        XCTAssertTrue(root["paths"] is NSNull)
        XCTAssertTrue(root["config"] is NSNull)
        XCTAssertEqual(root["executablePath"] as? String, "/repo/bin/agent-voice")
        XCTAssertTrue(root["agentVoiceHome"] is NSNull)
        XCTAssertTrue(root["lastError"] is NSNull)
        XCTAssertEqual((root["attention"] as? [Any])?.count, 0)
        XCTAssertEqual((root["doctorChecks"] as? [Any])?.count, 0)
        XCTAssertEqual((root["doctorIssues"] as? [Any])?.count, 0)
        XCTAssertEqual((root["recentJobs"] as? [Any])?.count, 0)
        XCTAssertEqual((root["failedJobs"] as? [Any])?.count, 0)
    }

    func testDiagnosticSnapshotJSONIncludesExpandedDebugContext() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(uiState: "needs_attention"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: diagnosticHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: diagnosticDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(voice: "af_sky", thinking: "high"), stderr: "")
        ])
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            agentVoiceHome: URL(fileURLWithPath: "/tmp/custom-av"),
            runner: runner
        )
        let model = AppModel(cli: cli)

        await model.refresh()
        let data = try XCTUnwrap(model.diagnosticSnapshotJSON().data(using: .utf8))
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let config = try XCTUnwrap(root["config"] as? [String: Any])
        let agents = try XCTUnwrap(config["agents"] as? [String: Any])
        let piAgent = try XCTUnwrap(agents["pi"] as? [String: Any])
        let tts = try XCTUnwrap(config["tts"] as? [String: Any])
        let summarizer = try XCTUnwrap(config["summarizer"] as? [String: Any])
        let doctorChecks = try XCTUnwrap(root["doctorChecks"] as? [[String: Any]])
        let doctorIssues = try XCTUnwrap(root["doctorIssues"] as? [[String: Any]])
        let recentJobs = try XCTUnwrap(root["recentJobs"] as? [[String: Any]])
        let failedJobs = try XCTUnwrap(root["failedJobs"] as? [[String: Any]])
        let failedRecentJob = try XCTUnwrap(recentJobs.first { $0["id"] as? String == "failed-diagnostic-1" })
        let skippedRecentJob = try XCTUnwrap(recentJobs.first { $0["id"] as? String == "skipped-diagnostic-1" })

        XCTAssertEqual(root["statusState"] as? String, "needs_attention")
        XCTAssertEqual(root["executablePath"] as? String, "/repo/bin/agent-voice")
        XCTAssertEqual(root["agentVoiceHome"] as? String, "/tmp/custom-av")
        XCTAssertTrue(root["lastError"] is NSNull)
        XCTAssertEqual(config["enabled"] as? Bool, true)
        XCTAssertEqual(piAgent["enabled"] as? Bool, true)
        XCTAssertEqual(piAgent["mode"] as? String, "native")
        XCTAssertEqual(tts["voice"] as? String, "af_sky")
        XCTAssertEqual(tts["kokoroScript"] as? String, "/tmp/kokoro.py")
        XCTAssertEqual(summarizer["thinking"] as? String, "high")
        XCTAssertEqual(doctorChecks.count, 2)
        XCTAssertEqual(doctorChecks.first?["id"] as? String, "runtime.home")
        XCTAssertEqual(doctorChecks.first?["ok"] as? Bool, true)
        XCTAssertEqual(doctorChecks.first?["severity"] as? String, "info")
        XCTAssertEqual(doctorIssues.count, 1)
        XCTAssertEqual(doctorIssues.first?["id"] as? String, "tts.script")
        XCTAssertEqual(doctorIssues.first?["ok"] as? Bool, false)
        XCTAssertEqual(doctorIssues.first?["action"] as? String, "Set tts.kokoroScript")
        XCTAssertEqual(recentJobs.count, 2)
        XCTAssertEqual(failedRecentJob["status"] as? String, "failed")
        XCTAssertEqual(failedRecentJob["text"] as? String, diagnosticFailedText)
        XCTAssertEqual(failedRecentJob["cwd"] as? String, "/repo/project-a")
        XCTAssertEqual(failedRecentJob["createdAt"] as? String, "2026-06-15T00:00:00.000Z")
        XCTAssertEqual(failedRecentJob["finishedAt"] as? String, "2026-06-15T00:01:30.000Z")
        XCTAssertEqual(failedRecentJob["summary"] as? String, "Failure summary kept for diagnostics.")
        XCTAssertEqual(failedRecentJob["summarizerUsed"] as? String, "claude")
        XCTAssertTrue(failedRecentJob["skipReason"] is NSNull)
        XCTAssertEqual(failedRecentJob["lastError"] as? String, "tts crashed with exit 2")
        XCTAssertEqual(failedRecentJob["attempts"] as? Int, 3)
        XCTAssertEqual(skippedRecentJob["status"] as? String, "skipped")
        XCTAssertEqual(skippedRecentJob["text"] as? String, diagnosticSkippedText)
        XCTAssertEqual(skippedRecentJob["cwd"] as? String, "/repo/project-b")
        XCTAssertEqual(skippedRecentJob["summarizerUsed"] as? String, "heuristic")
        XCTAssertEqual(skippedRecentJob["skipReason"] as? String, "agent disabled")
        XCTAssertTrue(skippedRecentJob["lastError"] is NSNull)
        XCTAssertEqual(failedJobs.count, 1)
        XCTAssertEqual(failedJobs.first?["id"] as? String, "failed-diagnostic-1")
        XCTAssertEqual(failedJobs.first?["text"] as? String, diagnosticFailedText)
    }

    func testRefreshIsBestEffortWhenStatusFailsButOtherSourcesSucceed() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 7, stdout: "", stderr: "status failed loudly\n"),
            ProcessResult(exitCode: 0, stdout: diagnosticHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: diagnosticDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(voice: "af_bella", thinking: "xhigh"), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()

        XCTAssertNil(model.status)
        XCTAssertEqual(model.history?.jobs.count, 2)
        XCTAssertEqual(model.doctorReport?.checks.count, 2)
        XCTAssertEqual(model.config?.tts.voice, "af_bella")
        XCTAssertEqual(model.config?.summarizer.thinking, "xhigh")
        XCTAssertEqual(model.draftVoice, "af_bella")
        XCTAssertEqual(model.draftThinking, "xhigh")
        let lastError = try XCTUnwrap(model.lastError)
        XCTAssertTrue(lastError.contains("status:"))
        XCTAssertTrue(lastError.contains("status failed loudly"))
        XCTAssertFalse(lastError.contains("history:"))
        XCTAssertFalse(lastError.contains("doctor:"))
        XCTAssertFalse(lastError.contains("config:"))
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "50"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

}

extension AppModelTests {
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
            ["history", "--json", "--limit", "50"],
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
            ["history", "--json", "--limit", "50"],
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
            ["history", "--json", "--limit", "50"],
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
            ["history", "--json", "--limit", "50"],
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
            ["history", "--json", "--limit", "50"],
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
            ["history", "--json", "--limit", "50"],
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
}
