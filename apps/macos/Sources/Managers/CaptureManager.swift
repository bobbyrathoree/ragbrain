import Foundation
import SwiftUI
import CoreData
import AppKit

@MainActor
class CaptureManager: ObservableObject {
    @Published var currentContext: CaptureContext?
    @Published var recentTags: [String] = []
    @Published var syncStatus: SyncStatus = .synced
    @Published var pendingCount: Int = 0
    
    private let dataController = DataController()
    private let syncAgent = SyncAgent()
    
    init() {
        loadRecentTags()
        startSyncMonitoring()
    }
    
    func captureContext() {
        Task {
            let context = await detectContext()
            await MainActor.run {
                self.currentContext = context
            }
        }
    }
    
    private func detectContext() async -> CaptureContext {
        var context = CaptureContext(
            app: nil,
            windowTitle: nil,
            repo: nil,
            branch: nil,
            file: nil
        )
        
        // Get frontmost application
        if let frontApp = NSWorkspace.shared.frontmostApplication {
            context.app = frontApp.localizedName
            
            // Get window title using Accessibility API (requires permission)
            if let windowTitle = getWindowTitle(for: frontApp) {
                context.windowTitle = windowTitle
            }
            
            // Detect development context
            switch frontApp.bundleIdentifier {
            case "com.microsoft.VSCode":
                context = await getVSCodeContext(context)
            case "com.apple.dt.Xcode":
                context = await getXcodeContext(context)
            case "com.jetbrains.intellij":
                context = await getIntelliJContext(context)
            default:
                break
            }
        }
        
        return context
    }
    
    private func getWindowTitle(for app: NSRunningApplication) -> String? {
        // This requires Accessibility permissions
        // Implementation would use AXUIElement APIs
        return nil
    }
    
    private func getVSCodeContext(_ context: CaptureContext) async -> CaptureContext {
        var updatedContext = context
        
        // Try to get workspace info from VS Code
        let script = """
        tell application "Visual Studio Code"
            if (count of windows) > 0 then
                return name of window 1
            end if
        end tell
        """
        
        if let result = runAppleScript(script) {
            // Parse workspace from window title
            updatedContext.windowTitle = result
        }
        
        // Get git info from current directory
        if let gitInfo = await getGitInfo() {
            updatedContext.repo = gitInfo.repo
            updatedContext.branch = gitInfo.branch
        }
        
        return updatedContext
    }
    
    private func getXcodeContext(_ context: CaptureContext) async -> CaptureContext {
        var updatedContext = context
        
        let script = """
        tell application "Xcode"
            if (count of workspace documents) > 0 then
                return name of workspace document 1
            end if
        end tell
        """
        
        if let result = runAppleScript(script) {
            updatedContext.windowTitle = result
        }
        
        return updatedContext
    }
    
    private func getIntelliJContext(_ context: CaptureContext) async -> CaptureContext {
        // Similar implementation for IntelliJ
        return context
    }
    
    private func getGitInfo() async -> (repo: String, branch: String)? {
        let task = Process()
        task.launchPath = "/usr/bin/git"
        task.arguments = ["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"]
        
        let pipe = Pipe()
        task.standardOutput = pipe
        
        do {
            try task.run()
            task.waitUntilExit()
            
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            if let output = String(data: data, encoding: .utf8) {
                let lines = output.split(separator: "\n")
                if lines.count >= 2 {
                    let repo = String(lines[0]).components(separatedBy: "/").last ?? ""
                    let branch = String(lines[1])
                    return (repo, branch)
                }
            }
        } catch {
            print("Failed to get git info: \(error)")
        }
        
        return nil
    }
    
    private func runAppleScript(_ script: String) -> String? {
        var error: NSDictionary?
        if let scriptObject = NSAppleScript(source: script) {
            let output = scriptObject.executeAndReturnError(&error)
            if error != nil {
                return nil
            }
            return output.stringValue
        }
        return nil
    }
    
    func createThought(text: String, type: ThoughtType, tags: [String]) -> Thought {
        return dataController.createThought(
            text: text,
            type: type,
            tags: tags,
            context: currentContext
        )
    }
    
    func queueForSync(_ thought: Thought) {
        syncAgent.enqueue(thought)
        updatePendingCount()
    }
    
    private func startSyncMonitoring() {
        Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
            Task {
                await self.syncAgent.syncPending()
                await MainActor.run {
                    self.updatePendingCount()
                    self.updateSyncStatus()
                }
            }
        }
    }
    
    private func updatePendingCount() {
        pendingCount = dataController.fetchUnsyncedThoughts().count
    }
    
    private func updateSyncStatus() {
        if pendingCount > 0 {
            syncStatus = .pending
        } else {
            syncStatus = .synced
        }
    }
    
    private func loadRecentTags() {
        // Load from UserDefaults or Core Data
        recentTags = ["work", "personal", "idea", "todo", "decision", "learning", "bug", "feature"]
    }
}

// MARK: - Sync Agent
class SyncAgent {
    private let apiClient = APIClient()
    private var syncQueue: [Thought] = []
    private var isSyncing = false
    
    func enqueue(_ thought: Thought) {
        syncQueue.append(thought)
        
        Task {
            await syncPending()
        }
    }
    
    func syncPending() async {
        guard !isSyncing else { return }
        guard !syncQueue.isEmpty else { return }
        
        isSyncing = true
        defer { isSyncing = false }
        
        for thought in syncQueue {
            do {
                try await apiClient.uploadThought(thought)
                
                // Mark as synced
                await MainActor.run {
                    thought.syncStatus = SyncStatus.synced.rawValue
                    thought.syncedAt = Date()
                }
                
                // Remove from queue
                syncQueue.removeAll { $0.id == thought.id }
            } catch {
                print("Failed to sync thought: \(error)")
                
                // Exponential backoff
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }
}

// MARK: - API Client
class APIClient {
    private let baseURL = "https://api.ultrathink.dev"
    private let apiKey = "dev-key-123" // Will be stored in Keychain
    
    func uploadThought(_ thought: Thought) async throws {
        let endpoint = URL(string: "\(baseURL)/thoughts")!
        
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        
        let payload = ThoughtPayload(
            id: thought.id?.uuidString ?? UUID().uuidString,
            createdAt: thought.createdAt ?? Date(),
            text: thought.text ?? "",
            type: thought.type ?? "note",
            tags: thought.tags as? [String] ?? [],
            context: thought.contextData.flatMap { CaptureContext.fromData($0) }
        )
        
        request.httpBody = try JSONEncoder().encode(payload)
        
        let (_, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 201 else {
            throw APIError.uploadFailed
        }
    }
}

// MARK: - Models
struct ThoughtPayload: Codable {
    let id: String
    let createdAt: Date
    let text: String
    let type: String
    let tags: [String]
    let context: CaptureContext?
}

enum APIError: Error {
    case uploadFailed
    case networkError
    case authenticationError
}