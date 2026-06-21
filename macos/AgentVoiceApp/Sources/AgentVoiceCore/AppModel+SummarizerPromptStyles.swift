import Foundation

public struct SummarizerPromptStyleInfo: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let detail: String
    public let example: String

    public init(id: String, name: String, detail: String, example: String) {
        self.id = id
        self.name = name
        self.detail = detail
        self.example = example
    }
}

extension AppModel {
    public nonisolated static var kokoroVoicePresets: [String] {
        [
            "af_heart",
            "af_sky",
            "af_bella",
            "af_nicole",
            "am_adam",
            "am_michael",
            "bf_emma",
            "bm_george"
        ]
    }

    public nonisolated static var summarizerThinkingOptions: [String] {
        ["off", "minimal", "low", "medium", "high", "xhigh"]
    }

    public nonisolated static var summarizerPromptStyleCatalog: [SummarizerPromptStyleInfo] {
        [
            .init(
                id: "default",
                name: "Default",
                detail: "A neutral summary of what happened.",
                example: "Updated the fee calculation and reran the tests."
            ),
            .init(
                id: "terse",
                name: "Terse",
                detail: "Fewest words, outcome first.",
                example: "Fee split done; tests pass."
            ),
            .init(
                id: "status-about",
                name: "Status + topic",
                detail: "State first, then the subject.",
                example: "Done — split client and platform fees."
            ),
            .init(
                id: "triage",
                name: "Triage",
                detail: "Leads with what you need to do.",
                example: "Need your call — which auth provider?"
            ),
            .init(
                id: "conversational",
                name: "Conversational",
                detail: "Warm, first person.",
                example: "I wired up the fee split and it's green."
            ),
            .init(
                id: "adaptive",
                name: "Adaptive",
                detail: "Picks the best register for each message.",
                example: "Reads the moment — an ask when you're needed, a quick result otherwise."
            )
        ]
    }

    public nonisolated static var summarizerPromptStyleOptions: [String] {
        summarizerPromptStyleCatalog.map(\.id)
    }
}
