import AgentVoiceCore
import SwiftUI

struct AttentionDetailView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Attention details")
                    .font(.largeTitle.bold())
                    .accessibilityAddTraits(.isHeader)

                attentionMessagesSection
                doctorIssuesSection
                failedJobsSection
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
        }
        .frame(minWidth: 620, minHeight: 480)
        .onAppear { model.startAutoRefresh() }
        .onDisappear { model.stopAutoRefresh() }
    }
}

private extension AttentionDetailView {
    var attentionMessagesSection: some View {
        Text("Attention messages")
    }

    var doctorIssuesSection: some View {
        Text("Doctor checks needing review")
    }

    var failedJobsSection: some View {
        Text("Failed jobs and recent errors")
    }
}
