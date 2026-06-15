public struct DoctorReport: Codable, Equatable, Sendable {
    public let version: Int
    public let checks: [DoctorCheck]

    public init(version: Int, checks: [DoctorCheck]) {
        self.version = version
        self.checks = checks
    }
}

public struct DoctorCheck: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let ok: Bool
    public let severity: Severity
    public let message: String
    public let action: String?

    public init(id: String, ok: Bool, severity: Severity, message: String, action: String?) {
        self.id = id
        self.ok = ok
        self.severity = severity
        self.message = message
        self.action = action
    }

    public enum Severity: String, Codable, Equatable, Sendable {
        case info
        case warning
        case error
    }
}
