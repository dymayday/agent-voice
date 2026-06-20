import XCTest
@testable import AgentVoiceCore

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
  ],
  "pageInfo": { "limit": 10, "hasMore": false, "nextCursor": null }
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

@MainActor
final class AppModelSummarizerKnobsTests: XCTestCase {
    func testRefreshSeedsKnobDraftsFromConfigDefaults() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: doneHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: runningDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()

        XCTAssertEqual(model.draftPromptStyle, "default")
        XCTAssertEqual(model.draftMaxSentences, "1")
        XCTAssertEqual(model.draftMaxSummaryChars, "180")
    }

    func testRefreshPreservesInProgressKnobEdits() async throws {
        // The ~2s auto-refresh must not clobber a draft the user is editing.
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: doneHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: runningDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)
        // Non-empty drafts that differ from the config's defaults (default / 1 / 180).
        model.draftPromptStyle = "triage"
        model.draftMaxSentences = "9"
        model.draftMaxSummaryChars = "500"

        await model.refresh()

        XCTAssertEqual(model.draftPromptStyle, "triage")
        XCTAssertEqual(model.draftMaxSentences, "9")
        XCTAssertEqual(model.draftMaxSummaryChars, "500")
    }

    func testSavePromptStyleIssuesConfigSetThenRefreshes() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: doneHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: runningDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)
        model.draftPromptStyle = "triage"

        await model.savePromptStyle()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["config", "set", "summarizer.promptStyle", "triage"])
    }

    func testSaveMaxSentencesRejectsNonPositiveWithoutCallingCLI() async throws {
        let runner = RecordingRunner(results: [])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)
        model.draftMaxSentences = "0"

        await model.saveMaxSentences()

        let requests = await runner.capturedRequests()
        XCTAssertTrue(requests.isEmpty)
        XCTAssertNotNil(model.lastError)
    }
}
