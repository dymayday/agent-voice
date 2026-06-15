public enum SetupStep: String, CaseIterable, Identifiable, Equatable, Sendable {
    case welcome
    case kokoro
    case summaries
    case agents
    case daemon
    case finish

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .welcome:
            "Welcome"
        case .kokoro:
            "Kokoro"
        case .summaries:
            "Summaries"
        case .agents:
            "Agents"
        case .daemon:
            "Daemon"
        case .finish:
            "Finish"
        }
    }
}

public struct SetupCheck: Identifiable, Equatable, Sendable {
    public let id: String
    public let ok: Bool
    public let title: String
    public let detail: String
    public let targetStep: SetupStep
    public let action: String?

    public init(id: String, ok: Bool, title: String, detail: String, targetStep: SetupStep, action: String?) {
        self.id = id
        self.ok = ok
        self.title = title
        self.detail = detail
        self.targetStep = targetStep
        self.action = action
    }
}

public enum SetupAction: Equatable, Sendable {
    case enableAgent(String)
    case disableAgent(String)
    case summarizerMode(String)
}

public enum SetupAssistantModel {
    public static func checks(from report: DoctorReport?, status: AgentVoiceStatusSnapshot?) -> [SetupCheck] {
        var checks: [SetupCheck] = []
        if let report {
            checks.append(contentsOf: report.checks.compactMap(check(from:)))
        }
        if let status, status.ui.attention.contains("system_paused") {
            checks.append(SetupCheck(
                id: "system.paused",
                ok: false,
                title: "Speech is paused",
                detail: "Agent Voice is disabled in config.",
                targetStep: .summaries,
                action: "Resume speech"
            ))
        }
        return checks
    }

    private static func check(from doctorCheck: DoctorCheck) -> SetupCheck? {
        let target: SetupStep
        switch doctorCheck.id {
        case "tts.kokoroScript.exists":
            target = .kokoro
        case "daemon.running":
            target = .daemon
        case "queue.failed.empty":
            target = .finish
        default:
            return nil
        }
        return SetupCheck(
            id: doctorCheck.id,
            ok: doctorCheck.ok,
            title: doctorCheck.message,
            detail: doctorCheck.message,
            targetStep: target,
            action: doctorCheck.action
        )
    }

    public static func command(for action: SetupAction) -> [String] {
        switch action {
        case .enableAgent(let agent):
            ["enable", agent]
        case .disableAgent(let agent):
            ["disable", agent]
        case .summarizerMode(let mode):
            ["summarizer", "mode", mode]
        }
    }
}
