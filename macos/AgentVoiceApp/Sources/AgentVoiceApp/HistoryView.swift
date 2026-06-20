import AgentVoiceCore
import SwiftUI

private enum HistoryStatusFilter: String, CaseIterable, Identifiable {
    case all
    case done
    case failed
    case skipped

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "All"
        case .done: "Done"
        case .failed: "Failed"
        case .skipped: "Skipped"
        }
    }

    func matches(_ status: HistoryJobStatus) -> Bool {
        switch self {
        case .all: true
        case .done: status == .done
        case .failed: status == .failed
        case .skipped: status == .skipped
        }
    }
}

struct HistoryView: View {
    @ObservedObject var model: AppModel
    @State private var statusFilter: HistoryStatusFilter = .all
    @State private var highlightedJobID: String?
    @State private var highlightTask: Task<Void, Never>?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    filterPicker
                    jobList
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
            }
            .onAppear {
                model.startAutoRefresh()
                focusRequestedJob(using: proxy)
            }
            .onDisappear { model.stopAutoRefresh() }
            .onChange(of: model.focusedHistoryJobID) { _ in
                focusRequestedJob(using: proxy)
            }
        }
        .frame(minWidth: 720, minHeight: 560)
    }
}

private extension HistoryView {
    var filteredJobs: [AgentVoiceHistoryJob] {
        (model.history?.jobs ?? []).filter { statusFilter.matches($0.status) }
    }

    var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text("History")
                .font(.largeTitle.bold())
                .accessibilityAddTraits(.isHeader)
            Spacer()
            Text("\(filteredJobs.count) shown")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button("Refresh") {
                Task { await model.refreshHistory() }
            }
            .disabled(model.isLoadingHistoryPage)
        }
    }

    var filterPicker: some View {
        Picker("Filter", selection: $statusFilter) {
            ForEach(HistoryStatusFilter.allCases) { filter in
                Text(filter.title).tag(filter)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .accessibilityLabel("Filter history by status")
    }

    @ViewBuilder
    var jobList: some View {
        if model.history == nil {
            Text("History unavailable")
                .foregroundStyle(.secondary)
        } else if filteredJobs.isEmpty {
            Text("No jobs for this filter.")
                .foregroundStyle(.secondary)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(filteredJobs) { job in
                    jobCard(job)
                        .id(job.id)
                }
                loadMoreFooter
            }
        }
    }

    @ViewBuilder
    var loadMoreFooter: some View {
        if model.history?.pageInfo.hasMore == true {
            Button(model.isLoadingHistoryPage ? "Loading…" : "Load more") {
                Task { await model.loadMoreHistory() }
            }
            .disabled(model.isLoadingHistoryPage)
        } else {
            Text("No more loaded history pages.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    func jobCard(_ job: AgentVoiceHistoryJob) -> some View {
        let isHighlighted = highlightedJobID == job.id
        let tint = jobStatusTint(job.status)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(job.agent.capitalized)
                    .font(.headline)
                Spacer()
                Text(job.status.rawValue.capitalized)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(tint)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(tint.opacity(0.12))
                    .clipShape(Capsule())
            }

            Text(job.summary ?? "No summary recorded")
                .font(.body)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)

            labeledRow("Created", job.createdAt)
            labeledRow("Finished", job.finishedAt ?? "Not finished")
            labeledRow("Attempts", String(job.attempts))
            labeledRow("Working directory", job.cwd ?? "None")
            labeledRow("Summarizer used", job.summarizerUsed ?? "None")
            labeledRow("Skip reason", job.skipReason ?? "None")

            if let lastError = job.lastError, !lastError.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Last error")
                        .font(.subheadline.bold())
                    diagnosticTextBlock(lastError)
                }
            }

            DisclosureGroup("Full raw job text") {
                diagnosticTextBlock(job.text.isEmpty ? "No raw job text recorded" : job.text)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background((isHighlighted ? Color.accentColor : tint).opacity(isHighlighted ? 0.16 : 0.08))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(
                    isHighlighted ? Color.accentColor : tint.opacity(0.24),
                    lineWidth: isHighlighted ? 3 : 1
                )
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .animation(.easeInOut(duration: 0.25), value: isHighlighted)
    }

    func labeledRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(value)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .font(.subheadline)
        .accessibilityElement(children: .combine)
    }

    func diagnosticTextBlock(_ text: String) -> some View {
        Text(text)
            .font(.system(.body, design: .monospaced))
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(Color.secondary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    func jobStatusTint(_ status: HistoryJobStatus) -> Color {
        switch status {
        case .done: .green
        case .failed: .red
        case .skipped: .secondary
        }
    }

    /// Scrolls the requested job into view and flashes a highlight that fades
    /// after ~2s. Resets the filter to `.all` first so the target is always
    /// visible, then consumes the request (nil) so re-selecting the same job
    /// triggers `onChange` again.
    func focusRequestedJob(using proxy: ScrollViewProxy) {
        guard let id = model.focusedHistoryJobID else { return }
        statusFilter = .all
        model.focusHistoryJob(nil)

        DispatchQueue.main.async {
            withAnimation { proxy.scrollTo(id, anchor: .top) }
        }

        highlightTask?.cancel()
        highlightedJobID = id
        highlightTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled else { return }
            withAnimation { highlightedJobID = nil }
        }
    }
}
