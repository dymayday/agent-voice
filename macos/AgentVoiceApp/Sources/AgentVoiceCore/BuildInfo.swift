import Foundation

/// Build metadata stamped into the packaged app by `scripts/build-macos-app.sh`
/// at `Contents/Resources/agent-voice/build-info.json`. Only `buildId` is
/// load-bearing — it gates the version-skew daemon restart; the rest is
/// diagnostic. Mirrors the TypeScript `BuildInfo` in `src/build-info.ts`.
public struct BuildInfo: Codable, Equatable, Sendable {
    public let buildId: String
    public let commit: String?
    public let version: String?
    public let builtAt: String?

    public init(buildId: String, commit: String? = nil, version: String? = nil, builtAt: String? = nil) {
        self.buildId = buildId
        self.commit = commit
        self.version = version
        self.builtAt = builtAt
    }

    /// Read the `buildId` from `build-info.json` in the given directory, or `nil`
    /// when the file is absent, unreadable, unparseable, or carries an empty id —
    /// the dev / source-tree case, where the app suppresses the auto-restart
    /// rather than act on a build id it cannot trust.
    public static func readBuildId(fromDirectory directory: URL) -> String? {
        let url = directory.appendingPathComponent("build-info.json")
        guard let data = try? Data(contentsOf: url),
              let info = try? JSONDecoder().decode(BuildInfo.self, from: data),
              !info.buildId.isEmpty
        else {
            return nil
        }
        return info.buildId
    }
}
