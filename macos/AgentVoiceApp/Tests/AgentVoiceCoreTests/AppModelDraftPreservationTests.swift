import XCTest
@testable import AgentVoiceCore

private let draftEmptyDoctorJSON = """
{
  "version": 1,
  "checks": []
}
"""

private let draftEmptyHistoryJSON = """
{
  "version": 1,
  "jobs": [],
  "pageInfo": { "limit": 10, "hasMore": false, "nextCursor": null }
}
"""

private func draftStatusJSON() -> String {
    """
    {
      "version": 1,
      "daemon": { "state": "running", "running": true, "pid": 123 },
      "queues": { "pending": 0, "processing": 0, "done": 1, "failed": 0, "skipped": 0 },
      "config": { "enabled": true, "agents": { "pi": { "enabled": true, "mode": "native" } } },
      "paths": { "home": "/tmp/av", "config": "/tmp/av/config.json", "db": "/tmp/av/queue.db" },
      "ui": { "state": "ready", "attention": [] }
    }
    """
}

private func draftFullConfigJSON(voice: String) -> String {
    """
    {
      "version": 1,
      "enabled": true,
      "tts": {
        "kokoroScript": "/tmp/kokoro.py",
        "python": "/usr/bin/python",
        "voice": "\(voice)",
        "timeoutSeconds": 8
      },
      "summarizer": {}
    }
    """
}

@MainActor
final class AppModelDraftPreservationTests: XCTestCase {
    func testVoiceDraftPreservedDuringRefresh() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: draftStatusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: draftEmptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: draftEmptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: draftFullConfigJSON(voice: "af_heart"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: draftStatusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: draftEmptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: draftFullConfigJSON(voice: "af_sky"), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()
        XCTAssertEqual(model.draftVoice, "af_heart")

        model.draftVoice = "user-typed-voice"
        await model.refresh()

        XCTAssertEqual(model.draftVoice, "user-typed-voice")

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"],
            ["status", "--json"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }
}
