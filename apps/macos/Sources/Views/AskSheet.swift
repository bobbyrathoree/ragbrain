import SwiftUI

struct AskSheet: View {
    @EnvironmentObject var askManager: AskManager
    @Environment(\.dismiss) var dismiss

    @State private var query = ""
    @State private var selectedTags: [String] = []
    @State private var timeWindow: TimeWindow = .all
    @FocusState private var isQueryFocused: Bool

    enum TimeWindow: String, CaseIterable {
        case today = "Today"
        case week = "This Week"
        case month = "This Month"
        case all = "All Time"

        var apiValue: String? {
            switch self {
            case .today: return "today"
            case .week: return "week"
            case .month: return "month"
            case .all: return nil
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Image(systemName: "sparkles")
                    .font(.title3)
                    .foregroundStyle(.purple)
                    .symbolEffect(.pulse)

                Text("Ask Your Knowledge Base")
                    .font(.headline)

                Spacer()

                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.escape, modifiers: [])
            }
            .padding()

            Divider()

            // Query input
            HStack(spacing: 12) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)

                TextField("What do you want to know?", text: $query)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .focused($isQueryFocused)
                    .onSubmit {
                        submitQuery()
                    }

                if askManager.isLoading {
                    ProgressView()
                        .scaleEffect(0.8)
                }
            }
            .padding()

            // Filters
            HStack {
                Picker("Time", selection: $timeWindow) {
                    ForEach(TimeWindow.allCases, id: \.self) { window in
                        Text(window.rawValue).tag(window)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 300)

                Spacer()

                if !askManager.recentQueries.isEmpty {
                    Menu {
                        ForEach(askManager.recentQueries, id: \.self) { recentQuery in
                            Button(recentQuery) {
                                query = recentQuery
                                submitQuery()
                            }
                        }
                    } label: {
                        Label("Recent", systemImage: "clock")
                            .font(.caption)
                    }
                    .menuStyle(.borderlessButton)
                }
            }
            .padding(.horizontal)
            .padding(.bottom)

            Divider()

            // Results area
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let error = askManager.error {
                        ErrorView(error: error) {
                            submitQuery()
                        }
                    } else if let answer = askManager.answer {
                        AnswerView(answer: answer)
                    } else if askManager.isLoading {
                        LoadingView()
                    } else {
                        EmptyStateView()
                    }
                }
                .padding()
            }
            .frame(minHeight: 300, maxHeight: 500)

            Divider()

            // Footer
            HStack {
                if let answer = askManager.answer {
                    Text("Answered in \(answer.processingTime)ms")
                        .font(.caption)
                        .foregroundStyle(.tertiary)

                    Text("Confidence: \(Int(answer.confidence * 100))%")
                        .font(.caption)
                        .foregroundStyle(confidenceColor(answer.confidence))
                }

                Spacer()

                Button("Ask") {
                    submitQuery()
                }
                .keyboardShortcut(.return, modifiers: [.command])
                .buttonStyle(.borderedProminent)
                .disabled(query.isEmpty || askManager.isLoading)
            }
            .padding()
        }
        .frame(width: 700, height: 600)
        .background(.ultraThinMaterial)
        .onAppear {
            isQueryFocused = true
        }
    }

    private func submitQuery() {
        guard !query.isEmpty else { return }
        Task {
            await askManager.ask(
                query,
                tags: selectedTags.isEmpty ? nil : selectedTags,
                timeWindow: timeWindow.apiValue
            )
        }
    }

    private func confidenceColor(_ confidence: Double) -> Color {
        switch confidence {
        case 0.8...1.0: return .green
        case 0.5..<0.8: return .orange
        default: return .red
        }
    }
}

// MARK: - Answer View
struct AnswerView: View {
    let answer: AskAnswer

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Answer text
            Text(answer.text)
                .font(.body)
                .textSelection(.enabled)
                .padding()
                .background(Color.purple.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 12))

            // Citations
            if !answer.citations.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Sources")
                        .font(.headline)
                        .foregroundStyle(.secondary)

                    ForEach(Array(answer.citations.enumerated()), id: \.element.id) { index, citation in
                        CitationRow(index: index + 1, citation: citation)
                    }
                }
            }
        }
    }
}

struct CitationRow: View {
    let index: Int
    let citation: Citation

    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                Text("[\(index)]")
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundStyle(.purple)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Image(systemName: iconForType(citation.type))
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        if let date = citation.createdAtDate {
                            Text(date, style: .date)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        Text("\(Int(citation.score * 100))% match")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }

                    Text(citation.preview)
                        .font(.callout)
                        .lineLimit(isExpanded ? nil : 2)
                        .foregroundStyle(.primary)

                    if !citation.tags.isEmpty {
                        HStack {
                            ForEach(citation.tags.prefix(3), id: \.self) { tag in
                                Text("#\(tag)")
                                    .font(.caption2)
                                    .foregroundStyle(.blue)
                            }
                        }
                    }
                }
            }
            .padding(12)
            .background(Color.secondary.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .onTapGesture {
                withAnimation {
                    isExpanded.toggle()
                }
            }
        }
    }

    private func iconForType(_ type: String) -> String {
        switch type {
        case "code": return "chevron.left.forwardslash.chevron.right"
        case "decision": return "arrow.triangle.branch"
        case "link": return "link"
        case "todo": return "checklist"
        case "rationale": return "lightbulb"
        default: return "note.text"
        }
    }
}

// MARK: - Supporting Views
struct LoadingView: View {
    @State private var dots = ""

    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.5)

            Text("Searching your knowledge base\(dots)")
                .font(.headline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
                dots = dots.count >= 3 ? "" : dots + "."
            }
        }
    }
}

struct EmptyStateView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "sparkles")
                .font(.system(size: 48))
                .foregroundStyle(.purple.opacity(0.5))

            Text("Ask a question about your notes")
                .font(.headline)
                .foregroundStyle(.secondary)

            Text("Your answer will include citations from your captured thoughts")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ErrorView: View {
    let error: AskError
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundStyle(.orange)

            Text(error.localizedDescription)
                .font(.headline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button("Try Again") {
                onRetry()
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
