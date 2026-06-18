import XCTest
@testable import AgentVoiceCore

func statusJSON(
    uiState: String = "ready",
    done: Int = 1,
    failed: Int = 0,
    skipped: Int = 0,
    attention: [String] = []
) -> String {
    let attentionJSON = attention.map { "\"\($0)\"" }.joined(separator: ",")
    return """
    {
      "version": 1,
      "daemon": { "state": "running", "running": true, "pid": 123 },
      "queues": { "pending": 0, "processing": 0, "done": \(done), "failed": \(failed), "skipped": \(skipped) },
      "config": { "enabled": true, "agents": { "pi": { "enabled": true, "mode": "native" } } },
      "paths": { "home": "/tmp/av", "config": "/tmp/av/config.json", "db": "/tmp/av/queue.db" },
      "ui": { "state": "\(uiState)", "attention": [\(attentionJSON)] }
    }
    """
}
func historyJobJSON(id: String, status: String = "done", text: String? = nil) -> String {
    """
    {
      "id": "\(id)",
      "agent": "claude",
      "status": "\(status)",
      "text": "\(text ?? "raw \(id)")",
      "createdAt": "2026-06-15T00:00:00.000Z",
      "finishedAt": "2026-06-15T00:01:00.000Z",
      "summary": "Summary \(id)",
      "attempts": 1
    }
    """
}

func historyPageJSON(
    jobs: [String],
    limit: Int = 10,
    hasMore: Bool = false,
    nextCursor: String? = nil
) -> String {
    let cursorJSON = nextCursor.map { "\"\($0)\"" } ?? "null"
    return """
    {
      "version": 1,
      "jobs": [\(jobs.joined(separator: ","))],
      "pageInfo": { "limit": \(limit), "hasMore": \(hasMore), "nextCursor": \(cursorJSON) }
    }
    """
}

func fullConfigJSON(
    voice: String = "af_heart",
    thinking: String = "off",
    kokoroScript: String = "/tmp/kokoro.py",
    python: String = "python3",
    piModel: String = "openai-codex/gpt-5.5",
    codexModel: String = "gpt-5.3-codex",
    opencodeModel: String? = nil,
    priority: [String] = ["pi-fast", "codex-fast", "heuristic"]
) -> String {
    let priorityJSON = priority.map { "\"\($0)\"" }.joined(separator: ", ")
    let opencodeModelJSON = opencodeModel.map { "\"\($0)\"" } ?? "null"

    return """
    {
      "enabled": true,
      "agents": {},
      "tts": {
        "kokoroScript": "\(kokoroScript)",
        "python": "\(python)",
        "voice": "\(voice)",
        "timeoutSeconds": 30
      },
      "summarizer": {
        "thinking": "\(thinking)",
        "piModel": "\(piModel)",
        "codexModel": "\(codexModel)",
        "opencodeModel": \(opencodeModelJSON),
        "priority": [\(priorityJSON)]
      }
    }
    """
}

let emptyHistoryJSON = """
{ "version": 1, "jobs": [], "pageInfo": { "limit": 10, "hasMore": false, "nextCursor": null } }
"""

let emptyDoctorJSON = """
{ "version": 1, "checks": [] }
"""

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

private func refreshResults(cycles: Int) -> [ProcessResult] {
    (0..<cycles).flatMap { _ in
        [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ]
    }
}

private func waitForRequestCount(
    _ minimumRequestCount: Int,
    runner: RecordingRunner,
    timeoutNanoseconds: UInt64 = 1_000_000_000
) async throws {
    let startedAt = Date()
    let timeoutSeconds = Double(timeoutNanoseconds) / 1_000_000_000

    while Date().timeIntervalSince(startedAt) < timeoutSeconds {
        if await runner.capturedRequests().count >= minimumRequestCount {
            return
        }
        try await Task.sleep(nanoseconds: 5_000_000)
    }

    XCTFail("Timed out waiting for \(minimumRequestCount) process requests")
    throw XCTSkip("Cannot verify auto-refresh without recorded process requests.")
}

@MainActor
final class AppModelTests: XCTestCase {
    func testRefreshLoadsStatusHistoryDoctorAndConfig() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: doneHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: runningDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(voice: "af_sky", thinking: "medium"), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()

        XCTAssertEqual(model.status?.ui.state, .ready)
        XCTAssertEqual(model.history?.jobs.first?.summary, "Claude finished.")
        XCTAssertEqual(model.doctorReport?.checks.first?.id, "daemon.running")
        XCTAssertEqual(model.config?.tts.voice, "af_sky")
        XCTAssertEqual(model.config?.summarizer.thinking, "medium")
        XCTAssertEqual(model.draftVoice, "af_sky")
        XCTAssertEqual(model.draftThinking, "medium")
        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testDefaultAutoRefreshIntervalIsTwoSeconds() {
        XCTAssertEqual(AppModel.defaultAutoRefreshIntervalNanoseconds, 2_000_000_000)
    }

    func testAutoRefreshUsesSharedReferenceCountForVisibleSurfaces() async throws {
        let runner = RecordingRunner(results: refreshResults(cycles: 1))
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        model.startAutoRefresh(everyNanoseconds: 1_000_000_000)
        model.startAutoRefresh(everyNanoseconds: 1_000_000_000)

        XCTAssertEqual(model.autoRefreshSubscriberCount, 2)
        XCTAssertTrue(model.isAutoRefreshRunning)

        model.stopAutoRefresh()

        XCTAssertEqual(model.autoRefreshSubscriberCount, 1)
        XCTAssertTrue(model.isAutoRefreshRunning)

        model.stopAutoRefresh()

        XCTAssertEqual(model.autoRefreshSubscriberCount, 0)
        XCTAssertFalse(model.isAutoRefreshRunning)
    }

    func testHostVisibilityFalseCancelsLoopButKeepsSubscribers() async throws {
        let runner = RecordingRunner(results: refreshResults(cycles: 4))
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        model.startAutoRefresh(everyNanoseconds: 1_000_000)
        XCTAssertTrue(model.isAutoRefreshRunning)

        model.setHostVisibility(false)
        XCTAssertEqual(model.autoRefreshSubscriberCount, 1, "Occlusion must not drop the subscriber")
        XCTAssertFalse(model.isAutoRefreshRunning, "An occluded app must not poll")
    }

    func testHostVisibilityIsIdempotent() async throws {
        let runner = RecordingRunner(results: refreshResults(cycles: 4))
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        model.startAutoRefresh(everyNanoseconds: 1_000_000)
        model.setHostVisibility(true)  // already visible — no-op
        XCTAssertTrue(model.isAutoRefreshRunning)

        model.setHostVisibility(false)
        model.setHostVisibility(false)  // repeated — still just paused
        XCTAssertFalse(model.isAutoRefreshRunning)
        XCTAssertEqual(model.autoRefreshSubscriberCount, 1)
    }

    func testStartAutoRefreshWhileHiddenDoesNotRun() async throws {
        let runner = RecordingRunner(results: refreshResults(cycles: 2))
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        model.setHostVisibility(false)
        model.startAutoRefresh(everyNanoseconds: 1_000_000)

        XCTAssertEqual(model.autoRefreshSubscriberCount, 1)
        XCTAssertFalse(model.isAutoRefreshRunning)

        try await Task.sleep(nanoseconds: 50_000_000)
        let requests = await runner.capturedRequests()
        XCTAssertTrue(requests.isEmpty, "A hidden surface must not trigger any refresh")
    }

    func testRevealPerformsImmediateRefresh() async throws {
        let runner = RecordingRunner(results: refreshResults(cycles: 2))
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        model.setHostVisibility(false)
        // Long interval so only the immediate tick-0 refresh fires within the wait.
        model.startAutoRefresh(everyNanoseconds: 1_000_000_000)
        XCTAssertFalse(model.isAutoRefreshRunning)

        model.setHostVisibility(true)
        XCTAssertTrue(model.isAutoRefreshRunning)

        try await waitForRequestCount(4, runner: runner)
        model.stopAutoRefresh()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(Array(requests.prefix(4)).map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testSetHostActiveDoesNotRestartLoop() async throws {
        let runner = RecordingRunner(results: refreshResults(cycles: 4))
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        model.startAutoRefresh(everyNanoseconds: 1_000_000_000)
        XCTAssertTrue(model.isAutoRefreshRunning)

        model.setHostActive(false)
        XCTAssertTrue(model.isAutoRefreshRunning, "Losing focus backs off cadence but keeps the loop")

        model.setHostActive(true)
        XCTAssertTrue(model.isAutoRefreshRunning)

        model.stopAutoRefresh()
        XCTAssertFalse(model.isAutoRefreshRunning)
    }

    func testMenuPopoverKeepsRefreshingWhileWindowsOccluded() async throws {
        let runner = RecordingRunner(results: refreshResults(cycles: 2))
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        model.setHostVisibility(false)  // all windows occluded
        model.startAutoRefresh(everyNanoseconds: 1_000_000_000)
        XCTAssertFalse(model.isAutoRefreshRunning, "Occluded windows alone should not run the loop")

        model.setMenuPopoverOpen(true)  // popover is its own visible surface
        XCTAssertTrue(model.isAutoRefreshRunning, "An open popover must refresh even when windows are occluded")

        model.setMenuPopoverOpen(false)
        XCTAssertFalse(model.isAutoRefreshRunning, "Closing the popover returns to the occluded (paused) state")

        model.stopAutoRefresh()
    }

    func testInactiveAutoRefreshIntervalIsTwelveSeconds() {
        XCTAssertEqual(AppModel.inactiveAutoRefreshIntervalNanoseconds, 12_000_000_000)
    }

    func testFocusBackoffSwitchesEffectiveCadence() async throws {
        let runner = RecordingRunner(results: refreshResults(cycles: 1))
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        XCTAssertEqual(model.effectiveIntervalNanoseconds, AppModel.defaultAutoRefreshIntervalNanoseconds)
        model.setHostActive(false)
        XCTAssertEqual(model.effectiveIntervalNanoseconds, AppModel.inactiveAutoRefreshIntervalNanoseconds)
        model.setHostActive(true)
        XCTAssertEqual(model.effectiveIntervalNanoseconds, AppModel.defaultAutoRefreshIntervalNanoseconds)
    }

    func testAutoRefreshImmediatelyRefreshesWhenFirstSurfaceAppears() async throws {
        let runner = RecordingRunner(results: refreshResults(cycles: 1))
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        model.startAutoRefresh(everyNanoseconds: 1_000_000_000)
        try await waitForRequestCount(4, runner: runner)
        model.stopAutoRefresh()

        XCTAssertEqual(model.status?.ui.state, .ready)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testRefreshSkipsHistoryWhenTerminalCountsAreUnchanged() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(done: 1, failed: 0, skipped: 0), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(done: 1, failed: 0, skipped: 0), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()
        await model.refresh()

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

    func testRefreshReloadsFirstHistoryPageWhenTerminalCountsChange() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(done: 1, failed: 0, skipped: 0), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(done: 2, failed: 0, skipped: 0), stderr: ""),
            ProcessResult(exitCode: 0, stdout: doneHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()
        await model.refresh()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"],
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
        XCTAssertEqual(model.history?.jobs.map(\.id), ["done-1"])
    }

    func testLoadMoreHistoryAppendsAndDeduplicatesJobs() async throws {
        let firstPage = historyPageJSON(
            jobs: [historyJobJSON(id: "job-a"), historyJobJSON(id: "job-b")],
            hasMore: true,
            nextCursor: "cursor-1"
        )
        let secondPage = historyPageJSON(
            jobs: [historyJobJSON(id: "job-b"), historyJobJSON(id: "job-c")],
            hasMore: false,
            nextCursor: nil
        )
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(done: 2, failed: 0, skipped: 0), stderr: ""),
            ProcessResult(exitCode: 0, stdout: firstPage, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: secondPage, stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.refresh()
        await model.loadMoreHistory()

        XCTAssertEqual(model.history?.jobs.map(\.id), ["job-a", "job-b", "job-c"])
        XCTAssertEqual(model.history?.pageInfo.hasMore, false)
        XCTAssertEqual(model.history?.pageInfo.nextCursor, nil)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"],
            ["history", "--json", "--limit", "10", "--before", "cursor-1"]
        ])
    }

    func testPauseDelegatesToCLIAndRecordsErrors() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "paused\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(uiState: "paused"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.pause()

        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.first?.arguments, ["pause"])
    }

    func testMutatingActionsRefreshStatusHistoryDoctorAndConfig() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "paused\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(uiState: "paused"), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.pause()

        XCTAssertEqual(model.status?.ui.state, .paused)
        XCTAssertEqual(model.history?.jobs.count, 0)
        XCTAssertEqual(model.config?.tts.voice, "af_heart")
        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["pause"],
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testTestVoiceCanSpeakCustomTextAndRefreshes() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: "ok\n", stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        await model.testVoice("Claude finished the refactor.")

        XCTAssertNil(model.lastError)
        let requests = await runner.capturedRequests()
        XCTAssertEqual(requests.map(\.arguments), [
            ["test", "Claude finished the refactor."],
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testAutoRefreshFirstTickPerformsFullRefresh() async throws {
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(done: 1), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        model.startAutoRefresh(everyNanoseconds: 5_000_000_000)
        try await waitForRequestCount(4, runner: runner)
        model.stopAutoRefresh()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(Array(requests.map(\.arguments).prefix(4)), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testAutoRefreshSecondTickRefreshesStatusOnly() async throws {
        // Tick 0 = full [status, history, doctor, config] (terminal counts recorded).
        // Tick 1 (default cadence, divisor 15) = [status] only; history skipped because
        // terminal counts are unchanged and diagnostics not yet due.
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(done: 1), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(done: 1), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        model.startAutoRefresh(everyNanoseconds: 1_000_000)
        try await waitForRequestCount(5, runner: runner)
        model.stopAutoRefresh()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(Array(requests.map(\.arguments).prefix(5)), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"],
            ["status", "--json"]
        ])
    }

    func testAutoRefreshStatusOnlyTickRefreshesHistoryWhenTerminalCountsChange() async throws {
        // Tick 0 = full [status, history, doctor, config]; terminal counts recorded (done: 1).
        // Tick 1 (default cadence, divisor 15 → diagnostics NOT due) returns done: 2, so the
        // changed-counts branch fires history on this status-only tick. The tick-1 request
        // sequence must be [status, history] and must NOT include doctor/config.
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(done: 1), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(done: 2), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        model.startAutoRefresh(everyNanoseconds: 1_000_000)
        try await waitForRequestCount(6, runner: runner)
        model.stopAutoRefresh()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(Array(requests.map(\.arguments).prefix(6)), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"],
            ["status", "--json"],
            ["history", "--json", "--limit", "10"]
        ])
    }

    func testAutoRefreshRunsDiagnosticsOnConfiguredCadence() async throws {
        // diagnosticsEveryTicks: 2 → tick 0 full, tick 1 status-only,
        // tick 2 status + doctor + config (history skipped, counts unchanged).
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(done: 1), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(done: 1), stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(done: 1), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyDoctorJSON, stderr: ""),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        model.startAutoRefresh(everyNanoseconds: 1_000_000, diagnosticsEveryTicks: 2)
        try await waitForRequestCount(8, runner: runner)
        model.stopAutoRefresh()

        let requests = await runner.capturedRequests()
        XCTAssertEqual(Array(requests.map(\.arguments).prefix(8)), [
            ["status", "--json"],
            ["history", "--json", "--limit", "10"],
            ["doctor", "--json"],
            ["config", "get"],
            ["status", "--json"],
            ["status", "--json"],
            ["doctor", "--json"],
            ["config", "get"]
        ])
    }

    func testAutoRefreshPreservesDiagnosticsErrorAcrossStatusOnlyTick() async throws {
        // Tick 0 full refresh: status OK, doctor FAILS → lastError carries the doctor error.
        // Tick 1 status-only refresh succeeds; the status section must NOT clobber the
        // live diagnostics error recorded on the previous full tick.
        let runner = RecordingRunner(results: [
            ProcessResult(exitCode: 0, stdout: statusJSON(done: 1), stderr: ""),
            ProcessResult(exitCode: 0, stdout: emptyHistoryJSON, stderr: ""),
            ProcessResult(exitCode: 1, stdout: "", stderr: "doctor exploded"),
            ProcessResult(exitCode: 0, stdout: fullConfigJSON(), stderr: ""),
            ProcessResult(exitCode: 0, stdout: statusJSON(done: 1), stderr: "")
        ])
        let cli = AgentVoiceCLI(executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"), runner: runner)
        let model = AppModel(cli: cli)

        model.startAutoRefresh(everyNanoseconds: 1_000_000)
        try await waitForRequestCount(5, runner: runner)
        model.stopAutoRefresh()

        let lastError = model.lastError
        XCTAssertNotNil(lastError)
        XCTAssertTrue(lastError?.contains("doctor:") == true, "Expected lastError to still contain the doctor failure, got: \(String(describing: lastError))")
    }

}
