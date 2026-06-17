import XCTest
@testable import AgentVoiceCore

private let diagnosticFailedText = "Full raw failed job input text should be preserved without truncation in diagnostics."
private let diagnosticSkippedText = "Full raw skipped job input text should also be preserved without truncation."

private let diagnosticHistoryJSON = """
{
  "version": 1,
  "jobs": [
    {
      "id": "failed-diagnostic-1",
      "agent": "pi",
      "status": "failed",
      "text": "\(diagnosticFailedText)",
      "cwd": "/repo/project-a",
      "createdAt": "2026-06-15T00:00:00.000Z",
      "finishedAt": "2026-06-15T00:01:30.000Z",
      "summary": "Failure summary kept for diagnostics.",
      "summarizerUsed": "claude",
      "skipReason": null,
      "lastError": "tts crashed with exit 2",
      "attempts": 3
    },
    {
      "id": "skipped-diagnostic-1",
      "agent": "claude",
      "status": "skipped",
      "text": "\(diagnosticSkippedText)",
      "cwd": "/repo/project-b",
      "createdAt": "2026-06-15T00:02:00.000Z",
      "finishedAt": "2026-06-15T00:02:05.000Z",
      "summary": "Skipped summary kept for diagnostics.",
      "summarizerUsed": "heuristic",
      "skipReason": "agent disabled",
      "lastError": null,
      "attempts": 1
    }
  ],
  "pageInfo": { "limit": 10, "hasMore": true, "nextCursor": "diagnostic-cursor" }
}
"""

private let diagnosticDoctorJSON = """
{
  "version": 1,
  "checks": [
    {
      "id": "runtime.home",
      "ok": true,
      "severity": "info",
      "message": "Using configured home",
      "action": null
    },
    {
      "id": "tts.script",
      "ok": false,
      "severity": "error",
      "message": "Kokoro script missing",
      "action": "Set tts.kokoroScript"
    }
  ]
}
"""

@MainActor
final class AppModelDiagnosticSnapshotTests: XCTestCase {
    func testDiagnosticSnapshotJSONBeforeRefreshIncludesRequiredFieldsWithNullUnavailableValues() throws {
        let runner = RecordingRunner(results: [])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        let data = try XCTUnwrap(model.diagnosticSnapshotJSON().data(using: .utf8))
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let requiredKeys = [
            "statusState",
            "daemon",
            "queues",
            "attention",
            "doctorChecks",
            "doctorIssues",
            "recentJobs",
            "failedJobs",
            "paths",
            "config",
            "executablePath",
            "agentVoiceHome",
            "lastError"
        ]

        for key in requiredKeys {
            XCTAssertNotNil(root[key], "Expected diagnostic snapshot to include \(key)")
        }
        XCTAssertTrue(root["statusState"] is NSNull)
        XCTAssertTrue(root["daemon"] is NSNull)
        XCTAssertTrue(root["queues"] is NSNull)
        XCTAssertTrue(root["paths"] is NSNull)
        XCTAssertTrue(root["config"] is NSNull)
        XCTAssertEqual(root["executablePath"] as? String, "/repo/bin/agent-voice")
        XCTAssertTrue(root["agentVoiceHome"] is NSNull)
        XCTAssertTrue(root["lastError"] is NSNull)
        XCTAssertEqual((root["attention"] as? [Any])?.count, 0)
        XCTAssertEqual((root["doctorChecks"] as? [Any])?.count, 0)
        XCTAssertEqual((root["doctorIssues"] as? [Any])?.count, 0)
        XCTAssertEqual((root["recentJobs"] as? [Any])?.count, 0)
        XCTAssertEqual((root["failedJobs"] as? [Any])?.count, 0)
    }

    func testDiagnosticSnapshotJSONIncludesExpandedDebugContext() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(uiState: "needs_attention"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: diagnosticHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: diagnosticDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(voice: "af_sky", thinking: "high"), stderr: "")
        ])
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            agentVoiceHome: URL(fileURLWithPath: "/tmp/custom-av"),
            runner: runner
        )
        let model = AppModel(cli: cli)

        await model.refresh()
        let data = try XCTUnwrap(model.diagnosticSnapshotJSON().data(using: .utf8))
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let config = try XCTUnwrap(root["config"] as? [String: Any])
        let agents = try XCTUnwrap(config["agents"] as? [String: Any])
        let piAgent = try XCTUnwrap(agents["pi"] as? [String: Any])
        let tts = try XCTUnwrap(config["tts"] as? [String: Any])
        let summarizer = try XCTUnwrap(config["summarizer"] as? [String: Any])
        let doctorChecks = try XCTUnwrap(root["doctorChecks"] as? [[String: Any]])
        let doctorIssues = try XCTUnwrap(root["doctorIssues"] as? [[String: Any]])
        let recentJobs = try XCTUnwrap(root["recentJobs"] as? [[String: Any]])
        let failedJobs = try XCTUnwrap(root["failedJobs"] as? [[String: Any]])
        let historyPageInfo = try XCTUnwrap(root["historyPageInfo"] as? [String: Any])
        let failedRecentJob = try XCTUnwrap(recentJobs.first { $0["id"] as? String == "failed-diagnostic-1" })
        let skippedRecentJob = try XCTUnwrap(recentJobs.first { $0["id"] as? String == "skipped-diagnostic-1" })

        XCTAssertEqual(root["statusState"] as? String, "needs_attention")
        XCTAssertEqual(root["executablePath"] as? String, "/repo/bin/agent-voice")
        XCTAssertEqual(root["agentVoiceHome"] as? String, "/tmp/custom-av")
        XCTAssertTrue(root["lastError"] is NSNull)
        XCTAssertEqual(config["enabled"] as? Bool, true)
        XCTAssertEqual(piAgent["enabled"] as? Bool, true)
        XCTAssertEqual(piAgent["mode"] as? String, "native")
        XCTAssertEqual(tts["voice"] as? String, "af_sky")
        XCTAssertEqual(tts["kokoroScript"] as? String, "/tmp/kokoro.py")
        XCTAssertEqual(summarizer["thinking"] as? String, "high")
        XCTAssertEqual(doctorChecks.count, 2)
        XCTAssertEqual(doctorChecks.first?["id"] as? String, "runtime.home")
        XCTAssertEqual(doctorChecks.first?["ok"] as? Bool, true)
        XCTAssertEqual(doctorChecks.first?["severity"] as? String, "info")
        XCTAssertEqual(doctorIssues.count, 1)
        XCTAssertEqual(doctorIssues.first?["id"] as? String, "tts.script")
        XCTAssertEqual(doctorIssues.first?["ok"] as? Bool, false)
        XCTAssertEqual(doctorIssues.first?["action"] as? String, "Set tts.kokoroScript")
        XCTAssertEqual(historyPageInfo["limit"] as? Int, 10)
        XCTAssertEqual(historyPageInfo["hasMore"] as? Bool, true)
        XCTAssertEqual(historyPageInfo["nextCursor"] as? String, "diagnostic-cursor")
        XCTAssertEqual(recentJobs.count, 2)
        XCTAssertEqual(failedRecentJob["status"] as? String, "failed")
        XCTAssertEqual(failedRecentJob["text"] as? String, diagnosticFailedText)
        XCTAssertEqual(failedRecentJob["cwd"] as? String, "/repo/project-a")
        XCTAssertEqual(failedRecentJob["createdAt"] as? String, "2026-06-15T00:00:00.000Z")
        XCTAssertEqual(failedRecentJob["finishedAt"] as? String, "2026-06-15T00:01:30.000Z")
        XCTAssertEqual(failedRecentJob["summary"] as? String, "Failure summary kept for diagnostics.")
        XCTAssertEqual(failedRecentJob["summarizerUsed"] as? String, "claude")
        XCTAssertTrue(failedRecentJob["skipReason"] is NSNull)
        XCTAssertEqual(failedRecentJob["lastError"] as? String, "tts crashed with exit 2")
        XCTAssertEqual(failedRecentJob["attempts"] as? Int, 3)
        XCTAssertEqual(skippedRecentJob["status"] as? String, "skipped")
        XCTAssertEqual(skippedRecentJob["text"] as? String, diagnosticSkippedText)
        XCTAssertEqual(skippedRecentJob["cwd"] as? String, "/repo/project-b")
        XCTAssertEqual(skippedRecentJob["summarizerUsed"] as? String, "heuristic")
        XCTAssertEqual(skippedRecentJob["skipReason"] as? String, "agent disabled")
        XCTAssertTrue(skippedRecentJob["lastError"] is NSNull)
        XCTAssertEqual(failedJobs.count, 1)
        XCTAssertEqual(failedJobs.first?["id"] as? String, "failed-diagnostic-1")
        XCTAssertEqual(failedJobs.first?["text"] as? String, diagnosticFailedText)
    }

    func testRefreshIsBestEffortWhenStatusFailsButOtherSourcesSucceed() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 7, stdout: "", stderr: "status failed loudly\n"),
            ProcessResult(exitCode: 0, stdout: diagnosticHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: diagnosticDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(voice: "af_bella", thinking: "xhigh"), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()

        XCTAssertNil(model.status)
        XCTAssertEqual(model.history?.jobs.count, 2)
        XCTAssertEqual(model.doctorReport?.checks.count, 2)
        XCTAssertEqual(model.config?.tts.voice, "af_bella")
        XCTAssertEqual(model.config?.summarizer.thinking, "xhigh")
        XCTAssertEqual(model.draftVoice, "af_bella")
        XCTAssertEqual(model.draftThinking, "xhigh")
        let lastError = try XCTUnwrap(model.lastError)
        XCTAssertTrue(lastError.contains("status:"))
        XCTAssertTrue(lastError.contains("status failed loudly"))
        XCTAssertFalse(lastError.contains("history:"))
        XCTAssertFalse(lastError.contains("doctor:"))
        XCTAssertFalse(lastError.contains("config:"))
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

}
