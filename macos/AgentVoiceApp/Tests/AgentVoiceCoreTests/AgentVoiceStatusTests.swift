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
              "codex": { "enabled": true, "mode": "native" },
              "pi": { "enabled": true, "mode": "native" },
              "opencode": { "enabled": false, "mode": "native" }
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

    func testDecodesBuildIdWhenPresent() throws {
        let data = Data("""
        {
          "version": 1,
          "buildId": "c2d0a4e1c476+1781891118",
          "daemon": { "state": "running", "running": true, "pid": 1 },
          "queues": { "pending": 0, "processing": 0, "done": 0, "failed": 0, "skipped": 0 },
          "config": { "enabled": true, "agents": {} },
          "paths": { "home": "/h", "config": "/h/c.json", "db": "/h/q.db" },
          "ui": { "state": "ready", "attention": [] }
        }
        """.utf8)

        let snapshot = try JSONDecoder().decode(AgentVoiceStatusSnapshot.self, from: data)

        XCTAssertEqual(snapshot.buildId, "c2d0a4e1c476+1781891118")
    }

    func testDecodesSnapshotWithoutBuildIdAsNil() throws {
        // A daemon predating the build-id field omits it; decoding must yield nil
        // so the app simply skips the version-skew restart (graceful degradation).
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

        XCTAssertNil(snapshot.buildId)
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

    func testDecodesEveryKnownInstallStateRawValue() throws {
        // Pins the exact TS `AgentInstallState` wire strings (src/install.ts) to
        // the Swift cases. "unknown" is a real wire value here, not the decode
        // fallback — guarding both sides of the cross-language contract.
        let data = Data("""
        {
          "version": 1,
          "daemon": { "state": "running", "running": true, "pid": 1 },
          "queues": { "pending": 0, "processing": 0, "done": 0, "failed": 0, "skipped": 0 },
          "config": { "enabled": true, "agents": {} },
          "install": { "pi": "installed", "claude": "not_installed", "codex": "unsupported", "opencode": "unknown" },
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
}
