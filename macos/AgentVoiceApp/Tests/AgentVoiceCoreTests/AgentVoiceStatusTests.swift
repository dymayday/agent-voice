import XCTest
@testable import AgentVoiceCore

final class AgentVoiceStatusTests: XCTestCase {
    func testDecodesStatusSnapshotAndDerivesReadyState() throws {
        let data = Data("""
        {
          "version": 1,
          "daemon": { "state": "running", "running": true, "pid": 123 },
          "queues": { "pending": 0, "processing": 0, "done": 2, "failed": 0, "skipped": 0 },
          "config": {
            "enabled": true,
            "agents": {
              "claude": { "enabled": true, "mode": "native" },
              "codex": { "enabled": true, "mode": "wrapper-required-native-optional" },
              "pi": { "enabled": true, "mode": "native" },
              "opencode": { "enabled": false, "mode": "wrapper-required-native-optional" }
            }
          },
          "paths": { "home": "/tmp/agent-voice", "config": "/tmp/agent-voice/config.json", "db": "/tmp/agent-voice/queue.db" },
          "ui": { "state": "ready", "attention": [] }
        }
        """.utf8)

        let snapshot = try JSONDecoder().decode(AgentVoiceStatusSnapshot.self, from: data)

        XCTAssertEqual(snapshot.version, 1)
        XCTAssertEqual(snapshot.daemon.state, .running)
        XCTAssertEqual(snapshot.ui.state, .ready)
        XCTAssertEqual(snapshot.queues.done, 2)
        XCTAssertEqual(snapshot.config.agents["opencode"]?.enabled, false)
    }

    func testDisplayStateLabels() {
        XCTAssertEqual(AgentVoiceUIState.ready.displayName, "Ready")
        XCTAssertEqual(AgentVoiceUIState.daemonStopped.displayName, "Daemon Stopped")
    }

    func testDecodesInstallStateMapWithUnknownFallback() throws {
        let data = Data("""
        {
          "version": 1,
          "daemon": { "state": "running", "running": true, "pid": 1 },
          "queues": { "pending": 0, "processing": 0, "done": 0, "failed": 0, "skipped": 0 },
          "config": { "enabled": true, "agents": {} },
          "install": { "pi": "installed", "claude": "not_installed", "codex": "unsupported", "opencode": "weird" },
          "paths": { "home": "/h", "config": "/h/c.json", "db": "/h/q.db" },
          "ui": { "state": "ready", "attention": [] }
        }
        """.utf8)

        let snapshot = try JSONDecoder().decode(AgentVoiceStatusSnapshot.self, from: data)

        XCTAssertEqual(snapshot.install?["pi"], .installed)
        XCTAssertEqual(snapshot.install?["claude"], .notInstalled)
        XCTAssertEqual(snapshot.install?["codex"], .unsupported)
        XCTAssertEqual(snapshot.install?["opencode"], .unknown)
    }

    func testDecodesSnapshotWithoutInstallFieldAsNil() throws {
        let data = Data("""
        {
          "version": 1,
          "daemon": { "state": "running", "running": true, "pid": 1 },
          "queues": { "pending": 0, "processing": 0, "done": 0, "failed": 0, "skipped": 0 },
          "config": { "enabled": true, "agents": {} },
          "paths": { "home": "/h", "config": "/h/c.json", "db": "/h/q.db" },
          "ui": { "state": "ready", "attention": [] }
        }
        """.utf8)

        let snapshot = try JSONDecoder().decode(AgentVoiceStatusSnapshot.self, from: data)

        XCTAssertNil(snapshot.install)
    }
}
