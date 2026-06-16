import XCTest
@testable import AgentVoiceCore

actor RecordingRunner: ProcessRunning {
    private(set) var requests: [ProcessRequest] = []
    var results: [ProcessResult]

    init(stdout: String = "{}", stderr: String = "", exitCode: Int32 = 0) {
        self.results = [ProcessResult(exitCode: exitCode, stdout: stdout, stderr: stderr)]
    }

    init(results: [ProcessResult]) {
        self.results = results
    }

    func run(_ request: ProcessRequest) async throws -> ProcessResult {
        requests.append(request)
        if results.isEmpty {
            return ProcessResult(exitCode: 0, stdout: "{}", stderr: "")
        }
        return results.removeFirst()
    }

    func capturedRequests() -> [ProcessRequest] {
        requests
    }
}

private actor ResultBox {
    private var value: ProcessResult?
    func set(_ result: ProcessResult) { value = result }
    func get() -> ProcessResult? { value }
}

final class AgentVoiceCLITests: XCTestCase {
    let statusJSON = """
    {
      "version": 1,
      "daemon": { "state": "stopped", "running": false, "pid": null },
      "queues": { "pending": 0, "processing": 0, "done": 0, "failed": 0, "skipped": 0 },
      "config": { "enabled": true, "agents": {} },
      "paths": { "home": "/tmp/av", "config": "/tmp/av/config.json", "db": "/tmp/av/queue.db" },
      "ui": { "state": "daemon_stopped", "attention": [] }
    }
    """

    func testBuildsStatusJsonCommand() async throws {
        let runner = RecordingRunner(stdout: statusJSON)
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        _ = try await cli.status()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["status", "--json"])
    }

    func testAddsAgentVoiceHomeToEnvironment() async throws {
        let runner = RecordingRunner(stdout: statusJSON)
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            agentVoiceHome: URL(fileURLWithPath: "/tmp/custom-agent-voice"),
            runner: runner
        )

        _ = try await cli.status()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.environment["AGENT_VOICE_HOME"], "/tmp/custom-agent-voice")
    }

    func testAddsCommonCliLookupPathsToEnvironment() async throws {
        let runner = RecordingRunner(stdout: statusJSON)
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            baseEnvironment: ["PATH": "/usr/bin:/bin"],
            runner: runner
        )

        _ = try await cli.status()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.environment["PATH"], "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
    }

    func testPauseAndResumeCommands() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "paused\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: "resumed\n", stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        try await cli.pause()
        try await cli.resume()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [["pause"], ["resume"]])
    }

    func testDoctorCommandDecodesReport() async throws {
        let doctorJSON = """
        {
          "version": 1,
          "checks": [
            {
              "id": "config.load",
              "ok": true,
              "severity": "info",
              "message": "Config loaded"
            }
          ]
        }
        """
        let runner = RecordingRunner(stdout: doctorJSON)
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        let report = try await cli.doctor()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["doctor", "--json"])
        XCTAssertEqual(report.checks.first?.severity, .info)
    }

    func testNonZeroExitThrowsUsefulError() async throws {
        let runner = RecordingRunner(stdout: "", stderr: "boom\n", exitCode: 2)
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        do {
            _ = try await cli.status()
            XCTFail("Expected status to throw")
        } catch let error as AgentVoiceCLIError {
            XCTAssertEqual(error.exitCode, 2)
            XCTAssertTrue(error.stderr.contains("boom"))
        }
    }

    func testFoundationRunnerDrainsLargeOutputWhileProcessRuns() async throws {
        let perlPath = "/usr/bin/perl"
        try XCTSkipIf(!FileManager.default.isExecutableFile(atPath: perlPath), "Perl is unavailable")
        let byteCount = 300_000
        let script = """
        $SIG{ALRM}=sub{exit 124}; alarm 2; \
        print STDOUT "o" x \(byteCount); \
        print STDERR "e" x \(byteCount); \
        alarm 0;
        """
        let runner = FoundationProcessRunner()

        let result = try await runner.run(ProcessRequest(
            executableURL: URL(fileURLWithPath: perlPath),
            arguments: ["-e", script],
            environment: [:]
        ))

        XCTAssertEqual(result.exitCode, 0)
        XCTAssertEqual(result.stdout.count, byteCount)
        XCTAssertEqual(result.stderr.count, byteCount)
    }

    func testRunnerGivesChildEofStdinEvenWhenParentStdinNeverEnds() async throws {
        let perlPath = "/usr/bin/perl"
        try XCTSkipIf(!FileManager.default.isExecutableFile(atPath: perlPath), "Perl is unavailable")

        // Give this process a stdin that never reaches EOF: the read end of a
        // pipe whose write end stays open for the whole run. A child that
        // inherits this stdin and reads to EOF would block forever.
        let savedStdin = dup(0)
        var fds: [Int32] = [-1, -1]
        XCTAssertEqual(pipe(&fds), 0)
        let pipeRead = fds[0]
        let pipeWrite = fds[1]
        dup2(pipeRead, 0)
        defer {
            dup2(savedStdin, 0)
            close(savedStdin)
            close(pipeRead)
            close(pipeWrite)
        }

        // Perl slurps all of stdin (blocks until EOF), then reports.
        let script = "local $/; my $_in = <STDIN>; print 'eof';"
        let runner = FoundationProcessRunner()
        let request = ProcessRequest(
            executableURL: URL(fileURLWithPath: perlPath),
            arguments: ["-e", script],
            environment: [:]
        )

        // Run unstructured and poll for completion. The runner must close the
        // child's stdin itself, so the child reaches EOF and exits even though
        // the inherited stdin never does. If it instead inherits the open pipe,
        // the child blocks and the box stays empty until the deadline — failing
        // the assertion rather than hanging the suite. The trailing defer closes
        // the write end, releasing any blocked child during teardown.
        let box = ResultBox()
        let runTask = Task {
            if let result = try? await runner.run(request) {
                await box.set(result)
            }
        }
        defer { runTask.cancel() }

        var observed: ProcessResult?
        let deadline = Date().addingTimeInterval(3)
        while Date() < deadline {
            observed = await box.get()
            if observed != nil { break }
            try await Task.sleep(nanoseconds: 50_000_000)
        }

        XCTAssertNotNil(observed, "runner.run did not finish within 3s; the child blocked on inherited stdin")
        XCTAssertEqual(observed?.exitCode, 0)
        XCTAssertEqual(observed?.stdout, "eof")
    }

    func testSummarizerModeCommand() async throws {
        let runner = RecordingRunner(stdout: "ok\n")
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        try await cli.setSummarizerMode("heuristic")

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["summarizer", "mode", "heuristic"])
    }

    func testInstallAndUninstallAgentHookCommands() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "installed\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: "uninstalled\n", stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        try await cli.installAgentHook("pi")
        try await cli.uninstallAgentHook("pi")

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["install", "--agents", "pi"],
            ["uninstall", "--agents", "pi"]
        ])
    }

    func testConfigCommandDecodesVoiceAndSummarizerThinking() async throws {
        let configJSON = """
        {
          "enabled": true,
          "agents": {},
          "tts": {
            "kokoroScript": "/tmp/kokoro.py",
            "python": "python3",
            "voice": "af_sky",
            "timeoutSeconds": 30
          },
          "summarizer": {
            "thinking": "high"
          }
        }
        """
        let runner = RecordingRunner(stdout: configJSON)
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        let config = try await cli.config()

        XCTAssertEqual(config.tts.voice, "af_sky")
        XCTAssertEqual(config.summarizer.thinking, "high")
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["config", "get"])
    }

    func testSetVoiceCommand() async throws {
        let runner = RecordingRunner(stdout: "ok\n")
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        try await cli.setVoice("bf_emma")

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["config", "set", "tts.voice", "bf_emma"])
    }

    func testSetSummarizerThinkingCommand() async throws {
        let runner = RecordingRunner(stdout: "ok\n")
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        try await cli.setSummarizerThinking("xhigh")

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["config", "set", "summarizer.thinking", "xhigh"])
    }

    func testClearQueueCommand() async throws {
        let runner = RecordingRunner(stdout: "Cleared 2 queued job(s).\n")
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        try await cli.clearQueue()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["queue", "clear"])
    }

    func testDefaultExecutablePrefersEnvironmentOverride() throws {
        let settings = AppSettings.defaultSettings(env: ["AGENT_VOICE_EXECUTABLE": "/tmp/agent-voice"])
        XCTAssertEqual(settings.executableURL.path, "/tmp/agent-voice")
    }

    func testDefaultExecutablePrefersBundledCliWhenPresent() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let cli = root.appendingPathComponent("agent-voice/bin/agent-voice")
        try FileManager.default.createDirectory(at: cli.deletingLastPathComponent(), withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: cli.path, contents: Data())
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: cli.path)

        let settings = AppSettings.defaultSettings(
            env: [:],
            bundleResourceURL: root,
            currentDirectory: URL(fileURLWithPath: "/tmp/not-repo")
        )

        XCTAssertEqual(settings.executableURL.path, cli.path)
    }
}
