import XCTest
@testable import AgentVoiceCore

private func clearFailedStatusJSON(done: Int, failed: Int) -> String {
    """
    {
      "version": 1,
      "daemon": { "state": "running", "running": true, "pid": 123 },
      "queues": { "pending": 0, "processing": 0, "done": \(done), "failed": \(failed), "skipped": 0 },
      "config": { "enabled": true, "agents": { "pi": { "enabled": true, "mode": "native" } } },
      "paths": { "home": "/tmp/av", "config": "/tmp/av/config.json", "db": "/tmp/av/queue.db" },
      "ui": { "state": "ready", "attention": [] }
    }
    """
}

private func clearFailedHistoryJobJSON(id: String) -> String {
    """
    {
      "id": "\(id)",
      "agent": "claude",
      "status": "done",
      "text": "raw \(id)",
      "createdAt": "2026-06-15T00:00:00.000Z",
      "finishedAt": "2026-06-15T00:01:00.000Z",
      "summary": "Summary \(id)",
      "attempts": 1
    }
    """
}

private func clearFailedHistoryPageJSON(
    jobs: [String],
    hasMore: Bool = false,
    nextCursor: String? = nil
) -> String {
    let cursorJSON = nextCursor.map { "\"\($0)\"" } ?? "null"
    return """
    {
      "version": 1,
      "jobs": [\(jobs.joined(separator: ","))],
      "pageInfo": { "limit": 10, "hasMore": \(hasMore), "nextCursor": \(cursorJSON) }
    }
    """
}

private let clearFailedEmptyDoctorJSON = """
{ "version": 1, "checks": [] }
"""

private let clearFailedFullConfigJSON = """
{
  "enabled": true,
  "agents": {},
  "tts": {
    "kokoroScript": "/tmp/kokoro.py",
    "python": "python3",
    "voice": "af_heart",
    "timeoutSeconds": 30
  },
  "summarizer": {
    "thinking": "off",
    "piModel": "openai-codex/gpt-5.5",
    "codexModel": "gpt-5.3-codex",
    "opencodeModel": null,
    "priority": ["pi-fast", "codex-fast", "heuristic"]
  }
}
"""

@MainActor
final class AppModelClearFailedJobsTests: XCTestCase {
    func testFailedClearFailedJobsDoesNotDiscardLoadedHistoryOnLaterRefresh() async throws {
        let firstPage = clearFailedHistoryPageJSON(
            jobs: [clearFailedHistoryJobJSON(id: "job-a")],
            hasMore: true,
            nextCursor: "cursor-1"
        )
        let secondPage = clearFailedHistoryPageJSON(jobs: [clearFailedHistoryJobJSON(id: "job-b")])
        let newestPage = clearFailedHistoryPageJSON(jobs: [clearFailedHistoryJobJSON(id: "job-c")])
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: clearFailedStatusJSON(done: 2, failed: 1), stderr: ""),
            ProcessResult(exitCode: 0, stdout: firstPage, stderr: ""),
            ProcessResult(exitCode: 0, stdout: clearFailedEmptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: clearFailedFullConfigJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: secondPage, stderr: ""),
            ProcessResult(exitCode: 1, stdout: "", stderr: "clear failed\n"),
            ProcessResult(exitCode: 0, stdout: clearFailedStatusJSON(done: 3, failed: 1), stderr: ""),
            ProcessResult(exitCode: 0, stdout: newestPage, stderr: ""),
            ProcessResult(exitCode: 0, stdout: clearFailedEmptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: clearFailedFullConfigJSON, stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()
        await model.loadMoreHistory()
        XCTAssertEqual(model.history?.jobs.map(\.id), ["job-a", "job-b"])

        await model.clearFailedJobs()
        XCTAssertEqual(model.lastError, "AgentVoiceCLIError(exitCode: 1, stderr: \"clear failed\\n\")")

        await model.refresh()

        XCTAssertEqual(model.history?.jobs.map(\.id), ["job-c", "job-a", "job-b"])
    }
}
