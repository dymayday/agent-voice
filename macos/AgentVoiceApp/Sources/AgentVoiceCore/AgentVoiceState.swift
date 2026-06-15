public enum AgentVoiceUIState: String, Codable, Equatable, Sendable {
    case ready
    case processing
    case paused
    case needsAttention = "needs_attention"
    case daemonStopped = "daemon_stopped"

    public var displayName: String {
        switch self {
        case .ready:
            "Ready"
        case .processing:
            "Processing"
        case .paused:
            "Paused"
        case .needsAttention:
            "Needs Attention"
        case .daemonStopped:
            "Daemon Stopped"
        }
    }
}

public enum DaemonRunState: String, Codable, Equatable, Sendable {
    case running
    case stale
    case stopped
}
