import Foundation
import SwiftUI

/// Manages syncing Ragbrain data to an Obsidian vault
@MainActor
class ObsidianSyncManager: ObservableObject {
    // MARK: - Published State
    @Published var vaultPath: URL?
    @Published var lastSync: Date?
    @Published var syncStatus: SyncStatus = .idle
    @Published var error: Error?
    @Published var syncProgress: SyncProgress?

    // MARK: - Persisted Settings
    @AppStorage("obsidian.vaultPath") private var storedVaultPath: String = ""
    @AppStorage("obsidian.lastSyncTimestamp") private var lastSyncTimestamp: Double = 0
    @AppStorage("obsidian.syncEnabled") var syncEnabled: Bool = false

    private let apiClient = ExportAPIClient()
    private let fileManager = FileManager.default

    // MARK: - Sync Status
    enum SyncStatus: Equatable {
        case idle
        case detecting
        case syncing
        case success(Int, Int) // thoughts, conversations synced
        case error(String)
    }

    struct SyncProgress {
        var phase: String
        var current: Int
        var total: Int
    }

    // MARK: - Initialization
    init() {
        // Load persisted vault path
        if !storedVaultPath.isEmpty {
            vaultPath = URL(fileURLWithPath: storedVaultPath)
        }
        if lastSyncTimestamp > 0 {
            lastSync = Date(timeIntervalSince1970: lastSyncTimestamp)
        }
    }

    // MARK: - Vault Detection

    /// Auto-detect Obsidian vault in common locations
    func detectVault() async -> URL? {
        syncStatus = .detecting

        let searchPaths = [
            fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Documents"),
            fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Library/Mobile Documents/iCloud~md~obsidian/Documents"),
            fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Obsidian"),
            fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Desktop"),
        ]

        for basePath in searchPaths {
            if let vault = findObsidianVault(in: basePath) {
                vaultPath = vault
                storedVaultPath = vault.path
                syncStatus = .idle
                return vault
            }
        }

        syncStatus = .idle
        return nil
    }

    private func findObsidianVault(in directory: URL) -> URL? {
        guard fileManager.fileExists(atPath: directory.path) else { return nil }

        // Look for .obsidian folder (indicates an Obsidian vault)
        let obsidianMarker = directory.appendingPathComponent(".obsidian")
        if fileManager.fileExists(atPath: obsidianMarker.path) {
            return directory
        }

        // Search subdirectories (1 level deep)
        guard let contents = try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return nil }

        for item in contents {
            var isDirectory: ObjCBool = false
            if fileManager.fileExists(atPath: item.path, isDirectory: &isDirectory),
               isDirectory.boolValue {
                let marker = item.appendingPathComponent(".obsidian")
                if fileManager.fileExists(atPath: marker.path) {
                    return item
                }
            }
        }

        return nil
    }

    /// Set vault path manually
    func setVaultPath(_ url: URL) {
        vaultPath = url
        storedVaultPath = url.path
    }

    // MARK: - Sync Operations

    /// Perform full or incremental sync
    func sync() async {
        guard let vault = vaultPath else {
            syncStatus = .error("No vault selected")
            return
        }

        syncStatus = .syncing
        error = nil
        syncProgress = SyncProgress(phase: "Fetching data...", current: 0, total: 0)

        do {
            // Fetch export data from API
            let since = lastSyncTimestamp > 0 ? Int(lastSyncTimestamp * 1000) : 0
            let exportData = try await apiClient.fetchExport(since: since)

            // Create ragbrain subfolder
            let ragbrainDir = vault.appendingPathComponent("ragbrain")
            try createDirectoryIfNeeded(ragbrainDir)
            try createDirectoryIfNeeded(ragbrainDir.appendingPathComponent("daily"))
            try createDirectoryIfNeeded(ragbrainDir.appendingPathComponent("thoughts"))
            try createDirectoryIfNeeded(ragbrainDir.appendingPathComponent("conversations"))

            let totalItems = exportData.thoughts.count + exportData.conversations.count
            var processedItems = 0

            // Group thoughts by date for daily notes
            var thoughtsByDate: [String: [ThoughtExport]] = [:]
            for thought in exportData.thoughts {
                let dateKey = formatDateKey(thought.createdAt)
                thoughtsByDate[dateKey, default: []].append(thought)
            }

            // Group conversations by date
            var conversationsByDate: [String: [ConversationExport]] = [:]
            for conversation in exportData.conversations {
                let dateKey = formatDateKey(conversation.createdAt)
                conversationsByDate[dateKey, default: []].append(conversation)
            }

            // Write individual thought files
            syncProgress = SyncProgress(phase: "Writing thoughts...", current: 0, total: exportData.thoughts.count)
            for thought in exportData.thoughts {
                let thoughtFile = ragbrainDir
                    .appendingPathComponent("thoughts")
                    .appendingPathComponent("\(thought.smartId).md")
                try writeThoughtFile(thought, to: thoughtFile)
                processedItems += 1
                syncProgress = SyncProgress(phase: "Writing thoughts...", current: processedItems, total: totalItems)
            }

            // Write individual conversation files
            syncProgress = SyncProgress(phase: "Writing conversations...", current: processedItems, total: totalItems)
            for conversation in exportData.conversations {
                let convFile = ragbrainDir
                    .appendingPathComponent("conversations")
                    .appendingPathComponent("\(conversation.smartId).md")
                try writeConversationFile(conversation, to: convFile)
                processedItems += 1
                syncProgress = SyncProgress(phase: "Writing conversations...", current: processedItems, total: totalItems)
            }

            // Write/update daily notes
            syncProgress = SyncProgress(phase: "Updating daily notes...", current: processedItems, total: totalItems)
            let allDates = Set(thoughtsByDate.keys).union(Set(conversationsByDate.keys))
            for dateKey in allDates {
                let dailyFile = ragbrainDir
                    .appendingPathComponent("daily")
                    .appendingPathComponent("\(dateKey).md")
                try writeDailyNote(
                    date: dateKey,
                    thoughts: thoughtsByDate[dateKey] ?? [],
                    conversations: conversationsByDate[dateKey] ?? [],
                    to: dailyFile
                )
            }

            // Handle deletions
            for deletedId in exportData.deleted {
                try deleteFileForId(deletedId, in: ragbrainDir)
            }

            // Update sync timestamp
            let newTimestamp = Double(exportData.syncTimestamp) / 1000.0
            lastSyncTimestamp = newTimestamp
            lastSync = Date(timeIntervalSince1970: newTimestamp)

            syncStatus = .success(exportData.thoughts.count, exportData.conversations.count)
            syncProgress = nil

        } catch {
            self.error = error
            syncStatus = .error(error.localizedDescription)
            syncProgress = nil
        }
    }

    // MARK: - File Writing

    private func createDirectoryIfNeeded(_ url: URL) throws {
        if !fileManager.fileExists(atPath: url.path) {
            try fileManager.createDirectory(at: url, withIntermediateDirectories: true)
        }
    }

    private func formatDateKey(_ isoDate: String) -> String {
        // Extract YYYY-MM-DD from ISO date
        let components = isoDate.prefix(10)
        return String(components)
    }

    private func formatDisplayDate(_ dateKey: String) -> String {
        // Convert "2026-01-17" to "January 17, 2026"
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: dateKey) else { return dateKey }

        formatter.dateFormat = "MMMM d, yyyy"
        return formatter.string(from: date)
    }

    private func formatTime(_ isoDate: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: isoDate) else { return "" }

        let timeFormatter = DateFormatter()
        timeFormatter.dateFormat = "h:mm a"
        return timeFormatter.string(from: date)
    }

    private func writeThoughtFile(_ thought: ThoughtExport, to url: URL) throws {
        var content = """
        ---
        id: \(thought.id)
        created: \(thought.createdAt)
        type: \(thought.type)
        """

        if let category = thought.category {
            content += "\ncategory: \(category)"
        }

        if !thought.tags.isEmpty {
            content += "\ntags: [\(thought.tags.joined(separator: ", "))]"
        }

        if !thought.relatedIds.isEmpty {
            let relatedSmartIds = thought.relatedIds.map { "t-\($0.suffix(8))" }
            content += "\nrelated: [\(relatedSmartIds.joined(separator: ", "))]"
        }

        content += "\n---\n\n"

        // Title from first line of text
        let firstLine = thought.text.components(separatedBy: .newlines).first ?? thought.text
        content += "# \(firstLine.prefix(80))\n\n"

        // Full text (if different from title)
        if thought.text != firstLine {
            content += "\(thought.text)\n\n"
        }

        // Context section
        if let context = thought.context {
            content += "## Context\n"
            if let app = context.app { content += "- **App:** \(app)\n" }
            if let repo = context.repo { content += "- **Repo:** \(repo)\n" }
            if let file = context.file { content += "- **File:** \(file)\n" }
            content += "\n"
        }

        // Related thoughts
        if !thought.relatedIds.isEmpty {
            content += "## Related\n"
            for relatedId in thought.relatedIds {
                // Link using smart ID pattern
                content += "- [[t-\(relatedId.suffix(8))]]\n"
            }
            content += "\n"
        }

        // Daily note backlink
        let dateKey = formatDateKey(thought.createdAt)
        content += "## Daily Notes\n- [[\(dateKey)]]\n"

        try content.write(to: url, atomically: true, encoding: .utf8)
    }

    private func writeConversationFile(_ conversation: ConversationExport, to url: URL) throws {
        var content = """
        ---
        id: \(conversation.id)
        created: \(conversation.createdAt)
        updated: \(conversation.updatedAt)
        title: \(conversation.title)
        messages: \(conversation.messages.count)
        status: \(conversation.status)
        ---

        # \(conversation.title)

        ## Thread

        """

        for message in conversation.messages {
            let role = message.role == "user" ? "You" : "Ragbrain"
            let time = formatTime(message.createdAt)

            content += "### \(role) \u{00B7} \(time)\n"
            content += "\(message.content)\n\n"

            // Add citations for assistant messages
            if message.role == "assistant", let citations = message.citations, !citations.isEmpty {
                content += "**Citations:**\n"
                for (index, citation) in citations.enumerated() {
                    let citationDate = formatDateKey(citation.createdAt)
                    content += "\(index + 1). [[t-\(citation.id.suffix(8))]] \u{2014} \(citationDate)\n"
                }
                content += "\n"
            }

            content += "---\n\n"
        }

        // Daily note backlink
        let dateKey = formatDateKey(conversation.createdAt)
        content += "## Daily Notes\n- [[\(dateKey)]]\n"

        try content.write(to: url, atomically: true, encoding: .utf8)
    }

    private func writeDailyNote(
        date: String,
        thoughts: [ThoughtExport],
        conversations: [ConversationExport],
        to url: URL
    ) throws {
        // Collect all tags
        var allTags: Set<String> = []
        for thought in thoughts {
            allTags.formUnion(thought.tags)
        }

        var content = """
        ---
        date: \(date)
        thought_count: \(thoughts.count)
        conversation_count: \(conversations.count)
        tags: [\(allTags.sorted().joined(separator: ", "))]
        ---

        # \(formatDisplayDate(date))

        """

        // Thoughts section
        if !thoughts.isEmpty {
            content += "## Thoughts\n\n"

            let sortedThoughts = thoughts.sorted { $0.createdAt < $1.createdAt }
            for thought in sortedThoughts {
                let time = formatTime(thought.createdAt)
                let typeLabel = thought.type.capitalized
                let preview = thought.text.prefix(100).replacingOccurrences(of: "\n", with: " ")

                content += "### \(time) \u{00B7} \(typeLabel)\n"
                content += "\(preview)\n\n"
                content += "\u{2192} [[\(thought.smartId)]]\n\n"

                if !thought.tags.isEmpty {
                    content += thought.tags.map { "#\($0)" }.joined(separator: " ") + "\n\n"
                }

                content += "---\n\n"
            }
        }

        // Conversations section
        if !conversations.isEmpty {
            content += "## Conversations\n\n"

            let sortedConversations = conversations.sorted { $0.createdAt < $1.createdAt }
            for conversation in sortedConversations {
                let time = formatTime(conversation.createdAt)

                content += "### \(time) \u{00B7} [[\(conversation.smartId)|\(conversation.title)]]\n\n"

                // Show first exchange as preview
                if let firstUser = conversation.messages.first(where: { $0.role == "user" }),
                   let firstAssistant = conversation.messages.first(where: { $0.role == "assistant" }) {
                    content += "> **You:** \(firstUser.content.prefix(80))...\n"
                    content += "> **Ragbrain:** \(firstAssistant.content.prefix(80))...\n\n"
                }

                content += "_\(conversation.messages.count) messages_\n\n"
                content += "---\n\n"
            }
        }

        // Related days (simple adjacent dates)
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        if let currentDate = dateFormatter.date(from: date) {
            let calendar = Calendar.current
            content += "## Related Days\n"
            if let yesterday = calendar.date(byAdding: .day, value: -1, to: currentDate) {
                content += "- [[\(dateFormatter.string(from: yesterday))]]\n"
            }
            if let tomorrow = calendar.date(byAdding: .day, value: 1, to: currentDate) {
                content += "- [[\(dateFormatter.string(from: tomorrow))]]\n"
            }
        }

        try content.write(to: url, atomically: true, encoding: .utf8)
    }

    private func deleteFileForId(_ id: String, in ragbrainDir: URL) throws {
        // Determine file type and location
        let isConversation = id.hasPrefix("conv_")
        let subfolder = isConversation ? "conversations" : "thoughts"

        // Try to find and delete the file
        let folder = ragbrainDir.appendingPathComponent(subfolder)
        if let contents = try? fileManager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) {
            for file in contents {
                if file.lastPathComponent.contains(id.suffix(4)) {
                    try? fileManager.removeItem(at: file)
                }
            }
        }
    }
}

// MARK: - API Types

struct ThoughtExport: Codable {
    let id: String
    let smartId: String
    let text: String
    let type: String
    let tags: [String]
    let category: String?
    let intent: String?
    let context: ThoughtContextExport?
    let relatedIds: [String]
    let createdAt: String
    let updatedAt: String?
}

struct ThoughtContextExport: Codable {
    let app: String?
    let repo: String?
    let file: String?
}

struct MessageExport: Codable {
    let role: String
    let content: String
    let citations: [CitationExport]?
    let createdAt: String
}

struct CitationExport: Codable {
    let id: String
    let preview: String
    let createdAt: String
}

struct ConversationExport: Codable {
    let id: String
    let smartId: String
    let title: String
    let messages: [MessageExport]
    let status: String
    let createdAt: String
    let updatedAt: String
}

struct ExportResponse: Codable {
    let thoughts: [ThoughtExport]
    let conversations: [ConversationExport]
    let deleted: [String]
    let syncTimestamp: Int
}

// MARK: - API Client

class ExportAPIClient {
    private var baseURL: String { APIConfiguration.shared.baseURL }
    private var apiKey: String { APIConfiguration.shared.apiKey ?? "" }

    func fetchExport(since: Int) async throws -> ExportResponse {
        guard !apiKey.isEmpty else {
            throw ExportError.unauthorized
        }

        var components = URLComponents(string: "\(baseURL)/export")!
        components.queryItems = [
            URLQueryItem(name: "since", value: String(since))
        ]

        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.timeoutInterval = 60 // Export can take longer

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ExportError.networkError
        }

        switch httpResponse.statusCode {
        case 200:
            return try JSONDecoder().decode(ExportResponse.self, from: data)
        case 401:
            throw ExportError.unauthorized
        default:
            throw ExportError.serverError(httpResponse.statusCode)
        }
    }
}

enum ExportError: Error, LocalizedError {
    case networkError
    case unauthorized
    case serverError(Int)
    case fileWriteError(String)

    var errorDescription: String? {
        switch self {
        case .networkError:
            return "Network error. Check your connection."
        case .unauthorized:
            return "Not authorized. Check your API key."
        case .serverError(let code):
            return "Server error: \(code)"
        case .fileWriteError(let path):
            return "Failed to write file: \(path)"
        }
    }
}
