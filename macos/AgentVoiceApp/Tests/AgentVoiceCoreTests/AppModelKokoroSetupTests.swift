import XCTest
@testable import AgentVoiceCore

private let staleKokoroMissingDoctorJSON = """
{
  "version": 1,
  "checks": [
    {
      "id": "tts.kokoroScript.exists",
      "ok": false,
      "severity": "error",
      "message": "Kokoro script is not configured",
      "action": "Open Setup to configure Kokoro"
    }
  ]
}
"""

private let staleKokoroMissingPythonDoctorJSON = """
{
  "version": 1,
  "checks": [
    {
      "id": "tts.python.exists",
      "ok": false,
      "severity": "error",
      "message": "Kokoro Python executable is missing",
      "action": "Open Setup to configure Kokoro"
    }
  ]
}
"""

@MainActor
final class AppModelKokoroSetupTests: XCTestCase {
    func testInstallKokoroUpdatesSetupStateAndRefreshes() async throws {
        let streamingRunner = RecordingStreamingRunner(lines: [
            #"{"type":"step","id":"prepare","status":"running","title":"Preparing install directory"}"#,
            #"{"type":"step","id":"prepare","status":"done","title":"Preparing install directory"}"#,
            #"{"type":"complete","ok":true}"#
        ])
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            runner: runner,
            streamingRunner: streamingRunner
        )
        let model = AppModel(cli: cli)

        await model.installKokoro()

        XCTAssertEqual(model.kokoroSetup.phase, .succeeded)
        XCTAssertEqual(model.status?.ui.state, .ready)
        let requests = streamingRunner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["kokoro", "setup", "--jsonl"])
    }

    func testInstallKokoroFailureKeepsDiagnostics() async throws {
        let streamingRunner = RecordingStreamingRunner(lines: [
            #"{"type":"step","id":"uv-check","status":"failed","title":"Preparing uv","error":"network down"}"#,
            #"{"type":"complete","ok":false,"error":"network down"}"#
        ])
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            runner: RecordingRunner(),
            streamingRunner: streamingRunner
        )
        let model = AppModel(cli: cli)

        await model.installKokoro()

        XCTAssertEqual(model.kokoroSetup.phase, .failed)
        XCTAssertTrue(model.kokoroSetup.error?.contains("network down") == true)
        XCTAssertTrue(model.kokoroSetupDiagnostics().contains("network down"))
    }

    func testInstallKokoroPreservesJsonlFailureWhenProcessExitsNonzero() async throws {
        let streamingRunner = RecordingStreamingRunner(
            lines: [
                #"{"type":"step","id":"uv-check","status":"failed","title":"Preparing uv","error":"network down"}"#,
                #"{"type":"complete","ok":false,"error":"network down"}"#
            ],
            terminalError: AgentVoiceCLIError(exitCode: 1, stderr: "")
        )
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            runner: RecordingRunner(),
            streamingRunner: streamingRunner
        )
        let model = AppModel(cli: cli)

        await model.installKokoro()

        XCTAssertEqual(model.kokoroSetup.phase, .failed)
        XCTAssertEqual(model.kokoroSetup.error, "network down")
        XCTAssertEqual(model.lastError, "network down")
    }

    func testInstallKokoroIgnoresSecondStartWhileRunning() async throws {
        let streamingRunner = RecordingStreamingRunner(
            lines: [#"{"type":"step","id":"prepare","status":"running","title":"Preparing"}"#],
            finishAutomatically: false
        )
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            runner: RecordingRunner(),
            streamingRunner: streamingRunner
        )
        let model = AppModel(cli: cli)

        let installTask = Task { await model.installKokoro() }
        try await waitForAppModelStreamingRequestCount(1, runner: streamingRunner)

        await model.installKokoro()

        XCTAssertEqual(streamingRunner.capturedRequests().count, 1)
        model.cancelKokoroSetup()
        await installTask.value
    }

    func testInstallKokoroFailsIfStreamEndsWithoutCompleteEvent() async throws {
        let streamingRunner = RecordingStreamingRunner(lines: [
            #"{"type":"step","id":"prepare","status":"running","title":"Preparing"}"#
        ])
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            runner: RecordingRunner(),
            streamingRunner: streamingRunner
        )
        let model = AppModel(cli: cli)

        await model.installKokoro()

        XCTAssertEqual(model.kokoroSetup.phase, .failed)
        XCTAssertTrue(model.kokoroSetup.error?.contains("complete event") == true)
    }

    func testCancelKokoroSetupStopsStreamAndMarksCancelled() async throws {
        let streamingRunner = RecordingStreamingRunner(
            lines: [#"{"type":"step","id":"prepare","status":"running","title":"Preparing"}"#],
            finishAutomatically: false
        )
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            runner: RecordingRunner(),
            streamingRunner: streamingRunner
        )
        let model = AppModel(cli: cli)

        let installTask = Task { await model.installKokoro() }
        try await waitForAppModelStreamingRequestCount(1, runner: streamingRunner)
        model.cancelKokoroSetup()
        await installTask.value

        XCTAssertEqual(model.kokoroSetup.phase, .cancelled)
        XCTAssertTrue(streamingRunner.wasCancelled())
    }

    func testRefreshResetsSucceededKokoroSetupWhenKokoroPythonDisappears() async throws {
        let streamingRunner = RecordingStreamingRunner(lines: [
            #"{"type":"complete","ok":true}"#
        ])
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: staleKokoroMissingPythonDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            runner: runner,
            streamingRunner: streamingRunner
        )
        let model = AppModel(cli: cli)

        await model.installKokoro()
        XCTAssertEqual(model.kokoroSetup.phase, .succeeded)

        await model.refresh()

        XCTAssertEqual(model.kokoroSetup.phase, .idle)
        XCTAssertTrue(model.shouldPromptForKokoroSetup)
    }

    func testRefreshResetsSucceededKokoroSetupWhenKokoroPythonConfigIsBlank() async throws {
        let streamingRunner = RecordingStreamingRunner(lines: [
            #"{"type":"complete","ok":true}"#
        ])
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(python: ""), stderr: "")
        ])
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            runner: runner,
            streamingRunner: streamingRunner
        )
        let model = AppModel(cli: cli)

        await model.installKokoro()
        XCTAssertEqual(model.kokoroSetup.phase, .succeeded)

        await model.refresh()

        XCTAssertEqual(model.config?.tts.python, "")
        XCTAssertEqual(model.kokoroSetup.phase, .idle)
        XCTAssertTrue(model.shouldPromptForKokoroSetup)
    }

    func testRefreshDoesNotResetSucceededKokoroSetupWhenConfigRefreshFails() async throws {
        let streamingRunner = RecordingStreamingRunner(lines: [
            #"{"type":"complete","ok":true}"#
        ])
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 1, stdout: "", stderr: "config down")
        ])
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            runner: runner,
            streamingRunner: streamingRunner
        )
        let model = AppModel(cli: cli)

        await model.installKokoro()
        XCTAssertEqual(model.kokoroSetup.phase, .succeeded)

        await model.refresh()

        XCTAssertEqual(model.kokoroSetup.phase, .succeeded)
        XCTAssertTrue(model.shouldPromptForKokoroSetup)
        XCTAssertTrue(model.kokoroSetupDetectionError?.contains("config") == true)
        XCTAssertTrue(model.kokoroSetupDiagnostics().contains("Kokoro setup detection error: config"))
        XCTAssertTrue(model.lastError?.contains("config") == true)
    }

    func testRefreshDoesNotResetSucceededKokoroSetupWhenDetectionRefreshFails() async throws {
        let streamingRunner = RecordingStreamingRunner(lines: [
            #"{"type":"complete","ok":true}"#
        ])
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 1, stdout: "", stderr: "doctor down"),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            runner: runner,
            streamingRunner: streamingRunner
        )
        let model = AppModel(cli: cli)

        await model.installKokoro()
        XCTAssertEqual(model.kokoroSetup.phase, .succeeded)

        await model.refresh()

        XCTAssertEqual(model.kokoroSetup.phase, .succeeded)
        XCTAssertTrue(model.shouldPromptForKokoroSetup)
        XCTAssertTrue(model.kokoroSetupDiagnostics().contains("Kokoro setup detection error: doctor"))
        XCTAssertTrue(model.lastError?.contains("doctor") == true)
    }

    func testRefreshResetsSucceededKokoroSetupWhenKokoroConfigDisappears() async throws {
        let streamingRunner = RecordingStreamingRunner(lines: [
            #"{"type":"complete","ok":true}"#
        ])
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: staleKokoroMissingDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(kokoroScript: ""), stderr: "")
        ])
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            runner: runner,
            streamingRunner: streamingRunner
        )
        let model = AppModel(cli: cli)

        await model.installKokoro()
        XCTAssertEqual(model.kokoroSetup.phase, .succeeded)

        await model.refresh()

        XCTAssertEqual(model.config?.tts.kokoroScript, "")
        XCTAssertEqual(model.kokoroSetup.phase, .idle)
        XCTAssertTrue(model.shouldPromptForKokoroSetup)
    }

    func testPreferredSetupStepCanBeRequestedAndCleared() {
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: RecordingRunner())
        let model = AppModel(cli: cli)

        model.requestSetupStep(.kokoro)
        XCTAssertEqual(model.preferredSetupStep, .kokoro)

        model.clearPreferredSetupStep(.summaries)
        XCTAssertEqual(model.preferredSetupStep, .kokoro)

        model.clearPreferredSetupStep(.kokoro)
        XCTAssertNil(model.preferredSetupStep)
    }

    private func waitForAppModelStreamingRequestCount(
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
        throw XCTSkip("Cannot verify AppModel Kokoro setup without a recorded process request.")
    }
}
