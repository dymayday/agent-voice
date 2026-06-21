import AgentVoiceCore
import SwiftUI

/// Shared summarizer model editor used by Dashboard and Setup. Business logic
/// stays in AppModel; this view only binds the draft field and invokes actions.
struct SummarizerModelControls: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(model.summarizerModelInUseLabel)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 12)
                Text(model.summarizerModelInUseValue)
                    .multilineTextAlignment(.trailing)
                    .lineLimit(2)
                    .textSelection(.enabled)
            }
            .font(.subheadline)
            .accessibilityElement(children: .combine)

            HStack {
                TextField("Model identifier", text: $model.draftSummarizerModel)
                    .textFieldStyle(.roundedBorder)

                Button("Save") {
                    Task { await model.saveSummarizerModel() }
                }
                .disabled(
                    !model.isSummarizerModelEditable
                        || model.draftSummarizerModel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                )

                Button("Validate") {
                    Task { await model.validateSummarizerModel() }
                }
                .disabled(
                    !model.isSummarizerModelEditable
                        || model.draftSummarizerModel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                )
            }

            if !model.availableSummarizerModels.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Choose from models discovered at startup")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Menu("Use known model") {
                        ForEach(model.availableSummarizerModels, id: \.self) { availableModel in
                            Button(availableModel) {
                                model.draftSummarizerModel = availableModel
                            }
                        }
                    }
                    .disabled(!model.isSummarizerModelEditable)
                }
            }

            if !model.isSummarizerModelEditable {
                Text("Summarizer model cannot be determined from current config")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
