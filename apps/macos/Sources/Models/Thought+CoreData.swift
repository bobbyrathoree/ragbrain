import Foundation
import CoreData

@objc(Thought)
public class Thought: NSManagedObject {
    @NSManaged public var id: UUID?
    @NSManaged public var createdAt: Date?
    @NSManaged public var text: String?
    @NSManaged public var type: String?
    @NSManaged public var tags: [String]?
    @NSManaged public var contextData: Data?
    @NSManaged public var syncStatus: String?
    @NSManaged public var syncedAt: Date?
    @NSManaged public var lastError: String?
    @NSManaged public var retryCount: Int16
}

extension Thought: Identifiable {
    @nonobjc public class func fetchRequest() -> NSFetchRequest<Thought> {
        return NSFetchRequest<Thought>(entityName: "Thought")
    }
}

@objc(Settings)
public class Settings: NSManagedObject {
    @NSManaged public var id: UUID?
    @NSManaged public var apiKey: String?
    @NSManaged public var apiEndpoint: String?
    @NSManaged public var lastSyncAt: Date?
    @NSManaged public var captureHotkey: String?
    @NSManaged public var askHotkey: String?
    @NSManaged public var captureContext: Bool
    @NSManaged public var autoSync: Bool
    @NSManaged public var syncInterval: Int32
}

extension Settings: Identifiable {
    @nonobjc public class func fetchRequest() -> NSFetchRequest<Settings> {
        return NSFetchRequest<Settings>(entityName: "Settings")
    }
}
