import XCTest
@testable import AgentVoiceCore

final class SummarizerConfigDecodingTests: XCTestCase {
    private func decode(_ json: String) throws -> AgentVoiceFullConfig {
        try JSONDecoder().decode(AgentVoiceFullConfig.self, from: Data(json.utf8))
    }

    func testMissingKnobFieldsFallBackToDefaults() throws {
        let json = """
        {
          "tts": {"kokoroScript": "", "python": "python3", "voice": "af_heart", "timeoutSeconds": 30},
          "summarizer": {"thinking": "off", "piModel": "p", "codexModel": "c", "opencodeModel": null, "priority": ["pi-fast","heuristic"]}
        }
        """
        let config = try decode(json)
        XCTAssertEqual(config.summarizer.promptStyle, "default")
        XCTAssertEqual(config.summarizer.maxSentences, 1)
        XCTAssertEqual(config.summarizer.maxSummaryChars, 180)
    }

    func testSpeakQuestionsVerbatimDefaultsTrueAndDecodes() throws {
        let missing = try decode("""
        {
          "tts": {"kokoroScript": "", "python": "python3", "voice": "af_heart", "timeoutSeconds": 30},
          "summarizer": {"thinking": "off", "piModel": "p", "codexModel": "c", "opencodeModel": null, "priority": ["pi-fast","heuristic"]}
        }
        """)
        XCTAssertTrue(missing.summarizer.speakQuestionsVerbatim)

        let present = try decode("""
        {
          "tts": {"kokoroScript": "", "python": "python3", "voice": "af_heart", "timeoutSeconds": 30},
          "summarizer": {"thinking": "off", "piModel": "p", "codexModel": "c", "opencodeModel": null, "priority": ["pi-fast","heuristic"], "speakQuestionsVerbatim": false}
        }
        """)
        XCTAssertFalse(present.summarizer.speakQuestionsVerbatim)
    }

    func testKnobFieldsAreDecodedWhenPresent() throws {
        let json = """
        {
          "tts": {"kokoroScript": "", "python": "python3", "voice": "af_heart", "timeoutSeconds": 30},
          "summarizer": {"thinking": "off", "piModel": "p", "codexModel": "c", "opencodeModel": null, "priority": ["pi-fast","heuristic"], "promptStyle": "triage", "maxSentences": 3, "maxSummaryChars": 260}
        }
        """
        let config = try decode(json)
        XCTAssertEqual(config.summarizer.promptStyle, "triage")
        XCTAssertEqual(config.summarizer.maxSentences, 3)
        XCTAssertEqual(config.summarizer.maxSummaryChars, 260)
    }
}
