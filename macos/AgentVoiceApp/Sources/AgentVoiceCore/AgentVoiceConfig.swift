public struct ConfigSummary: Codable, Equatable, Sendable {
    public let enabled: Bool
    public let agents: [String: AgentSummary]

    public init(enabled: Bool, agents: [String: AgentSummary]) {
        self.enabled = enabled
        self.agents = agents
    }
}

public struct AgentSummary: Codable, Equatable, Sendable {
    public let enabled: Bool
    public let mode: String

    public init(enabled: Bool, mode: String) {
        self.enabled = enabled
        self.mode = mode
    }
}
