import CoreData
import Foundation

class DataController: ObservableObject {
    let container: NSPersistentContainer
    
    init() {
        container = NSPersistentContainer(name: "Ultrathink")
        
        container.persistentStoreDescriptions.forEach { storeDescription in
            storeDescription.setOption(true as NSNumber, forKey: NSPersistentHistoryTrackingKey)
            storeDescription.setOption(true as NSNumber, forKey: NSPersistentStoreRemoteChangeNotificationPostOptionKey)
        }
        
        container.loadPersistentStores { _, error in
            if let error = error {
                fatalError("Failed to load persistent stores: \(error)")
            }
        }
        
        container.viewContext.automaticallyMergesChangesFromParent = true
    }
    
    func save() {
        guard container.viewContext.hasChanges else { return }
        
        do {
            try container.viewContext.save()
        } catch {
            print("Failed to save context: \(error)")
        }
    }
    
    func createThought(text: String, type: ThoughtType, tags: [String], context: CaptureContext?) -> Thought {
        let thought = Thought(context: container.viewContext)
        thought.id = UUID()
        thought.createdAt = Date()
        thought.text = text
        thought.type = type.rawValue
        thought.tags = tags
        thought.contextData = context?.toData()
        thought.syncStatus = SyncStatus.pending.rawValue
        
        save()
        return thought
    }
    
    func fetchUnsyncedThoughts() -> [Thought] {
        let request = Thought.fetchRequest()
        request.predicate = NSPredicate(format: "syncStatus == %@", SyncStatus.pending.rawValue)
        request.sortDescriptors = [NSSortDescriptor(keyPath: \Thought.createdAt, ascending: true)]
        
        do {
            return try container.viewContext.fetch(request)
        } catch {
            print("Failed to fetch unsynced thoughts: \(error)")
            return []
        }
    }
}

enum ThoughtType: String, CaseIterable {
    case note = "note"
    case code = "code"
    case link = "link"
    case todo = "todo"
    case decision = "decision"
    case rationale = "rationale"
}

enum SyncStatus: String {
    case pending = "pending"
    case syncing = "syncing"
    case synced = "synced"
    case failed = "failed"
}

struct CaptureContext: Codable {
    var app: String?
    var windowTitle: String?
    var repo: String?
    var branch: String?
    var file: String?

    func toData() -> Data? {
        try? JSONEncoder().encode(self)
    }

    static func fromData(_ data: Data) -> CaptureContext? {
        try? JSONDecoder().decode(CaptureContext.self, from: data)
    }
}