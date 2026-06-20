import XCTest
@testable import AgentVoiceCore

final class SetupWindowModelTests: XCTestCase {
    // MARK: - Helpers

    private func status(
        daemonRunning: Bool,
        uiState: AgentVoiceUIState = .ready,
        attention: [String] = []
    ) -> AgentVoiceStatusSnapshot {
        AgentVoiceStatusSnapshot(
            version: 1,
            daemon: DaemonStatus(state: daemonRunning ? .running : .stopped, running: daemonRunning, pid: daemonRunning ? 42 : nil),
            queues: QueueCounts(pending: 0, processing: 0, done: 0, failed: 0, skipped: 0),
            config: ConfigSummary(enabled: true, agents: [:]),
            paths: PathSummary(home: "/tmp/av", config: "/tmp/av/config.json", db: "/tmp/av/queue.db"),
            ui: UIStatus(state: uiState, attention: attention)
        )
    }

    private func config(voice: String) -> AgentVoiceFullConfig {
        AgentVoiceFullConfig(tts: TTSConfig(kokoroScript: "/k.py", python: "/py", voice: voice, timeoutSeconds: 30))
    }

    private func doctor(_ checks: [DoctorCheck]) -> DoctorReport {
        DoctorReport(version: 1, checks: checks)
    }

    private func kokoroOK() -> DoctorCheck {
        DoctorCheck(id: SetupReadiness.kokoroScriptCheckID, ok: true, severity: .info, message: "ok", action: nil)
    }

    // MARK: - Readiness truth table

    func testReadyWhenEngineVoiceAndDaemonAllPresent() {
        let r = SetupReadiness.evaluate(
            status: status(daemonRunning: true),
            config: config(voice: "af_heart"),
            doctor: doctor([kokoroOK()]),
            kokoroPhase: .succeeded
        )
        XCTAssertTrue(r.enginePresent)
        XCTAssertTrue(r.voiceSet)
        XCTAssertTrue(r.daemonHealthy)
        XCTAssertTrue(r.isReady)
    }

    func testEnginePresentFromSucceededPhaseEvenWithoutDoctorCheck() {
        let r = SetupReadiness.evaluate(
            status: status(daemonRunning: true),
            config: config(voice: "af_heart"),
            doctor: doctor([]),
            kokoroPhase: .succeeded
        )
        XCTAssertTrue(r.enginePresent)
    }

    func testEnginePresentFromDoctorCheckEvenWhenPhaseIdle() {
        let r = SetupReadiness.evaluate(
            status: status(daemonRunning: true),
            config: config(voice: "af_heart"),
            doctor: doctor([kokoroOK()]),
            kokoroPhase: .idle
        )
        XCTAssertTrue(r.enginePresent)
    }

    func testEngineAbsentWhenPhaseNotSucceededAndNoDoctorConfirmation() {
        let r = SetupReadiness.evaluate(
            status: status(daemonRunning: true),
            config: config(voice: "af_heart"),
            doctor: doctor([]),
            kokoroPhase: .idle
        )
        XCTAssertFalse(r.enginePresent)
        XCTAssertFalse(r.isReady)
    }

    func testVoiceNotSetWhenBlankOrWhitespace() {
        let blank = SetupReadiness.evaluate(
            status: status(daemonRunning: true),
            config: config(voice: "   "),
            doctor: doctor([kokoroOK()]),
            kokoroPhase: .succeeded
        )
        XCTAssertFalse(blank.voiceSet)
        XCTAssertFalse(blank.isReady)
    }

    func testDaemonUnhealthyWhenNotRunning() {
        let r = SetupReadiness.evaluate(
            status: status(daemonRunning: false),
            config: config(voice: "af_heart"),
            doctor: doctor([kokoroOK()]),
            kokoroPhase: .succeeded
        )
        XCTAssertFalse(r.daemonHealthy)
        XCTAssertFalse(r.isReady)
    }

    func testConservativeWhenEverythingUnknown() {
        let r = SetupReadiness.evaluate(status: nil, config: nil, doctor: nil, kokoroPhase: .idle)
        XCTAssertFalse(r.enginePresent)
        XCTAssertFalse(r.voiceSet)
        XCTAssertFalse(r.daemonHealthy)
        XCTAssertFalse(r.isReady)
    }

    // MARK: - Per-concern health

    func testEngineHealthCriticalWhenAbsentOkWhenPresent() {
        let absent = SetupReadiness(enginePresent: false, voiceSet: false, daemonHealthy: false)
        XCTAssertEqual(SetupConcernHealth.status(for: .engine, readiness: absent, status: nil, doctor: nil), .critical)
        let present = SetupReadiness(enginePresent: true, voiceSet: true, daemonHealthy: true)
        XCTAssertEqual(SetupConcernHealth.status(for: .engine, readiness: present, status: nil, doctor: nil), .ok)
    }

    func testVoiceHealthBlockedByMissingEngine() {
        let noEngine = SetupReadiness(enginePresent: false, voiceSet: false, daemonHealthy: false)
        XCTAssertEqual(SetupConcernHealth.status(for: .voice, readiness: noEngine, status: nil, doctor: nil), .attention)
        let engineNoVoice = SetupReadiness(enginePresent: true, voiceSet: false, daemonHealthy: false)
        XCTAssertEqual(SetupConcernHealth.status(for: .voice, readiness: engineNoVoice, status: nil, doctor: nil), .critical)
        let allSet = SetupReadiness(enginePresent: true, voiceSet: true, daemonHealthy: false)
        XCTAssertEqual(SetupConcernHealth.status(for: .voice, readiness: allSet, status: nil, doctor: nil), .ok)
    }

    func testDaemonHealthAttentionWhenStopped() {
        let stopped = SetupReadiness(enginePresent: true, voiceSet: true, daemonHealthy: false)
        XCTAssertEqual(SetupConcernHealth.status(for: .daemon, readiness: stopped, status: nil, doctor: nil), .attention)
        let running = SetupReadiness(enginePresent: true, voiceSet: true, daemonHealthy: true)
        XCTAssertEqual(SetupConcernHealth.status(for: .daemon, readiness: running, status: nil, doctor: nil), .ok)
    }

    func testSummariesHealthAttentionWhenPaused() {
        let ready = SetupReadiness(enginePresent: true, voiceSet: true, daemonHealthy: true)
        let paused = status(daemonRunning: true, uiState: .paused, attention: ["system_paused"])
        XCTAssertEqual(SetupConcernHealth.status(for: .summaries, readiness: ready, status: paused, doctor: nil), .attention)
        let healthy = status(daemonRunning: true)
        XCTAssertEqual(SetupConcernHealth.status(for: .summaries, readiness: ready, status: healthy, doctor: nil), .ok)
    }

    // MARK: - Repair items + catch-all

    func testRepairItemsIncludeMappedChecks() {
        let report = doctor([
            DoctorCheck(id: "tts.kokoroScript.exists", ok: false, severity: .error, message: "missing", action: "Choose script"),
            DoctorCheck(id: "daemon.running", ok: false, severity: .warning, message: "stopped", action: "Start daemon")
        ])
        let items = SetupConcernHealth.repairItems(doctor: report, status: nil)
        XCTAssertTrue(items.contains { $0.id == "tts.kokoroScript.exists" })
        XCTAssertTrue(items.contains { $0.id == "daemon.running" })
    }

    func testRepairItemsSurfaceUnmappedFailingCheckAsCatchAll() {
        let report = doctor([
            DoctorCheck(id: "some.future.check", ok: false, severity: .error, message: "boom", action: "Fix it")
        ])
        let items = SetupConcernHealth.repairItems(doctor: report, status: nil)
        let catchAll = items.first { $0.id == "some.future.check" }
        XCTAssertNotNil(catchAll, "Unmapped failing checks must not silently vanish")
        XCTAssertEqual(catchAll?.action, "Fix it")
    }

    func testRepairItemsIgnoreUnmappedPassingChecks() {
        let report = doctor([
            DoctorCheck(id: "some.future.check", ok: true, severity: .info, message: "fine", action: nil)
        ])
        let items = SetupConcernHealth.repairItems(doctor: report, status: nil)
        XCTAssertFalse(items.contains { $0.id == "some.future.check" })
    }

    func testRepairItemsEmptyWhenClean() {
        XCTAssertTrue(SetupConcernHealth.repairItems(doctor: nil, status: nil).isEmpty)
    }

    // MARK: - Concern deep-link mapping

    func testConcernFromStepMapping() {
        XCTAssertEqual(SetupConcern.from(step: .kokoro), .engine)
        XCTAssertEqual(SetupConcern.from(step: .summaryVoice), .summaries)
        XCTAssertEqual(SetupConcern.from(step: .summaries), .summaries)
        XCTAssertEqual(SetupConcern.from(step: .agents), .agents)
        XCTAssertEqual(SetupConcern.from(step: .daemon), .daemon)
    }
}
