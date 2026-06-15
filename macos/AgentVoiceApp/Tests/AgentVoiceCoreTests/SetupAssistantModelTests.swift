import XCTest
@testable import AgentVoiceCore

final class SetupAssistantModelTests: XCTestCase {
    func testInitialStepsAreStable() {
        XCTAssertEqual(SetupStep.allCases.map(\.title), [
            "Welcome",
            "Kokoro",
            "Summaries",
            "Agents",
            "Daemon",
            "Finish"
        ])
    }

    func testDoctorFailuresMapToRepairChecks() {
        let report = DoctorReport(version: 1, checks: [
            DoctorCheck(
                id: "tts.kokoroScript.exists",
                ok: false,
                severity: .error,
                message: "missing",
                action: "Choose script"
            ),
            DoctorCheck(
                id: "daemon.running",
                ok: false,
                severity: .warning,
                message: "stopped",
                action: "Start daemon"
            )
        ])

        let checks = SetupAssistantModel.checks(from: report, status: nil)

        XCTAssertEqual(checks.map(\.targetStep), [.kokoro, .daemon])
        XCTAssertEqual(checks.first?.action, "Choose script")
    }

    func testPausedStatusMapsToSummaryRepairCheck() {
        let status = AgentVoiceStatusSnapshot(
            version: 1,
            daemon: DaemonStatus(state: .running, running: true, pid: 123),
            queues: QueueCounts(pending: 0, processing: 0, done: 0, failed: 0, skipped: 0),
            config: ConfigSummary(enabled: false, agents: [:]),
            paths: PathSummary(home: "/tmp/av", config: "/tmp/av/config.json", db: "/tmp/av/queue.db"),
            ui: UIStatus(state: .paused, attention: ["system_paused"])
        )

        let checks = SetupAssistantModel.checks(from: nil, status: status)

        XCTAssertTrue(checks.contains { $0.id == "system.paused" && $0.targetStep == .summaries })
    }

    func testAgentActionsAreExplicitCommands() {
        XCTAssertEqual(SetupAssistantModel.command(for: .enableAgent("claude")), ["enable", "claude"])
        XCTAssertEqual(SetupAssistantModel.command(for: .disableAgent("opencode")), ["disable", "opencode"])
        XCTAssertEqual(
            SetupAssistantModel.command(for: .summarizerMode("heuristic")),
            ["summarizer", "mode", "heuristic"]
        )
    }
}
