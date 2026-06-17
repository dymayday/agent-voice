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

private final class RecordingStreamState: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: AsyncThrowingStream<String, Error>.Continuation?

    func setContinuation(_ continuation: AsyncThrowingStream<String, Error>.Continuation) {
        lock.withLock {
            self.continuation = continuation
        }
    }

    func cancel() {
        let continuation = lock.withLock {
            let continuation = self.continuation
            self.continuation = nil
            return continuation
        }
        continuation?.finish(throwing: CancellationError())
    }
}

final class RecordingStreamingRunner: ProcessStreaming, @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [ProcessRequest] = []
    private let lines: [String]
    private let finishAutomatically: Bool
    private var didCancel = false

    init(lines: [String], finishAutomatically: Bool = true) {
        self.lines = lines
        self.finishAutomatically = finishAutomatically
    }

    func stream(_ request: ProcessRequest) -> ProcessStream {
        lock.withLock {
            requests.append(request)
        }

        let lines = self.lines
        let finishAutomatically = self.finishAutomatically
        let streamState = RecordingStreamState()
        let stream = AsyncThrowingStream<String, Error> { continuation in
            streamState.setContinuation(continuation)
            Task {
                for line in lines {
                    continuation.yield(line)
                    await Task.yield()
                }
                if finishAutomatically {
                    continuation.finish()
                }
            }
        }

        return ProcessStream(lines: stream) { [weak self] in
            self?.recordCancellation()
            streamState.cancel()
        }
    }

    private func recordCancellation() {
        lock.withLock {
            didCancel = true
        }
    }

    func capturedRequests() -> [ProcessRequest] {
        lock.withLock { requests }
    }

    func wasCancelled() -> Bool {
        lock.withLock { didCancel }
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

    func testSetSummarizerModelCommand() async throws {
        let runner = RecordingRunner(stdout: "ok\n")
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        try await cli.setSummarizerModel("summarizer.piModel", to: "openai-custom/model")

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["config", "set", "summarizer.piModel", "openai-custom/model"])
    }

    func testSummarizerModelsCommand() async throws {
        let modelsPayload = """
        {
          "providers": {
            "pi-fast": ["openai-codex/gpt-5.5"],
            "codex-fast": ["gpt-5.3-codex"]
          },
          "models": ["gpt-5.3-codex", "openai-codex/gpt-5.5"]
        }
        """
        let runner = RecordingRunner(stdout: modelsPayload)
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        let response = try await cli.summarizerModels()

        XCTAssertEqual(response.models, ["gpt-5.3-codex", "openai-codex/gpt-5.5"])
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["models", "list"])
    }

    func testClearQueueCommand() async throws {
        let runner = RecordingRunner(stdout: "Cleared 2 queued job(s).\n")
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        try await cli.clearQueue()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["queue", "clear"])
    }

    func testClearFailedJobsCommand() async throws {
        let runner = RecordingRunner(stdout: "Cleared 1 failed job.\n")
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        try await cli.clearFailedJobs()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["queue", "clear", "--failed"])
    }

    func testKokoroSetupCommandStreamsJsonl() async throws {
        let streamingRunner = RecordingStreamingRunner(lines: [#"{"type":"complete","ok":true}"#])
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            runner: RecordingRunner(),
            streamingRunner: streamingRunner
        )

        var received: [KokoroSetupEvent] = []
        for try await event in cli.streamKokoroSetupEvents() {
            received.append(event)
        }

        XCTAssertEqual(received.last?.ok, true)
        let requests = streamingRunner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["kokoro", "setup", "--jsonl"])
    }

    func testKokoroSetupStreamingUsesSharedEnvironment() async throws {
        let streamingRunner = RecordingStreamingRunner(lines: [#"{"type":"complete","ok":true}"#])
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            agentVoiceHome: URL(fileURLWithPath: "/tmp/custom-agent-voice"),
            baseEnvironment: ["PATH": "/usr/bin:/bin"],
            runner: RecordingRunner(),
            streamingRunner: streamingRunner
        )

        for try await _ in cli.streamKokoroSetupEvents() {}

        let request = try XCTUnwrap(streamingRunner.capturedRequests().first)
        XCTAssertEqual(request.environment["AGENT_VOICE_HOME"], "/tmp/custom-agent-voice")
        XCTAssertEqual(request.environment["PATH"], "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
    }

    func testCancellingKokoroSetupStreamCancelsRunner() async throws {
        let streamingRunner = RecordingStreamingRunner(
            lines: [#"{"type":"step","id":"prepare","status":"running","title":"Preparing"}"#],
            finishAutomatically: false
        )
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            runner: RecordingRunner(),
            streamingRunner: streamingRunner
        )

        let task = Task {
            for try await _ in cli.streamKokoroSetupEvents() {}
        }
        try await waitForStreamingRequestCount(1, runner: streamingRunner)
        task.cancel()
        _ = await task.result

        XCTAssertTrue(streamingRunner.wasCancelled())
    }

    func testStreamingLineDecoderPreservesUTF8AcrossChunks() throws {
        var decoder = StreamingLineDecoder()
        var firstChunk = Data(#"{"type":"log","stream":"stdout","message":"caf"#.utf8)
        let eAcute = Array("é".utf8)
        firstChunk.append(eAcute[0])

        XCTAssertEqual(try decoder.append(firstChunk), [])

        var secondChunk = Data([eAcute[1]])
        secondChunk.append(contentsOf: Data(#""}"#.utf8))
        secondChunk.append(0x0A)

        XCTAssertEqual(
            try decoder.append(secondChunk),
            [#"{"type":"log","stream":"stdout","message":"café"}"#]
        )
        XCTAssertNil(try decoder.finish())
    }

    func testStreamingLineDecoderRejectsInvalidUTF8() {
        var decoder = StreamingLineDecoder()

        XCTAssertThrowsError(try decoder.append(Data([0xFF, 0x0A])))
    }

    func testFoundationStreamingRunnerStreamsLinesAndFinalPartialLine() async throws {
        let runner = FoundationStreamingProcessRunner()
        let processStream = runner.stream(shellRequest("printf 'one\\n'; printf 'two'"))

        var lines: [String] = []
        for try await line in processStream.lines {
            lines.append(line)
        }

        XCTAssertEqual(lines, ["one", "two"])
    }

    func testFoundationStreamingRunnerPropagatesNonzeroExitWithStderr() async throws {
        let runner = FoundationStreamingProcessRunner()
        let processStream = runner.stream(shellRequest("printf 'before\\n'; printf 'boom\\n' >&2; exit 7"))

        var lines: [String] = []
        do {
            for try await line in processStream.lines {
                lines.append(line)
            }
            XCTFail("Expected nonzero streaming process exit to throw")
        } catch let error as AgentVoiceCLIError {
            XCTAssertEqual(error.exitCode, 7)
            XCTAssertTrue(error.stderr.contains("boom"))
        }
        XCTAssertEqual(lines, ["before"])
    }

    func testFoundationStreamingRunnerCancelStopsOnlySelectedStream() async throws {
        let runner = FoundationStreamingProcessRunner()
        let longStream = runner.stream(shellRequest("trap 'exit 0' TERM; while true; do sleep 1; done"))
        let longTask = Task {
            for try await _ in longStream.lines {}
        }
        try await Task.sleep(nanoseconds: 50_000_000)

        let shortStream = runner.stream(shellRequest("printf 'ready\\n'; printf 'done\\n'"))
        longStream.cancel()

        var shortLines: [String] = []
        for try await line in shortStream.lines {
            shortLines.append(line)
        }
        _ = await longTask.result

        XCTAssertEqual(shortLines, ["ready", "done"])
    }

    private func shellRequest(_ script: String) -> ProcessRequest {
        ProcessRequest(
            executableURL: URL(fileURLWithPath: "/bin/sh"),
            arguments: ["-c", script],
            environment: ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin"]
        )
    }

    private func waitForStreamingRequestCount(
        _ minimumRequestCount: Int,
        runner: RecordingStreamingRunner,
        timeoutNanoseconds: UInt64 = 1_000_000_000
    ) async throws {
        let startedAt = Date()
        let timeoutSeconds = Double(timeoutNanoseconds) / 1_000_000_000

        while Date().timeIntervalSince(startedAt) < timeoutSeconds {
            if runner.capturedRequests().count >= minimumRequestCount {
                return
            }
            try await Task.sleep(nanoseconds: 5_000_000)
        }

        XCTFail("Timed out waiting for \(minimumRequestCount) streaming process requests")
        throw XCTSkip("Cannot verify streaming cancellation without a recorded process request.")
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
