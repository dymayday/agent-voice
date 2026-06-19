import XCTest
@testable import AgentVoiceCore

final class BuildInfoTests: XCTestCase {
    private func withTempDir(_ body: (URL) throws -> Void) rethrows {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("agent-voice-buildinfo-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        try body(dir)
    }

    private func write(_ contents: String, to dir: URL) throws {
        try Data(contents.utf8).write(to: dir.appendingPathComponent("build-info.json"))
    }

    func testReturnsNilWhenFileAbsent() throws {
        try withTempDir { dir in
            XCTAssertNil(BuildInfo.readBuildId(fromDirectory: dir))
        }
    }

    func testReadsBuildIdWhenPresentAndValid() throws {
        try withTempDir { dir in
            try write(
                #"{ "buildId": "c2d0a4e1c476+1781891118", "commit": "c2d0a4e1c476", "version": "0.1.0" }"#,
                to: dir
            )
            XCTAssertEqual(BuildInfo.readBuildId(fromDirectory: dir), "c2d0a4e1c476+1781891118")
        }
    }

    func testReturnsNilWhenJSONInvalid() throws {
        try withTempDir { dir in
            try write("{ not valid json", to: dir)
            XCTAssertNil(BuildInfo.readBuildId(fromDirectory: dir))
        }
    }

    func testReturnsNilWhenBuildIdEmpty() throws {
        try withTempDir { dir in
            try write(#"{ "buildId": "" }"#, to: dir)
            XCTAssertNil(BuildInfo.readBuildId(fromDirectory: dir))
        }
    }
}
