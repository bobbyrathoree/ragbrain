import SwiftUI
import SceneKit
import Charts

struct ContentView: View {
    @StateObject private var thoughtsManager = ThoughtsManager()
    @StateObject private var graphManager = GraphManager()
    @State private var selectedView: ViewMode = .feed
    @State private var searchQuery = ""
    @State private var selectedThought: Thought?
    @State private var showingDetail = false
    @State private var timeRange: TimeRange = .week
    @State private var hoveredNode: String?

    enum ViewMode: String, CaseIterable {
        case hypergraph = "Hypergraph"
        case timeline = "Timeline"
        case feed = "Feed"
        case constellation = "Constellation"
        
        var icon: String {
            switch self {
            case .hypergraph: return "network"
            case .timeline: return "chart.line.uptrend.xyaxis"
            case .feed: return "list.bullet.rectangle"
            case .constellation: return "sparkles"
            }
        }
    }
    
    var body: some View {
        NavigationSplitView {
            SidebarView(selectedView: $selectedView, searchQuery: $searchQuery)
        } detail: {
            ZStack {
                // Gradient background that shifts based on content density
                DynamicGradientBackground()
                
                switch selectedView {
                case .hypergraph:
                    HypergraphView(
                        selectedThought: $selectedThought,
                        hoveredNode: $hoveredNode,
                        searchQuery: searchQuery
                    )
                    .transition(.asymmetric(
                        insertion: .scale.combined(with: .opacity),
                        removal: .scale.combined(with: .opacity)
                    ))
                    
                case .timeline:
                    TimelineHeatmapView(
                        selectedThought: $selectedThought,
                        timeRange: $timeRange
                    )
                    .transition(.slide)
                    
                case .feed:
                    IntelligentFeedView(
                        selectedThought: $selectedThought,
                        searchQuery: searchQuery
                    )
                    .transition(.move(edge: .bottom))
                    
                case .constellation:
                    ConstellationView(
                        selectedThought: $selectedThought,
                        searchQuery: searchQuery
                    )
                    .transition(.scale)
                }
                
                // Floating detail panel that appears on selection
                if let thought = selectedThought {
                    ThoughtDetailPanel(thought: thought, isShowing: $showingDetail)
                        .transition(.asymmetric(
                            insertion: .move(edge: .trailing).combined(with: .opacity),
                            removal: .move(edge: .trailing).combined(with: .opacity)
                        ))
                        .zIndex(10)
                }
            }
            .animation(.spring(response: 0.5, dampingFraction: 0.8), value: selectedView)
        }
        .navigationSplitViewStyle(.balanced)
    }
}

// MARK: - Hypergraph View (3D Knowledge Graph)
struct HypergraphView: View {
    @Binding var selectedThought: Thought?
    @Binding var hoveredNode: String?
    let searchQuery: String
    @StateObject private var graphManager = GraphManager()
    @State private var cameraPosition = SCNVector3(0, 0, 25)
    @State private var selectedNodeId: String?
    @State private var clusterColors: [String: NSColor] = [:]

    var body: some View {
        ZStack {
            if graphManager.isLoading && graphManager.graphData == nil {
                VStack(spacing: 16) {
                    ProgressView()
                    Text("Loading knowledge graph...")
                        .foregroundStyle(.secondary)
                }
            } else if let graphData = graphManager.graphData, !graphData.nodes.isEmpty {
                SceneView(
                    scene: buildScene(from: graphData),
                    pointOfView: cameraNode(),
                    options: [.allowsCameraControl, .autoenablesDefaultLighting]
                )
                .overlay(alignment: .topLeading) {
                    MinimapView()
                        .frame(width: 200, height: 200)
                        .padding()
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                        .padding()
                }
                .overlay(alignment: .bottomTrailing) {
                    if let clusters = graphData.clusters {
                        ClusterLegendView(clusters: clusters)
                            .padding()
                    }
                }
                .overlay(alignment: .top) {
                    if let meta = graphData.metadata {
                        HStack(spacing: 16) {
                            Label("\(meta.totalNodes) nodes", systemImage: "circle.fill")
                            Label("\(meta.totalEdges) connections", systemImage: "link")
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(8)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.top, 8)
                    }
                }
            } else {
                VStack(spacing: 16) {
                    Image(systemName: "network")
                        .font(.system(size: 48))
                        .foregroundStyle(.tertiary)
                    Text("No graph data yet")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                    Text("Capture more thoughts to see connections")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    Button("Refresh") {
                        Task { await graphManager.refresh() }
                    }
                    .buttonStyle(.bordered)
                }
            }

            if let error = graphManager.error {
                VStack {
                    Spacer()
                    Label(error.localizedDescription, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                        .padding()
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                        .padding()
                }
            }
        }
        .task {
            await graphManager.loadGraph()
        }
    }

    private func buildScene(from graphData: GraphResponse) -> SCNScene {
        let scene = SCNScene()
        scene.background.contents = NSColor.clear

        // Build cluster color map
        var colorMap: [String: NSColor] = [:]
        if let clusters = graphData.clusters {
            for cluster in clusters {
                colorMap[cluster.id] = nsColor(from: cluster.color)
            }
        }

        // Create node lookup for edge creation
        var nodePositions: [String: SCNVector3] = [:]

        // Create thought nodes
        for node in graphData.nodes {
            let pos = node.position3D
            let position = SCNVector3(pos.x, pos.y, pos.z)
            nodePositions[node.id] = position

            // Node size based on importance
            let radius = CGFloat(0.15 + node.importance * 0.25)
            let sphere = SCNSphere(radius: radius)

            // Color based on cluster
            let color = node.clusterId.flatMap { colorMap[$0] } ?? NSColor.systemBlue
            let material = SCNMaterial()
            material.diffuse.contents = color
            material.emission.contents = color.withAlphaComponent(0.3 * CGFloat(node.recency))
            material.shininess = 0.5
            sphere.materials = [material]

            let scnNode = SCNNode(geometry: sphere)
            scnNode.position = position
            scnNode.name = node.id

            scene.rootNode.addChildNode(scnNode)
        }

        // Create edge connections
        for edge in graphData.edges {
            guard let start = nodePositions[edge.source],
                  let end = nodePositions[edge.target],
                  edge.similarity > 0.3 else { continue }

            let lineNode = createLineNode(from: start, to: end, similarity: edge.similarity)
            scene.rootNode.addChildNode(lineNode)
        }

        // Lighting
        let ambientLight = SCNLight()
        ambientLight.type = .ambient
        ambientLight.intensity = 400
        ambientLight.color = NSColor.white
        let ambientNode = SCNNode()
        ambientNode.light = ambientLight
        scene.rootNode.addChildNode(ambientNode)

        let directionalLight = SCNLight()
        directionalLight.type = .directional
        directionalLight.intensity = 600
        let directionalNode = SCNNode()
        directionalNode.light = directionalLight
        directionalNode.position = SCNVector3(5, 10, 10)
        directionalNode.look(at: SCNVector3(0, 0, 0))
        scene.rootNode.addChildNode(directionalNode)

        return scene
    }

    private func createLineNode(from start: SCNVector3, to end: SCNVector3, similarity: Double) -> SCNNode {
        let vector = SCNVector3(end.x - start.x, end.y - start.y, end.z - start.z)
        let distance = sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z)

        let cylinder = SCNCylinder(radius: CGFloat(0.01 + similarity * 0.02), height: CGFloat(distance))
        let material = SCNMaterial()
        material.diffuse.contents = NSColor.white.withAlphaComponent(CGFloat(similarity * 0.5))
        material.emission.contents = NSColor.systemCyan.withAlphaComponent(CGFloat(similarity * 0.3))
        cylinder.materials = [material]

        let lineNode = SCNNode(geometry: cylinder)

        // Position at midpoint
        lineNode.position = SCNVector3(
            (start.x + end.x) / 2,
            (start.y + end.y) / 2,
            (start.z + end.z) / 2
        )

        // Rotate to align with the vector
        lineNode.look(at: end, up: scene.rootNode.worldUp, localFront: SCNVector3(0, 1, 0))

        return lineNode
    }

    private func cameraNode() -> SCNNode {
        let camera = SCNCamera()
        camera.fieldOfView = 60
        camera.zNear = 0.1
        camera.zFar = 200
        let cameraNode = SCNNode()
        cameraNode.camera = camera
        cameraNode.position = cameraPosition
        return cameraNode
    }

    private func nsColor(from hex: String) -> NSColor {
        let cleanHex = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard cleanHex.count == 6, let intVal = Int(cleanHex, radix: 16) else {
            return NSColor.systemBlue
        }
        let red = CGFloat((intVal >> 16) & 0xFF) / 255.0
        let green = CGFloat((intVal >> 8) & 0xFF) / 255.0
        let blue = CGFloat(intVal & 0xFF) / 255.0
        return NSColor(red: red, green: green, blue: blue, alpha: 1.0)
    }

    private var scene: SCNScene { SCNScene() }
}

// MARK: - Cluster Legend View
struct ClusterLegendView: View {
    let clusters: [GraphCluster]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Clusters")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)

            ForEach(clusters.prefix(6)) { cluster in
                HStack(spacing: 8) {
                    Circle()
                        .fill(cluster.swiftUIColor)
                        .frame(width: 10, height: 10)
                    Text(cluster.label)
                        .font(.caption2)
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                }
            }

            if clusters.count > 6 {
                Text("+\(clusters.count - 6) more")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Timeline Heatmap View
struct TimelineHeatmapView: View {
    @Binding var selectedThought: Thought?
    @Binding var timeRange: TimeRange
    @State private var hoveredDate: Date?
    @State private var densityData: [DensityPoint] = []
    
    struct DensityPoint: Identifiable {
        let id = UUID()
        let date: Date
        let count: Int
        let dominantTopic: String
        let color: Color
    }
    
    var body: some View {
        VStack(spacing: 0) {
            // Time range selector
            Picker("Time Range", selection: $timeRange) {
                ForEach(TimeRange.allCases, id: \.self) { range in
                    Text(range.rawValue).tag(range)
                }
            }
            .pickerStyle(.segmented)
            .padding()
            
            // Interactive heatmap
            ScrollView(.horizontal, showsIndicators: false) {
                Canvas { context, size in
                    drawHeatmap(context: context, size: size)
                }
                .frame(height: 300)
                .onHover { location in
                    // Calculate hovered date from location
                }
            }
            
            // Stacked area chart showing topic evolution
            Chart(densityData) { point in
                AreaMark(
                    x: .value("Date", point.date),
                    y: .value("Count", point.count)
                )
                .foregroundStyle(by: .value("Topic", point.dominantTopic))
                .interpolationMethod(.catmullRom)
            }
            .frame(height: 200)
            .padding()
            
            // Thought stream for selected time period
            if let hoveredDate = hoveredDate {
                ThoughtStreamView(date: hoveredDate)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }
    
    private func drawHeatmap(context: GraphicsContext, size: CGSize) {
        // Draw beautiful heatmap with gradient colors
        // Intensity based on thought density
    }
}

// MARK: - Constellation View (Starfield of Thoughts)
struct ConstellationView: View {
    @Binding var selectedThought: Thought?
    let searchQuery: String
    @StateObject private var graphManager = GraphManager()
    @State private var stars: [Star] = []
    @State private var connections: [(Star, Star)] = []
    @State private var offset: CGSize = .zero
    @State private var scale: CGFloat = 1.0
    @State private var selectedStarId: String?

    struct Star: Identifiable {
        let id: String
        var position: CGPoint
        var brightness: Double
        var size: Double
        var color: Color
        var tags: [String]
        var pulsePhase: Double
    }

    var body: some View {
        GeometryReader { geometry in
            TimelineView(.animation(minimumInterval: 1/30)) { timeline in
                Canvas { context, size in
                    // Draw background starfield
                    drawBackgroundStars(context: context, size: size, time: timeline.date)

                    // Apply pan and zoom transformations
                    context.translateBy(x: size.width / 2 + offset.width, y: size.height / 2 + offset.height)
                    context.scaleBy(x: scale, y: scale)
                    context.translateBy(x: -size.width / 2, y: -size.height / 2)

                    // Draw constellation lines
                    for (star1, star2) in connections {
                        drawConnectionLine(context: context, from: star1, to: star2)
                    }

                    // Draw thought stars
                    for star in stars {
                        drawThoughtStar(context: context, star: star, time: timeline.date, isSelected: star.id == selectedStarId)
                    }
                }
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            offset = CGSize(
                                width: offset.width + value.translation.width,
                                height: offset.height + value.translation.height
                            )
                        }
                )
                .gesture(
                    MagnifyGesture()
                        .onChanged { value in
                            scale = max(0.5, min(3.0, value.magnification))
                        }
                )
                .onTapGesture { location in
                    selectStar(at: location, size: geometry.size)
                }
            }
        }
        .background(
            LinearGradient(
                colors: [
                    Color.black,
                    Color(red: 0.02, green: 0.02, blue: 0.08),
                    Color(red: 0.05, green: 0.02, blue: 0.12)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .overlay(alignment: .topTrailing) {
            ConstellationControlsView(
                starCount: stars.count,
                connectionCount: connections.count,
                onRefresh: { Task { await graphManager.refresh(); buildStarfield() } }
            )
            .padding()
        }
        .overlay(alignment: .bottomLeading) {
            if let selectedId = selectedStarId, let star = stars.first(where: { $0.id == selectedId }) {
                StarInfoCard(star: star)
                    .padding()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .task {
            await graphManager.loadGraph()
            buildStarfield()
        }
    }

    private func buildStarfield() {
        guard let graphData = graphManager.graphData else { return }

        // Convert graph nodes to stars
        stars = graphData.nodes.map { node in
            Star(
                id: node.id,
                position: CGPoint(x: CGFloat(node.x) * 50 + 400, y: CGFloat(node.y) * 50 + 300),
                brightness: node.recency,
                size: 2 + node.importance * 6,
                color: colorForCluster(node.clusterId, clusters: graphData.clusters),
                tags: node.tags,
                pulsePhase: Double.random(in: 0...Double.pi * 2)
            )
        }

        // Build connections from edges with high similarity
        connections = graphData.edges.compactMap { edge in
            guard edge.similarity > 0.5,
                  let star1 = stars.first(where: { $0.id == edge.source }),
                  let star2 = stars.first(where: { $0.id == edge.target }) else {
                return nil
            }
            return (star1, star2)
        }
    }

    private func colorForCluster(_ clusterId: String?, clusters: [GraphCluster]?) -> Color {
        guard let clusterId = clusterId,
              let cluster = clusters?.first(where: { $0.id == clusterId }) else {
            return .white
        }
        return cluster.swiftUIColor
    }

    private func drawBackgroundStars(context: GraphicsContext, size: CGSize, time: Date) {
        // Draw ambient background stars
        let timeValue = time.timeIntervalSinceReferenceDate
        for i in 0..<150 {
            let seed = Double(i) * 17.31
            let x = (sin(seed * 0.7) + 1) / 2 * size.width
            let y = (cos(seed * 0.9) + 1) / 2 * size.height
            let twinkle = (sin(timeValue * 2 + seed) + 1) / 2

            let opacity = 0.1 + twinkle * 0.3
            let starSize = 0.5 + twinkle * 0.5

            context.fill(
                Circle().path(in: CGRect(x: x - starSize/2, y: y - starSize/2, width: starSize, height: starSize)),
                with: .color(.white.opacity(opacity))
            )
        }
    }

    private func drawConnectionLine(context: GraphicsContext, from star1: Star, to star2: Star) {
        var path = Path()
        path.move(to: star1.position)
        path.addLine(to: star2.position)

        context.stroke(
            path,
            with: .linearGradient(
                Gradient(colors: [star1.color.opacity(0.3), star2.color.opacity(0.3)]),
                startPoint: star1.position,
                endPoint: star2.position
            ),
            lineWidth: 0.5
        )
    }

    private func drawThoughtStar(context: GraphicsContext, star: Star, time: Date, isSelected: Bool) {
        let timeValue = time.timeIntervalSinceReferenceDate
        let pulse = (sin(timeValue * 3 + star.pulsePhase) + 1) / 2
        let glowSize = star.size * (1.5 + pulse * 0.5) * (isSelected ? 2 : 1)
        let coreSize = star.size * (isSelected ? 1.5 : 1)

        // Draw glow
        let glowRect = CGRect(
            x: star.position.x - glowSize,
            y: star.position.y - glowSize,
            width: glowSize * 2,
            height: glowSize * 2
        )
        context.fill(
            Circle().path(in: glowRect),
            with: .radialGradient(
                Gradient(colors: [
                    star.color.opacity(0.5 * star.brightness),
                    star.color.opacity(0.1 * star.brightness),
                    .clear
                ]),
                center: star.position,
                startRadius: 0,
                endRadius: glowSize
            )
        )

        // Draw core
        let coreRect = CGRect(
            x: star.position.x - coreSize/2,
            y: star.position.y - coreSize/2,
            width: coreSize,
            height: coreSize
        )
        context.fill(
            Circle().path(in: coreRect),
            with: .color(.white)
        )
    }

    private func selectStar(at location: CGPoint, size: CGSize) {
        let adjustedLocation = CGPoint(
            x: (location.x - size.width / 2 - offset.width) / scale + size.width / 2,
            y: (location.y - size.height / 2 - offset.height) / scale + size.height / 2
        )

        selectedStarId = stars.first { star in
            let distance = hypot(star.position.x - adjustedLocation.x, star.position.y - adjustedLocation.y)
            return distance < star.size * 3
        }?.id
    }
}

// MARK: - Constellation Controls View
struct ConstellationControlsView: View {
    let starCount: Int
    let connectionCount: Int
    let onRefresh: () -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            HStack(spacing: 12) {
                Label("\(starCount)", systemImage: "star.fill")
                Label("\(connectionCount)", systemImage: "line.diagonal")
            }
            .font(.caption)
            .foregroundStyle(.white.opacity(0.7))

            Button(action: onRefresh) {
                Label("Refresh", systemImage: "arrow.clockwise")
                    .font(.caption)
            }
            .buttonStyle(.bordered)
            .tint(.white)
        }
        .padding(12)
        .background(.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Star Info Card
struct StarInfoCard: View {
    let star: ConstellationView.Star

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Circle()
                    .fill(star.color)
                    .frame(width: 12, height: 12)
                Text("Thought")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.white)
            }

            if !star.tags.isEmpty {
                HStack {
                    ForEach(star.tags.prefix(3), id: \.self) { tag in
                        Text("#\(tag)")
                            .font(.caption2)
                            .foregroundStyle(star.color)
                    }
                }
            }

            HStack {
                Label(String(format: "%.0f%%", star.brightness * 100), systemImage: "sparkles")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.6))
            }
        }
        .padding(12)
        .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Intelligent Feed View
struct IntelligentFeedView: View {
    @Binding var selectedThought: Thought?
    let searchQuery: String
    @StateObject private var thoughtsManager = ThoughtsManager()
    @State private var groupingMode: GroupingMode = .smart
    @State private var expandedSections: Set<String> = []

    enum GroupingMode: String, CaseIterable {
        case smart = "Smart Groups"
        case chronological = "Timeline"
        case topics = "Topics"
        case importance = "Priority"
    }

    struct ThoughtGroup: Identifiable {
        let id: String
        let key: String
        let thoughts: [ThoughtResponse]
    }

    var body: some View {
        ScrollView {
            if thoughtsManager.isLoading && thoughtsManager.thoughts.isEmpty {
                VStack(spacing: 16) {
                    ProgressView()
                    Text("Loading thoughts...")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.top, 100)
            } else if thoughtsManager.thoughts.isEmpty {
                VStack(spacing: 16) {
                    Image(systemName: "note.text")
                        .font(.system(size: 48))
                        .foregroundStyle(.tertiary)
                    Text("No thoughts yet")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                    Text("Press ⌥S to capture your first thought")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.top, 100)
            } else {
                LazyVStack(spacing: 0, pinnedViews: .sectionHeaders) {
                    ForEach(groupedThoughts) { group in
                        Section {
                            if expandedSections.contains(group.key) {
                                ForEach(group.thoughts) { thought in
                                    ThoughtResponseCard(
                                        thought: thought,
                                        isSelected: false
                                    )
                                    .transition(.asymmetric(
                                        insertion: .push(from: .trailing),
                                        removal: .push(from: .leading)
                                    ))
                                }
                            }
                        } header: {
                            SectionHeader(
                                title: group.key,
                                count: group.thoughts.count,
                                isExpanded: expandedSections.contains(group.key)
                            )
                            .onTapGesture {
                                withAnimation(.spring()) {
                                    if expandedSections.contains(group.key) {
                                        expandedSections.remove(group.key)
                                    } else {
                                        expandedSections.insert(group.key)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        .safeAreaInset(edge: .top) {
            FilterBar(groupingMode: $groupingMode)
                .background(.ultraThinMaterial)
        }
        .refreshable {
            await thoughtsManager.refresh()
        }
        .task {
            await thoughtsManager.loadThoughts()
            // Expand first section by default
            if let firstGroup = groupedThoughts.first {
                expandedSections.insert(firstGroup.key)
            }
        }
    }

    private var groupedThoughts: [ThoughtGroup] {
        let thoughts = thoughtsManager.thoughts

        guard !thoughts.isEmpty else { return [] }

        switch groupingMode {
        case .smart, .topics:
            // Group by primary tag
            return groupByTag(thoughts)
        case .chronological:
            return groupByDate(thoughts)
        case .importance:
            return groupByImportance(thoughts)
        }
    }

    private func groupByTag(_ thoughts: [ThoughtResponse]) -> [ThoughtGroup] {
        var groups: [String: [ThoughtResponse]] = [:]

        for thought in thoughts {
            let key = thought.tags.first ?? "Untagged"
            groups[key, default: []].append(thought)
        }

        return groups.map { ThoughtGroup(id: $0.key, key: "#\($0.key)", thoughts: $0.value) }
            .sorted { $0.thoughts.count > $1.thoughts.count }
    }

    private func groupByDate(_ thoughts: [ThoughtResponse]) -> [ThoughtGroup] {
        let calendar = Calendar.current
        var groups: [String: [ThoughtResponse]] = [:]

        for thought in thoughts {
            if let date = thought.createdAtDate {
                let key: String
                if calendar.isDateInToday(date) {
                    key = "Today"
                } else if calendar.isDateInYesterday(date) {
                    key = "Yesterday"
                } else if calendar.isDate(date, equalTo: Date(), toGranularity: .weekOfYear) {
                    key = "This Week"
                } else {
                    key = "Earlier"
                }
                groups[key, default: []].append(thought)
            }
        }

        let order = ["Today", "Yesterday", "This Week", "Earlier"]
        return order.compactMap { key in
            guard let thoughts = groups[key], !thoughts.isEmpty else { return nil }
            return ThoughtGroup(id: key, key: key, thoughts: thoughts)
        }
    }

    private func groupByImportance(_ thoughts: [ThoughtResponse]) -> [ThoughtGroup] {
        var high: [ThoughtResponse] = []
        var medium: [ThoughtResponse] = []
        var low: [ThoughtResponse] = []

        for thought in thoughts {
            let score = thought.derived?.decisionScore ?? 0
            if score > 0.6 {
                high.append(thought)
            } else if score > 0.3 {
                medium.append(thought)
            } else {
                low.append(thought)
            }
        }

        var groups: [ThoughtGroup] = []
        if !high.isEmpty { groups.append(ThoughtGroup(id: "high", key: "High Priority", thoughts: high)) }
        if !medium.isEmpty { groups.append(ThoughtGroup(id: "medium", key: "Medium Priority", thoughts: medium)) }
        if !low.isEmpty { groups.append(ThoughtGroup(id: "low", key: "Notes", thoughts: low)) }
        return groups
    }
}

// MARK: - Thought Response Card (for API data)
struct ThoughtResponseCard: View {
    let thought: ThoughtResponse
    let isSelected: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: iconForType(thought.type))
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 4) {
                Text(thought.text)
                    .font(.body)
                    .lineLimit(3)

                HStack {
                    ForEach(thought.tags.prefix(3), id: \.self) { tag in
                        Text("#\(tag)")
                            .font(.caption2)
                            .foregroundStyle(.blue)
                    }

                    Spacer()

                    if let date = thought.createdAtDate {
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

// MARK: - Supporting Views
struct DynamicGradientBackground: View {
    @State private var animateGradient = false

    var body: some View {
        LinearGradient(
            colors: [
                .blue.opacity(0.1),
                .purple.opacity(0.15),
                .pink.opacity(0.1),
                .purple.opacity(0.1)
            ],
            startPoint: animateGradient ? .topLeading : .bottomLeading,
            endPoint: animateGradient ? .bottomTrailing : .topTrailing
        )
        .ignoresSafeArea()
        .onAppear {
            withAnimation(.linear(duration: 10).repeatForever(autoreverses: true)) {
                animateGradient.toggle()
            }
        }
    }
}

struct ThoughtDetailPanel: View {
    let thought: Thought
    @Binding var isShowing: Bool
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Animated header with context
            HStack {
                Image(systemName: iconForType(thought.type ?? "note"))
                    .font(.title2)
                    .foregroundStyle(.tint)
                
                VStack(alignment: .leading) {
                    Text(thought.createdAt ?? Date(), style: .date)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    
                    if let context = extractContext(thought.contextData) {
                        Label(context.app ?? "Unknown", systemImage: "app")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                
                Spacer()
                
                Button {
                    withAnimation {
                        isShowing = false
                    }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
            }
            
            // Main content with syntax highlighting
            Text(thought.text ?? "")
                .font(.body)
                .textSelection(.enabled)
            
            // Tags with interactive chips
            if let tags = thought.tags as? [String], !tags.isEmpty {
                FlowLayout {
                    ForEach(tags, id: \.self) { tag in
                        TagChip(tag: tag)
                    }
                }
            }
            
            // Related thoughts carousel
            RelatedThoughtsCarousel(thought: thought)
        }
        .padding()
        .frame(width: 400)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(radius: 20)
        .padding()
    }
    
    private func iconForType(_ type: String) -> String {
        switch type {
        case "code": return "chevron.left.forwardslash.chevron.right"
        case "decision": return "arrow.triangle.branch"
        case "link": return "link"
        case "todo": return "checklist"
        default: return "note.text"
        }
    }
    
    private func extractContext(_ data: Data?) -> CaptureContext? {
        guard let data = data else { return nil }
        return CaptureContext.fromData(data)
    }
}

// MARK: - Layout Helpers
struct FlowLayout: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        // Calculate flowing layout size
        .zero
    }
    
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        // Place subviews in flowing layout
    }
}

enum TimeRange: String, CaseIterable {
    case day = "Day"
    case week = "Week"
    case month = "Month"
    case year = "Year"
    case all = "All Time"
}