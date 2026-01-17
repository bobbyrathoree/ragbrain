import Foundation
import SwiftUI

/// Manages fetching and caching thoughts from the API
@MainActor
class ThoughtsManager: ObservableObject {
    @Published var thoughts: [ThoughtResponse] = []
    @Published var isLoading = false
    @Published var error: Error?
    @Published var hasMore = false
    @Published var totalCount: Int?

    private var cursor: String?
    private let apiClient = ThoughtsAPIClient()

    struct ThoughtsFilter {
        var from: Date?
        var to: Date?
        var tag: String?
        var type: String?
        var limit: Int = 50
        var includeTotalCount: Bool = false
    }

    func loadThoughts(filter: ThoughtsFilter = ThoughtsFilter()) async {
        isLoading = true
        error = nil
        cursor = nil

        do {
            let response = try await apiClient.fetchThoughts(filter: filter, cursor: nil)
            thoughts = response.thoughts
            cursor = response.cursor
            hasMore = response.hasMore
            totalCount = response.totalCount
            isLoading = false
        } catch {
            self.error = error
            isLoading = false
        }
    }

    func loadMore() async {
        guard hasMore, let cursor = cursor, !isLoading else { return }

        isLoading = true

        do {
            let response = try await apiClient.fetchThoughts(filter: ThoughtsFilter(), cursor: cursor)
            thoughts.append(contentsOf: response.thoughts)
            self.cursor = response.cursor
            hasMore = response.hasMore
            isLoading = false
        } catch {
            self.error = error
            isLoading = false
        }
    }

    func refresh() async {
        await loadThoughts()
    }
}

// MARK: - Response Types
struct ThoughtResponse: Identifiable, Codable {
    let id: String
    let createdAt: String
    let text: String
    let type: String
    let tags: [String]
    let context: ThoughtContext?
    let derived: DerivedFields?

    var createdAtDate: Date? {
        let formatter = ISO8601DateFormatter()
        return formatter.date(from: createdAt)
    }
}

struct ThoughtContext: Codable {
    let app: String?
    let windowTitle: String?
    let repo: String?
    let branch: String?
    let file: String?
}

struct DerivedFields: Codable {
    let summary: String?
    let decisionScore: Double?
    let autoTags: [String]?
    let importance: Double?
}

struct ThoughtsListResponse: Codable {
    let thoughts: [ThoughtResponse]
    let cursor: String?
    let hasMore: Bool
    let totalCount: Int?
}

// MARK: - API Client
class ThoughtsAPIClient {
    private var baseURL: String { APIConfiguration.shared.baseURL }
    private var apiKey: String { APIConfiguration.shared.apiKey ?? "" }

    func fetchThoughts(filter: ThoughtsManager.ThoughtsFilter, cursor: String?) async throws -> ThoughtsListResponse {
        guard !apiKey.isEmpty else {
            throw ThoughtsError.unauthorized
        }

        var components = URLComponents(string: "\(baseURL)/thoughts")!
        var queryItems: [URLQueryItem] = []

        queryItems.append(URLQueryItem(name: "limit", value: String(filter.limit)))

        if let from = filter.from {
            queryItems.append(URLQueryItem(name: "from", value: ISO8601DateFormatter().string(from: from)))
        }
        if let to = filter.to {
            queryItems.append(URLQueryItem(name: "to", value: ISO8601DateFormatter().string(from: to)))
        }
        if let tag = filter.tag {
            queryItems.append(URLQueryItem(name: "tag", value: tag))
        }
        if let type = filter.type {
            queryItems.append(URLQueryItem(name: "type", value: type))
        }
        if let cursor = cursor {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        if filter.includeTotalCount {
            queryItems.append(URLQueryItem(name: "includeCount", value: "true"))
        }

        components.queryItems = queryItems

        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.timeoutInterval = 30

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ThoughtsError.networkError
        }

        switch httpResponse.statusCode {
        case 200:
            return try JSONDecoder().decode(ThoughtsListResponse.self, from: data)
        case 401:
            throw ThoughtsError.unauthorized
        default:
            throw ThoughtsError.serverError(httpResponse.statusCode)
        }
    }
}

enum ThoughtsError: Error, LocalizedError {
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
