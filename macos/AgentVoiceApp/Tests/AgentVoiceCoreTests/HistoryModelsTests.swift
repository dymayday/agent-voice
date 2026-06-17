import XCTest
@testable import AgentVoiceCore

final class HistoryModelsTests: XCTestCase {
    func testBuildsHistoryJsonCommand() async throws {
        let runner = RecordingRunner(stdout: "{\"version\":1,\"jobs\":[],\"pageInfo\":{\"limit\":25,\"hasMore\":false,\"nextCursor\":null}}")
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        _ = try await cli.history(limit: 25)

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["history", "--json", "--limit", "25"])
    }

    func testBuildsHistoryJsonCommandWithCursor() async throws {
        let runner = RecordingRunner(stdout: "{\"version\":1,\"jobs\":[],\"pageInfo\":{\"limit\":10,\"hasMore\":true,\"nextCursor\":\"cursor-123\"}}")
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)

        _ = try await cli.history(limit: 10, before: "cursor-123")

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["history", "--json", "--limit", "10", "--before", "cursor-123"])
    }

    func testDecodesHistoryPageInfo() throws {
        let data = Data("""
        {
          "version": 1,
          "jobs": [],
          "pageInfo": { "limit": 10, "hasMore": true, "nextCursor": "cursor-123" }
        }
        """.utf8)

        let snapshot = try JSONDecoder().decode(AgentVoiceHistorySnapshot.self, from: data)

        XCTAssertEqual(snapshot.pageInfo.limit, 10)
        XCTAssertTrue(snapshot.pageInfo.hasMore)
        XCTAssertEqual(snapshot.pageInfo.nextCursor, "cursor-123")
    }

    func testDecodesHistorySnapshot() throws {
        let data = Data("""
        {
          "version": 1,
          "jobs": [
            {
              "id": "failed-1",
              "agent": "codex",
              "status": "failed",
              "text": "raw",
              "createdAt": "2026-06-15T00:00:00.000Z",
              "finishedAt": "2026-06-15T00:01:00.000Z",
              "lastError": "boom",
              "attempts": 3
            },
            {
              "id": "done-1",
              "agent": "pi",
              "status": "done",
              "text": "raw",
              "createdAt": "2026-06-15T00:00:00.000Z",
              "summary": "Pi finished tests.",
              "summarizerUsed": "heuristic",
              "attempts": 1
            }
          ]
        }
        """.utf8)

        let snapshot = try JSONDecoder().decode(AgentVoiceHistorySnapshot.self, from: data)

        XCTAssertEqual(snapshot.version, 1)
        XCTAssertEqual(snapshot.jobs.count, 2)
        XCTAssertEqual(snapshot.jobs[0].status, .failed)
        XCTAssertEqual(snapshot.jobs[0].lastError, "boom")
        XCTAssertEqual(snapshot.jobs[1].summary, "Pi finished tests.")
    }
}
