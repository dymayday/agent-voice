import XCTest
@testable import AgentVoiceCore

final class AgentVoiceCLISnapshotTests: XCTestCase {
    private var home: URL!

    override func setUpWithError() throws {
        home = FileManager.default.temporaryDirectory
            .appendingPathComponent("agent-voice-snapshot-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: home.appendingPathComponent("run", isDirectory: true),
            withIntermediateDirectories: true
        )
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: home)
    }

    private func writeSnapshot(running: Bool, pid: Int?) throws {
        let pidJSON = pid.map(String.init) ?? "null"
        let json = """
        {
          "version": 1,
          "daemon": { "state": "\(running ? "running" : "stopped")", "running": \(running), "pid": \(pidJSON) },
          "queues": { "pending": 0, "processing": 0, "done": 0, "failed": 0, "skipped": 0 },
          "config": { "enabled": true, "agents": {} },
          "paths": { "home": "\(home.path)", "config": "\(home.path)/config.json", "db": "\(home.path)/queue.db" },
          "ui": { "state": "\(running ? "ready" : "daemon_stopped")", "attention": [] }
        }
        """
        try json.write(
            to: home.appendingPathComponent("run/status.json"),
            atomically: true,
            encoding: .utf8
        )
    }

    private func makeCLI(runner: RecordingRunner) -> AgentVoiceCLI {
        AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            agentVoiceHome: home,
            readsStatusSnapshot: true,
            runner: runner
        )
    }

    // The spawn fallback returns a recognizably different snapshot so we can tell
    // the two code paths apart.
    private let spawnStatusJSON = """
    {
      "version": 1,
      "daemon": { "state": "stopped", "running": false, "pid": null },
      "queues": { "pending": 9, "processing": 0, "done": 0, "failed": 0, "skipped": 0 },
      "config": { "enabled": true, "agents": {} },
      "paths": { "home": "/spawned", "config": "/spawned/config.json", "db": "/spawned/queue.db" },
      "ui": { "state": "daemon_stopped", "attention": [] }
    }
    """

    func testTrustsSnapshotWhenDaemonRunningAndAlive() async throws {
        try writeSnapshot(running: true, pid: Int(getpid()))
        let runner = RecordingRunner(stdout: spawnStatusJSON)
        let snapshot = try await makeCLI(runner: runner).status()

        XCTAssertEqual(snapshot.daemon.pid, Int(getpid()))
        XCTAssertTrue(snapshot.daemon.running)
        let requests = await runner.capturedRequests()
        XCTAssertTrue(requests.isEmpty, "A trusted snapshot must not spawn the CLI")
    }

    func testFallsBackToSpawnWhenSnapshotPidIsDead() async throws {
        // 2_147_483_646 is above the macOS pid ceiling, so kill(pid, 0) -> ESRCH.
        try writeSnapshot(running: true, pid: 2_147_483_646)
        let runner = RecordingRunner(stdout: spawnStatusJSON)
        let snapshot = try await makeCLI(runner: runner).status()

        XCTAssertEqual(snapshot.queues.pending, 9, "Expected the spawned snapshot")
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["status", "--json"])
    }

    func testFallsBackToSpawnWhenSnapshotReportsStopped() async throws {
        try writeSnapshot(running: false, pid: nil)
        let runner = RecordingRunner(stdout: spawnStatusJSON)
        let snapshot = try await makeCLI(runner: runner).status()

        XCTAssertEqual(snapshot.queues.pending, 9)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["status", "--json"])
    }

    func testFallsBackToSpawnWhenSnapshotMissing() async throws {
        let runner = RecordingRunner(stdout: spawnStatusJSON)
        let snapshot = try await makeCLI(runner: runner).status()

        XCTAssertEqual(snapshot.queues.pending, 9)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["status", "--json"])
    }

    func testFallsBackToSpawnWhenSnapshotCorrupt() async throws {
        try "{ not json".write(
            to: home.appendingPathComponent("run/status.json"),
            atomically: true,
            encoding: .utf8
        )
        let runner = RecordingRunner(stdout: spawnStatusJSON)
        let snapshot = try await makeCLI(runner: runner).status()

        XCTAssertEqual(snapshot.queues.pending, 9)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["status", "--json"])
    }

    func testDefaultConstructionDoesNotReadSnapshot() async throws {
        // Without readsStatusSnapshot, even a valid live snapshot is ignored.
        try writeSnapshot(running: true, pid: Int(getpid()))
        let runner = RecordingRunner(stdout: spawnStatusJSON)
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            agentVoiceHome: home,
            runner: runner
        )
        let snapshot = try await cli.status()

        XCTAssertEqual(snapshot.queues.pending, 9)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["status", "--json"])
    }
}
