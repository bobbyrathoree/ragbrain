import SwiftUI
import KeyboardShortcuts
import CoreData

@main
struct UltrathinkApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var captureManager = CaptureManager()
    @StateObject private var askManager = AskManager()
    @StateObject private var dataController = DataController()
    @StateObject private var apiConfiguration = APIConfiguration.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(captureManager)
                .environmentObject(askManager)
                .environmentObject(apiConfiguration)
                .environment(\.managedObjectContext, dataController.container.viewContext)
        }
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Capture Thought") {
                    openCaptureWindow()
                }
                .keyboardShortcut("s", modifiers: [.option])

                Button("Ask Question") {
                    openAskWindow()
                }
                .keyboardShortcut("f", modifiers: [.option])
            }
        }

        Window("Capture", id: "capture") {
            CaptureSheet()
                .environmentObject(captureManager)
                .environmentObject(apiConfiguration)
                .environment(\.managedObjectContext, dataController.container.viewContext)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        .defaultPosition(.center)

        Window("Ask", id: "ask") {
            AskSheet()
                .environmentObject(askManager)
                .environmentObject(apiConfiguration)
                .environment(\.managedObjectContext, dataController.container.viewContext)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        .defaultPosition(.center)

        SwiftUI.Settings {
            SettingsView()
                .environmentObject(apiConfiguration)
        }

        MenuBarExtra("Ultrathink", systemImage: "brain") {
            MenuBarView()
                .environmentObject(captureManager)
                .environmentObject(askManager)
                .environmentObject(apiConfiguration)
        }
    }

    private func openCaptureWindow() {
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.windows.first(where: { $0.identifier?.rawValue == "capture" }) {
            window.makeKeyAndOrderFront(nil)
        } else {
            // Window will be created by SwiftUI
            NotificationCenter.default.post(name: .openCaptureWindow, object: nil)
        }
    }

    private func openAskWindow() {
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.windows.first(where: { $0.identifier?.rawValue == "ask" }) {
            window.makeKeyAndOrderFront(nil)
        } else {
            NotificationCenter.default.post(name: .openAskWindow, object: nil)
        }
    }
}

// MARK: - App Delegate for Global Hotkeys
class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        setupGlobalHotkeys()
    }

    private func setupGlobalHotkeys() {
        KeyboardShortcuts.onKeyUp(for: .captureThought) {
            NSApp.activate(ignoringOtherApps: true)
            NotificationCenter.default.post(name: .openCaptureWindow, object: nil)
        }

        KeyboardShortcuts.onKeyUp(for: .askQuestion) {
            NSApp.activate(ignoringOtherApps: true)
            NotificationCenter.default.post(name: .openAskWindow, object: nil)
        }
    }
}

// MARK: - Notification Names
extension Notification.Name {
    static let openCaptureWindow = Notification.Name("openCaptureWindow")
    static let openAskWindow = Notification.Name("openAskWindow")
}

// MARK: - Keyboard Shortcuts
extension KeyboardShortcuts.Name {
    static let captureThought = Self("captureThought", default: .init(.s, modifiers: [.option]))
    static let askQuestion = Self("askQuestion", default: .init(.f, modifiers: [.option]))
}