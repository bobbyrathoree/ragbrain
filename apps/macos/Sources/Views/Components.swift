import SwiftUI

// MARK: - Sidebar View
struct SidebarView: View {
    @Binding var selectedView: ContentView.ViewMode
    @Binding var searchQuery: String
    @State private var isSearching = false

    var body: some View {
        VStack(spacing: 0) {
            // Search bar
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)

                TextField("Search thoughts...", text: $searchQuery)
                    .textFieldStyle(.plain)

                if !searchQuery.isEmpty {
                    Button {
                        searchQuery = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(8)
            .background(Color.secondary.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .padding()

            // View mode list
            List(ContentView.ViewMode.allCases, id: \.self, selection: $selectedView) { mode in
                Label(mode.rawValue, systemImage: mode.icon)
                    .tag(mode)
            }
            .listStyle(.sidebar)

            Divider()

            // Quick stats
            VStack(alignment: .leading, spacing: 8) {
                StatRow(label: "Total Thoughts", value: "1,234")
                StatRow(label: "This Week", value: "47")
                StatRow(label: "Tags", value: "23")
            }
            .padding()
            .background(Color.secondary.opacity(0.05))
        }
        .frame(minWidth: 200)
    }
}

struct StatRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.caption)
                .fontWeight(.medium)
        }
    }
}

// MARK: - Minimap View
struct MinimapView: View {
    var body: some View {
        Canvas { context, size in
            // Draw simplified version of the graph
            let dotCount = 50
            for i in 0..<dotCount {
                let x = CGFloat.random(in: 10...(size.width - 10))
                let y = CGFloat.random(in: 10...(size.height - 10))
                let rect = CGRect(x: x - 2, y: y - 2, width: 4, height: 4)
                context.fill(Ellipse().path(in: rect), with: .color(.blue.opacity(0.6)))
            }
        }
        .background(Color.black.opacity(0.3))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Cluster Legend
struct ClusterLegend: View {
    let clusters = [
        ("Work", Color.blue),
        ("Personal", Color.green),
        ("Ideas", Color.purple),
        ("Decisions", Color.orange)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Clusters")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)

            ForEach(clusters, id: \.0) { cluster in
                HStack(spacing: 6) {
                    Circle()
                        .fill(cluster.1)
                        .frame(width: 8, height: 8)
                    Text(cluster.0)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Thought Stream View
struct ThoughtStreamView: View {
    let date: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(date, style: .date)
                .font(.headline)
                .padding(.horizontal)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(0..<5) { _ in
                        ThoughtPreviewCard()
                    }
                }
                .padding(.horizontal)
            }
        }
        .padding(.vertical)
        .background(Color.secondary.opacity(0.05))
    }
}

struct ThoughtPreviewCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Sample thought preview...")
                .font(.caption)
                .lineLimit(3)

            HStack {
                Text("#tag")
                    .font(.caption2)
                    .foregroundStyle(.blue)
                Spacer()
                Text("2:30 PM")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(8)
        .frame(width: 150)
        .background(Color.secondary.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Constellation Controls
struct ConstellationControls: View {
    @State private var showConnections = true
    @State private var brightness: Double = 0.8

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Toggle("Show Connections", isOn: $showConnections)
                .font(.caption)

            VStack(alignment: .leading, spacing: 4) {
                Text("Brightness")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Slider(value: $brightness, in: 0.2...1.0)
            }
        }
        .padding(12)
        .frame(width: 180)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Thought Card
struct ThoughtCard: View {
    let thought: Thought
    let isSelected: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: iconForType(thought.type ?? "note"))
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 4) {
                Text(thought.text ?? "")
                    .font(.body)
                    .lineLimit(3)

                HStack {
                    if let tags = thought.tags as? [String] {
                        ForEach(tags.prefix(3), id: \.self) { tag in
                            Text("#\(tag)")
                                .font(.caption2)
                                .foregroundStyle(.blue)
                        }
                    }

                    Spacer()

                    if let date = thought.createdAt {
                        Text(date, style: .relative)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
        .padding()
        .background(isSelected ? Color.accentColor.opacity(0.1) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 8))
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

// MARK: - Section Header
struct SectionHeader: View {
    let title: String
    let count: Int
    let isExpanded: Bool

    var body: some View {
        HStack {
            Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                .font(.caption)
                .foregroundStyle(.secondary)

            Text(title)
                .font(.headline)

            Text("\(count)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.secondary.opacity(0.2))
                .clipShape(Capsule())

            Spacer()
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

// MARK: - Filter Bar
struct FilterBar: View {
    @Binding var groupingMode: IntelligentFeedView.GroupingMode

    var body: some View {
        HStack {
            Picker("Group by", selection: $groupingMode) {
                ForEach(IntelligentFeedView.GroupingMode.allCases, id: \.self) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            Spacer()

            Button {
                // Refresh
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.plain)
        }
        .padding()
    }
}

// MARK: - Related Thoughts Carousel
struct RelatedThoughtsCarousel: View {
    let thought: Thought
    @State private var relatedThoughts: [ThoughtResponse] = []
    @State private var isLoading = false

    private let apiClient = ThoughtsAPIClient()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Related Thoughts", systemImage: "link")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if isLoading {
                    ProgressView()
                        .scaleEffect(0.6)
                }
            }

            if relatedThoughts.isEmpty && !isLoading {
                Text("No related thoughts found")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(relatedThoughts) { related in
                            RelatedThoughtCard(thought: related)
                        }
                    }
                }
            }
        }
        .task {
            await loadRelatedThoughts()
        }
    }

    private func loadRelatedThoughts() async {
        guard let thoughtId = thought.id?.uuidString else { return }
        isLoading = true

        do {
            let response = try await apiClient.fetchRelatedThoughts(thoughtId: thoughtId)
            relatedThoughts = response.related
        } catch {
            print("Failed to load related thoughts: \(error)")
        }

        isLoading = false
    }
}

// MARK: - Related Thoughts Carousel (API Response version)
struct RelatedThoughtsCarouselAPI: View {
    let thoughtId: String
    @State private var relatedThoughts: [ThoughtResponse] = []
    @State private var isLoading = false

    private let apiClient = ThoughtsAPIClient()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Related Thoughts", systemImage: "link")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if isLoading {
                    ProgressView()
                        .scaleEffect(0.6)
                }
            }

            if relatedThoughts.isEmpty && !isLoading {
                Text("No related thoughts found")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(relatedThoughts) { related in
                            RelatedThoughtCard(thought: related)
                        }
                    }
                }
            }
        }
        .task {
            await loadRelatedThoughts()
        }
    }

    private func loadRelatedThoughts() async {
        isLoading = true

        do {
            let response = try await apiClient.fetchRelatedThoughts(thoughtId: thoughtId)
            relatedThoughts = response.related
        } catch {
            print("Failed to load related thoughts: \(error)")
        }

        isLoading = false
    }
}

struct RelatedThoughtCard: View {
    let thought: ThoughtResponse

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(thought.text)
                .font(.caption)
                .lineLimit(2)

            HStack {
                if let category = thought.derived?.category {
                    Text(category)
                        .font(.caption2)
                        .foregroundStyle(.purple)
                }

                Spacer()

                if let date = thought.createdAtDate {
                    Text(date, style: .relative)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(8)
        .frame(width: 160)
        .background(Color.secondary.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

// MARK: - Tag Chip
struct TagChip: View {
    let tag: String

    var body: some View {
        Text("#\(tag)")
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.blue.opacity(0.2))
            .foregroundStyle(.blue)
            .clipShape(Capsule())
    }
}
