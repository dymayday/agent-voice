/// Per-agent hook install state, decoded from the status snapshot's `install`
/// map. Raw values mirror the TypeScript `AgentInstallState` union in
/// `src/install.ts` — keep the two in sync.
///
/// `.unknown` is both a real wire value (`"unknown"`, emitted when the CLI could
/// not complete the check — HOME unset, permission denied, corrupt settings) and
/// the decode fallback for any unrecognized or future state, so the app degrades
/// gracefully across daemon/app version skew. The dashboard renders it as a
/// neutral "Checking…" badge with no install action.
public enum InstallState: String, Codable, Equatable, Sendable {
    case installed
    case notInstalled = "not_installed"
    case unsupported
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = InstallState(rawValue: raw) ?? .unknown
    }
}

/// Map of agent name → install state, as published in the status snapshot.
/// Keys are the known `AgentName`s (claude, codex, pi, opencode); the TypeScript
/// producer guarantees the map is total. The field is optional because daemons
/// predating this feature do not emit it — a `nil` map means "not reported",
/// which the dashboard treats as `.unknown` per agent.
public typealias AgentInstallMap = [String: InstallState]

public struct AgentVoiceStatusSnapshot: Codable, Equatable, Sendable {
    public let version: Int
    public let daemon: DaemonStatus
    public let queues: QueueCounts
    public let config: ConfigSummary
    public let install: AgentInstallMap?
    public let paths: PathSummary
    public let ui: UIStatus

    public init(
        version: Int,
        daemon: DaemonStatus,
        queues: QueueCounts,
        config: ConfigSummary,
        install: AgentInstallMap? = nil,
        paths: PathSummary,
        ui: UIStatus
    ) {
        self.version = version
        self.daemon = daemon
        self.queues = queues
        self.config = config
        self.install = install
        self.paths = paths
        self.ui = ui
    }
}

public struct DaemonStatus: Codable, Equatable, Sendable {
    public let state: DaemonRunState
    public let running: Bool
    public let pid: Int?

    public init(state: DaemonRunState, running: Bool, pid: Int?) {
        self.state = state
        self.running = running
        self.pid = pid
    }
}

public struct QueueCounts: Codable, Equatable, Sendable {
    public let pending: Int
    public let processing: Int
    public let done: Int
    public let failed: Int
    public let skipped: Int

    public init(pending: Int, processing: Int, done: Int, failed: Int, skipped: Int) {
        self.pending = pending
        self.processing = processing
        self.done = done
        self.failed = failed
        self.skipped = skipped
    }
}

public struct PathSummary: Codable, Equatable, Sendable {
    public let home: String
    public let config: String
    public let db: String

    public init(home: String, config: String, db: String) {
        self.home = home
        self.config = config
        self.db = db
    }
}

public struct UIStatus: Codable, Equatable, Sendable {
    public let state: AgentVoiceUIState
    public let attention: [String]

    public init(state: AgentVoiceUIState, attention: [String]) {
        self.state = state
        self.attention = attention
    }
}
