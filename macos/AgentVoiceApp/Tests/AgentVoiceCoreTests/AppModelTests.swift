import XCTest
@testable import AgentVoiceCore

@MainActor
final class AppModelTests: XCTestCase {
    func testRefreshLoadsStatusAndHistory() async throws {
        let statusJSON = """
        {
          "version": 1,
          "daemon": { "state": "running", "running": true, "pid": 123 },
          "queues": { "pending": 0, "processing": 0, "done": 1, "failed": 0, "skipped": 0 },
          "config": { "enabled": true, "agents": {} },
          "paths": { "home": "/tmp/av", "config": "/tmp/av/config.json", "db": "/tmp/av/queue.db" },
          "ui": { "state": "ready", "attention": [] }
        }
        """
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
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: historyJSON, stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()

        XCTAssertEqual(model.status?.ui.state, .ready)
        XCTAssertEqual(model.history?.jobs.first?.summary, "Claude finished.")
        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [["status", "--json"], ["history", "--json", "--limit", "50"]])
    }

    func testPauseDelegatesToCLIAndRecordsErrors() async throws {
        let statusJSON = """
        {
          "version": 1,
          "daemon": { "state": "running", "running": true, "pid": 123 },
          "queues": { "pending": 0, "processing": 0, "done": 0, "failed": 0, "skipped": 0 },
          "config": { "enabled": false, "agents": {} },
          "paths": { "home": "/tmp/av", "config": "/tmp/av/config.json", "db": "/tmp/av/queue.db" },
          "ui": { "state": "paused", "attention": ["system_paused"] }
        }
        """
        let historyJSON = """
        { "version": 1, "jobs": [] }
        """
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "paused\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: historyJSON, stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.pause()

        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["pause"])
    }

    func testMutatingActionsRefreshStatusAndHistory() async throws {
        let pausedStatusJSON = """
        {
          "version": 1,
          "daemon": { "state": "running", "running": true, "pid": 123 },
          "queues": { "pending": 0, "processing": 0, "done": 0, "failed": 0, "skipped": 0 },
          "config": { "enabled": false, "agents": {} },
          "paths": { "home": "/tmp/av", "config": "/tmp/av/config.json", "db": "/tmp/av/queue.db" },
          "ui": { "state": "paused", "attention": ["system_paused"] }
        }
        """
        let historyJSON = """
        { "version": 1, "jobs": [] }
        """
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "paused\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: pausedStatusJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: historyJSON, stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.pause()

        XCTAssertEqual(model.status?.ui.state, .paused)
        XCTAssertEqual(model.history?.jobs.count, 0)
        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["pause"],
            ["status", "--json"],
            ["history", "--json", "--limit", "50"]
        ])
    }
}
