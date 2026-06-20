import XCTest

final class SetupAssistantViewSourceTests: XCTestCase {
    func testSummaryVoiceTabShowsPromptPreviewDisclosure() throws {
        let source = try appSources()
        XCTAssertTrue(source.contains("What the model is told"))
        XCTAssertTrue(source.contains("model.summaryVoicePromptPreview"))
        XCTAssertTrue(source.contains("model.refreshSummaryVoicePrompt()"))
        XCTAssertTrue(source.contains("Button(\"Copy\")"))
        // Refresh is driven by the open state + drafts so changing style while open updates it.
        XCTAssertTrue(source.contains("isExpanded: $promptExpanded"))
        XCTAssertTrue(source.contains("guard promptExpanded else { return }"))
    }

    func testSummaryVoiceTabRendersStyleLengthAndQuestionControls() throws {
        let source = try appSources()
        XCTAssertTrue(source.contains("case .summaryVoice:"))
        XCTAssertTrue(source.contains("summaryVoiceContent"))
        XCTAssertTrue(source.contains("AppModel.summarizerPromptStyleCatalog"))
        XCTAssertTrue(source.contains("model.draftMaxSentences"))
        XCTAssertTrue(source.contains("model.draftMaxSummaryChars"))
        XCTAssertTrue(source.contains("model.draftSpeakQuestionsVerbatim"))
        XCTAssertTrue(source.contains("Speak questions and approvals word-for-word"))
        XCTAssertTrue(source.contains("Button(\"Save changes\")"))
        XCTAssertTrue(source.contains("model.saveSummaryVoice()"))
        XCTAssertTrue(source.contains("model.summaryVoiceCanSave"))
    }
}
