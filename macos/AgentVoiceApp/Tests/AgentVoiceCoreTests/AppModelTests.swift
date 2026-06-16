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

private func fullConfigJSON(voice: String = "af_heart") -> String {
    """
    {
      "enabled": true,
      "agents": {},
      "tts": {
        "kokoroScript": "/tmp/kokoro.py",
        "python": "python3",
        "voice": "\(voice)",
        "timeoutSeconds": 30
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

@MainActor
final class AppModelTests: XCTestCase {
    func testRefreshLoadsStatusHistoryDoctorAndConfig() async throws {
        let historyJSON = """
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
        let doctorJSON = """
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
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: historyJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: doctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(voice: "af_sky"), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()

        XCTAssertEqual(model.status?.ui.state, .ready)
        XCTAssertEqual(model.history?.jobs.first?.summary, "Claude finished.")
        XCTAssertEqual(model.doctorReport?.checks.first?.id, "daemon.running")
        XCTAssertEqual(model.config?.tts.voice, "af_sky")
        XCTAssertEqual(model.draftVoice, "af_sky")
        XCTAssertNil(model.lastError)
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
}
