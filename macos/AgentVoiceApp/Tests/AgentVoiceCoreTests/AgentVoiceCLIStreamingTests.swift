import XCTest
@testable import AgentVoiceCore

final class AgentVoiceCLIStreamingTests: XCTestCase {
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

    func testKokoroSetupDecodeFailureCancelsUnderlyingStream() async throws {
        let streamingRunner = RecordingStreamingRunner(lines: ["not json"], finishAutomatically: false)
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            runner: RecordingRunner(),
            streamingRunner: streamingRunner
        )

        do {
            for try await _ in cli.streamKokoroSetupEvents() {}
            XCTFail("Expected malformed setup JSONL to fail")
        } catch {
            XCTAssertTrue(String(describing: error).contains("data"))
        }

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
}
