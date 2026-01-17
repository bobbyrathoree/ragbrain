import Foundation
import SwiftUI

/// Manages fetching and caching knowledge graph data from the API
@MainActor
class GraphManager: ObservableObject {
    @Published var graphData: GraphResponse?
    @Published var isLoading = false
    @Published var error: Error?
    @Published var lastFetched: Date?

    private let apiClient = GraphAPIClient()
    private var cachedMonth: String?

    func loadGraph(month: String? = nil) async {
        // Use cache if same month and recently fetched
        if let cached = cachedMonth,
           cached == month,
           let lastFetched = lastFetched,
           Date().timeIntervalSince(lastFetched) < 300 {
            return
        }

        isLoading = true
        error = nil

        do {
            let response = try await apiClient.fetchGraph(month: month)
            graphData = response
            cachedMonth = month
            lastFetched = Date()
            isLoading = false
        } catch {
            self.error = error
            isLoading = false
        }
    }

    func refresh() async {
        cachedMonth = nil
        lastFetched = nil
        await loadGraph()
    }
}

// MARK: - Response Types
struct GraphResponse: Codable {
    let nodes: [GraphNode]
    let edges: [GraphEdge]
    let clusters: [GraphCluster]?
    let metadata: GraphMetadata?
}

struct GraphNode: Identifiable, Codable {
    let id: String
    let x: Float
    let y: Float
    let z: Float?
    let tags: [String]
    let recency: Double
    let importance: Double
    let type: String
    let clusterId: String?

    // Computed property for SceneKit position
    var position3D: (x: Float, y: Float, z: Float) {
        (x: x * 10, y: y * 10, z: (z ?? 0) * 5)
    }
}

struct GraphEdge: Identifiable, Codable {
    var id: String { "\(source)-\(target)" }
    let source: String
    let target: String
    let similarity: Double
}

struct GraphCluster: Identifiable, Codable {
    let id: String
    let label: String
    let color: String
    let nodeIds: [String]

    var swiftUIColor: Color {
        // Parse hex color string
        let hex = color.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard hex.count == 6,
              let intVal = Int(hex, radix: 16) else {
            return .blue
        }

        let red = Double((intVal >> 16) & 0xFF) / 255.0
        let green = Double((intVal >> 8) & 0xFF) / 255.0
        let blue = Double(intVal & 0xFF) / 255.0

        return Color(red: red, green: green, blue: blue)
    }
}

struct GraphMetadata: Codable {
    let totalNodes: Int
    let totalEdges: Int
    let generatedAt: String
    let algorithm: String
}

// MARK: - API Client
class GraphAPIClient {
    private var baseURL: String { APIConfiguration.shared.baseURL }
    private var apiKey: String { APIConfiguration.shared.apiKey ?? "" }

    func fetchGraph(month: String? = nil, minSimilarity: Double = 0.3) async throws -> GraphResponse {
        guard !apiKey.isEmpty else {
            throw GraphError.unauthorized
        }

        var components = URLComponents(string: "\(baseURL)/graph")!
        var queryItems: [URLQueryItem] = []

        if let month = month {
            queryItems.append(URLQueryItem(name: "month", value: month))
        }
        queryItems.append(URLQueryItem(name: "minSimilarity", value: String(minSimilarity)))

        components.queryItems = queryItems.isEmpty ? nil : queryItems

        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.timeoutInterval = 120 // Graph generation can be slow

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw GraphError.networkError
        }

        switch httpResponse.statusCode {
        case 200:
            return try JSONDecoder().decode(GraphResponse.self, from: data)
        case 401:
            throw GraphError.unauthorized
        case 404:
            // No data yet, return empty graph
            return GraphResponse(nodes: [], edges: [], clusters: nil, metadata: nil)
        default:
            throw GraphError.serverError(httpResponse.statusCode)
        }
    }
}

enum GraphError: Error, LocalizedError {
    case networkError
    case unauthorized
    case serverError(Int)

    var errorDescription: String? {
        switch self {
        case .networkError:
            return "Network error. Check your connection."
        case .unauthorized:
            return "Not authorized. Check your API key."
        case .serverError(let code):
            return "Server error: \(code)"
        }
    }
}
