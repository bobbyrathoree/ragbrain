import SwiftUI
import KeyboardShortcuts
import CoreData

@main
struct UltrathinkApp: App {
    @StateObject private var captureManager = CaptureManager()
    @StateObject private var askManager = AskManager()
    @StateObject private var dataController = DataController()
    @State private var showCapture = false
    @State private var showAsk = false
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(captureManager)
                .environmentObject(askManager)
                .environment(\.managedObjectContext, dataController.container.viewContext)
        }
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Capture Thought") {
                    showCapture = true
                }
                .keyboardShortcut("s", modifiers: [.option])
                
                Button("Ask Question") {
                    showAsk = true
                }
                .keyboardShortcut("f", modifiers: [.option])
            }
        }
        
        Window("Capture", id: "capture") {
            CaptureSheet()
                .environmentObject(captureManager)
                .environment(\.managedObjectContext, dataController.container.viewContext)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        
        Window("Ask", id: "ask") {
            AskSheet()
                .environmentObject(askManager)
                .environment(\.managedObjectContext, dataController.container.viewContext)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        
        MenuBarExtra("Ultrathink", systemImage: "brain") {
            MenuBarView()
                .environmentObject(captureManager)
                .environmentObject(askManager)
        }
    }
    
    init() {
        setupHotkeys()
    }
    
    private func setupHotkeys() {
        KeyboardShortcuts.onKeyUp(for: .captureThought) {
            NSApp.activate(ignoringOtherApps: true)
            showCapture = true
        }
        
        KeyboardShortcuts.onKeyUp(for: .askQuestion) {
            NSApp.activate(ignoringOtherApps: true)
            showAsk = true
        }
    }
}

extension KeyboardShortcuts.Name {
    static let captureThought = Self("captureThought", default: .init(.s, modifiers: [.option]))
    static let askQuestion = Self("askQuestion", default: .init(.f, modifiers: [.option]))
}