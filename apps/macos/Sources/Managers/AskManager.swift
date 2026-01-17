import Foundation
import SwiftUI

@MainActor
class AskManager: ObservableObject {
    @Published var currentQuery = ""
    @Published var answer: AskAnswer?
    @Published var isLoading = false
    @Published var error: AskError?
    @Published var recentQueries: [String] = []

    private let apiClient = AskAPIClient()
    private let maxRecentQueries = 10

    init() {
        loadRecentQueries()
    }

    func ask(_ query: String, tags: [String]? = nil, timeWindow: String? = nil) async {
        guard !query.isEmpty else { return }

        await MainActor.run {
            isLoading = true
            error = nil
            answer = nil
            currentQuery = query
        }

        do {
            let response = try await apiClient.ask(
                query: query,
                tags: tags,
                timeWindow: timeWindow
            )

            await MainActor.run {
                self.answer = response
                self.isLoading = false
                self.addToRecentQueries(query)
            }
        } catch let askError as AskError {
            await MainActor.run {
                self.error = askError
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                self.error = .networkError
                self.isLoading = false
            }
        }
    }

    func clearAnswer() {
        answer = nil
        error = nil
        currentQuery = ""
    }

    private func addToRecentQueries(_ query: String) {
        recentQueries.removeAll { $0 == query }
        recentQueries.insert(query, at: 0)
        if recentQueries.count > maxRecentQueries {
            recentQueries = Array(recentQueries.prefix(maxRecentQueries))
        }
        saveRecentQueries()
    }

    private func loadRecentQueries() {
        if let queries = UserDefaults.standard.stringArray(forKey: "recentQueries") {
            recentQueries = queries
        }
    }

    private func saveRecentQueries() {
        UserDefaults.standard.set(recentQueries, forKey: "recentQueries")
    }
}

// MARK: - Models
struct AskAnswer: Identifiable {
    let id = UUID()
    let text: String
    let citations: [Citation]
    let confidence: Double
    let processingTime: Int
    let query: String
    let timestamp: Date

    init(text: String, citations: [Citation], confidence: Double, processingTime: Int, query: String) {
        self.text = text
        self.citations = citations
        self.confidence = confidence
        self.processingTime = processingTime
        self.query = query
        self.timestamp = Date()
    }
}

struct Citation: Identifiable, Codable {
    let id: String
    let createdAt: String
    let preview: String
    let score: Double
    let type: String
    let tags: [String]

    var createdAtDate: Date? {
        let formatter = ISO8601DateFormatter()
        return formatter.date(from: createdAt)
    }
}

enum AskError: Error, LocalizedError {
    case networkError
    case serverError(String)
    case validationError(String)
    case noResults
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .networkError:
            return "Unable to connect. Check your internet connection."
        case .serverError(let message):
            return "Server error: \(message)"
        case .validationError(let message):
            return message
        case .noResults:
            return "No relevant notes found for your question."
        case .unauthorized:
            return "Authentication required. Please check your API key."
        }
    }
}

// MARK: - API Client
class AskAPIClient {
    private let baseURL = "https://api.ultrathink.dev"
    private var apiKey: String {
        // TODO: Retrieve from Keychain
        "dev-key-123"
    }

    struct AskRequest: Codable {
        let query: String
        let tags: [String]?
        let timeWindow: String?
        let limit: Int?
    }

    struct AskResponse: Codable {
        let answer: String
        let citations: [Citation]
        let confidence: Double
        let processingTime: Int
    }

    func ask(query: String, tags: [String]?, timeWindow: String?) async throws -> AskAnswer {
        let endpoint = URL(string: "\(baseURL)/ask")!

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.timeoutInterval = 30

        let payload = AskRequest(
            query: query,
            tags: tags,
            timeWindow: timeWindow,
            limit: 5
        )

        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AskError.networkError
        }

        switch httpResponse.statusCode {
        case 200:
            let apiResponse = try JSONDecoder().decode(AskResponse.self, from: data)
            return AskAnswer(
                text: apiResponse.answer,
                citations: apiResponse.citations,
                confidence: apiResponse.confidence,
                processingTime: apiResponse.processingTime,
                query: query
            )
        case 400:
            throw AskError.validationError("Invalid query")
        case 401:
            throw AskError.unauthorized
        case 404:
            throw AskError.noResults
        default:
            throw AskError.serverError("Status code: \(httpResponse.statusCode)")
        }
    }
}
