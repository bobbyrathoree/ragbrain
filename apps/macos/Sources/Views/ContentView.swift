import SwiftUI
import SceneKit
import Charts

struct ContentView: View {
    @State private var selectedView: ViewMode = .hypergraph
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
    @State private var cameraPosition = SCNVector3(0, 0, 15)
    @State private var rotation: Double = 0
    
    var scene: SCNScene {
        let scene = SCNScene()
        scene.background.contents = NSColor.clear
        
        // Create nodes with spring physics
        // This would be populated from actual data
        let nodePositions = generateUMAPLayout(thoughtCount: 100)
        
        for (index, position) in nodePositions.enumerated() {
            let sphere = SCNSphere(radius: 0.2)
            let material = SCNMaterial()
            material.diffuse.contents = NSColor.systemBlue
            material.emission.contents = NSColor.systemBlue.withAlphaComponent(0.3)
            sphere.materials = [material]
            
            let node = SCNNode(geometry: sphere)
            node.position = position
            node.name = "thought_\(index)"
            
            // Add physics for organic movement
            let physicsBody = SCNPhysicsBody(type: .dynamic, shape: nil)
            physicsBody.mass = 0.1
            physicsBody.damping = 0.8
            node.physicsBody = physicsBody
            
            scene.rootNode.addChildNode(node)
        }
        
        // Add connections between related thoughts
        addConnectionLines(to: scene.rootNode)
        
        // Ambient and directional lighting
        let ambientLight = SCNLight()
        ambientLight.type = .ambient
        ambientLight.intensity = 300
        ambientLight.color = NSColor.white
        let ambientNode = SCNNode()
        ambientNode.light = ambientLight
        scene.rootNode.addChildNode(ambientNode)
        
        return scene
    }
    
    var body: some View {
        SceneView(
            scene: scene,
            pointOfView: cameraNode(),
            options: [.allowsCameraControl, .autoenablesDefaultLighting]
        )
        .overlay(alignment: .topLeading) {
            // Minimap overlay
            MinimapView()
                .frame(width: 200, height: 200)
                .padding()
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                .padding()
        }
        .overlay(alignment: .bottomTrailing) {
            // Cluster legend
            ClusterLegend()
                .padding()
        }
        .onAppear {
            withAnimation(.linear(duration: 60).repeatForever(autoreverses: false)) {
                rotation = 360
            }
        }
    }
    
    private func cameraNode() -> SCNNode {
        let camera = SCNCamera()
        camera.fieldOfView = 60
        let cameraNode = SCNNode()
        cameraNode.camera = camera
        cameraNode.position = cameraPosition
        return cameraNode
    }
    
    private func generateUMAPLayout(thoughtCount: Int) -> [SCNVector3] {
        // Simplified UMAP-like layout generation
        var positions: [SCNVector3] = []
        for _ in 0..<thoughtCount {
            let x = Float.random(in: -10...10)
            let y = Float.random(in: -10...10)
            let z = Float.random(in: -5...5)
            positions.append(SCNVector3(x, y, z))
        }
        return positions
    }
    
    private func addConnectionLines(to rootNode: SCNNode) {
        // Add glowing connection lines between related nodes
        // This would be based on actual similarity scores
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
    @State private var stars: [Star] = []
    @State private var constellations: [Constellation] = []
    
    struct Star: Identifiable {
        let id = UUID()
        var position: CGPoint
        var brightness: Double
        var size: Double
        var thought: Thought?
        var pulsePhase: Double
    }
    
    struct Constellation: Identifiable {
        let id = UUID()
        let stars: [Star]
        let topic: String
        let path: Path
    }
    
    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas { context, size in
                // Draw starfield background
                drawStarfield(context: context, size: size, time: timeline.date)
                
                // Draw constellation connections
                for constellation in constellations {
                    drawConstellation(context: context, constellation: constellation)
                }
                
                // Draw thought stars
                for star in stars {
                    drawStar(context: context, star: star, time: timeline.date)
                }
            }
            .gesture(
                DragGesture()
                    .onChanged { value in
                        // Pan around the starfield
                    }
            )
            .onTapGesture { location in
                // Select thought at location
            }
        }
        .background(
            LinearGradient(
                colors: [
                    Color.black,
                    Color(red: 0.05, green: 0.05, blue: 0.15),
                    Color(red: 0.1, green: 0.05, blue: 0.2)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .overlay(alignment: .topTrailing) {
            // Constellation filter controls
            ConstellationControls()
                .padding()
        }
    }
    
    private func drawStarfield(context: GraphicsContext, size: CGSize, time: Date) {
        // Draw twinkling background stars
    }
    
    private func drawConstellation(context: GraphicsContext, constellation: Constellation) {
        // Draw glowing connections between related thoughts
    }
    
    private func drawStar(context: GraphicsContext, star: Star, time: Date) {
        // Draw pulsing star representing a thought
    }
}

// MARK: - Intelligent Feed View
struct IntelligentFeedView: View {
    @Binding var selectedThought: Thought?
    let searchQuery: String
    @State private var thoughts: [Thought] = []
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
        let thoughts: [Thought]
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0, pinnedViews: .sectionHeaders) {
                ForEach(groupedThoughts) { group in
                    Section {
                        if expandedSections.contains(group.key) {
                            ForEach(group.thoughts) { thought in
                                ThoughtCard(
                                    thought: thought,
                                    isSelected: selectedThought?.id == thought.id
                                )
                                .onTapGesture {
                                    withAnimation(.spring()) {
                                        selectedThought = thought
                                    }
                                }
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
        .safeAreaInset(edge: .top) {
            // Floating filter bar
            FilterBar(groupingMode: $groupingMode)
                .background(.ultraThinMaterial)
        }
    }

    private var groupedThoughts: [ThoughtGroup] {
        // Group thoughts based on selected mode
        // Use ML clustering for "smart" mode
        []
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