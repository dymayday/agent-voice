import XCTest
@testable import AgentVoiceCore

@MainActor
final class AppModelDaemonRestartTests: XCTestCase {
    private func snapshot(buildId: String?, running: Bool = true) throws -> AgentVoiceStatusSnapshot {
        let buildLine = buildId.map { "\"buildId\": \"\($0)\"," } ?? ""
        let json = """
        {
          "version": 1,
          \(buildLine)
          "daemon": { "state": "\(running ? "running" : "stopped")", "running": \(running), "pid": \(running ? "1" : "null") },
          "queues": { "pending": 0, "processing": 0, "done": 0, "failed": 0, "skipped": 0 },
          "config": { "enabled": true, "agents": {} },
          "paths": { "home": "/h", "config": "/c", "db": "/d" },
          "ui": { "state": "ready", "attention": [] }
        }
        """
        return try JSONDecoder().decode(AgentVoiceStatusSnapshot.self, from: Data(json.utf8))
    }

    func testShouldRestartStaleDaemonTruthTable() throws {
        // Running daemon, known-but-different build id, not yet restarted -> restart.
        XCTAssertTrue(AppModel.shouldRestartStaleDaemon(
            appBuildId: "app-A", snapshot: try snapshot(buildId: "daemon-B"),
            alreadyRestartedForBuildId: nil))

        // Matching build id -> no restart.
        XCTAssertFalse(AppModel.shouldRestartStaleDaemon(
            appBuildId: "same", snapshot: try snapshot(buildId: "same"),
            alreadyRestartedForBuildId: nil))

        // Unknown app build id (dev / unstamped) -> no restart.
        XCTAssertFalse(AppModel.shouldRestartStaleDaemon(
            appBuildId: nil, snapshot: try snapshot(buildId: "daemon-B"),
            alreadyRestartedForBuildId: nil))

        // Daemon did not report a build id (old daemon) -> no restart.
        XCTAssertFalse(AppModel.shouldRestartStaleDaemon(
            appBuildId: "app-A", snapshot: try snapshot(buildId: nil),
            alreadyRestartedForBuildId: nil))

        // No snapshot at all -> no restart.
        XCTAssertFalse(AppModel.shouldRestartStaleDaemon(
            appBuildId: "app-A", snapshot: nil, alreadyRestartedForBuildId: nil))

        // Already restarted for this exact stale id -> no restart (loop guard).
        XCTAssertFalse(AppModel.shouldRestartStaleDaemon(
            appBuildId: "app-A", snapshot: try snapshot(buildId: "daemon-B"),
            alreadyRestartedForBuildId: "daemon-B"))

        // Stopped daemon -> no restart (nothing stale is running).
        XCTAssertFalse(AppModel.shouldRestartStaleDaemon(
            appBuildId: "app-A", snapshot: try snapshot(buildId: "daemon-B", running: false),
            alreadyRestartedForBuildId: nil))
    }

    func testRefreshRestartsDaemonOnBuildIdSkew() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(buildId: "old-daemon-build"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: "stopped pid=1\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: "started pid=2\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli, appBuildId: "current-app-build")

        await model.refresh()

        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["stop"],
            ["start"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testRefreshDoesNotRestartWhenBuildIdMatches() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(buildId: "matching-build"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli, appBuildId: "matching-build")

        await model.refresh()

        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testRefreshRestartsAtMostOncePerStaleBuildId() async throws {
        let runner = RecordingRunner(results: [
            // First refresh: stale daemon -> stop + start.
            ProcessResult(exitCode: 0, stdout: statusJSON(buildId: "old-build"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: "stopped\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: "started\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: ""),
            // Second refresh: the daemon snapshot still reports the stale id (the
            // freshly spawned daemon hasn't published yet) -> must NOT restart again.
            // History is skipped this pass (already loaded, terminal counts unchanged).
            ProcessResult(exitCode: 0, stdout: statusJSON(buildId: "old-build"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli, appBuildId: "new-build")

        await model.refresh()
        await model.refresh()

        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"], ["stop"], ["start"],
            ["history", "--json", "--limit", "10"], ["doctor", "--json"], ["config", "get"],
            ["status", "--json"], ["doctor", "--json"], ["config", "get"]
        ])
    }
}
