import SwiftUI

struct MenuBarView: View {
    @EnvironmentObject var captureManager: CaptureManager
    @EnvironmentObject var askManager: AskManager
    @Environment(\.openWindow) var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Status header
            HStack {
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)

                Text(statusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Spacer()

                if captureManager.pendingCount > 0 {
                    Text("\(captureManager.pendingCount) pending")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            // Quick actions
            Button {
                openWindow(id: "capture")
            } label: {
                Label("Capture Thought", systemImage: "plus.circle")
            }
            .keyboardShortcut("s", modifiers: [.option])

            Button {
                openWindow(id: "ask")
            } label: {
                Label("Ask Question", systemImage: "sparkles")
            }
            .keyboardShortcut("f", modifiers: [.option])

            Divider()

            // Recent thoughts preview
            if !recentThoughts.isEmpty {
                Text("Recent")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.horizontal, 12)
                    .padding(.top, 8)

                ForEach(recentThoughts.prefix(3), id: \.self) { thought in
                    RecentThoughtRow(text: thought)
                }
            }

            Divider()

            // Settings and quit
            Button {
                NSApplication.shared.activate(ignoringOtherApps: true)
                // Open main window
            } label: {
                Label("Open Ragbrain", systemImage: "brain")
            }

            SettingsLink {
                Label("Settings...", systemImage: "gear")
            }

            Divider()

            Button {
                NSApplication.shared.terminate(nil)
            } label: {
                Text("Quit Ragbrain")
            }
            .keyboardShortcut("q")
        }
        .buttonStyle(.plain)
        .padding(.vertical, 4)
        .frame(width: 280)
    }

    private var statusColor: Color {
        switch captureManager.syncStatus {
        case .synced: return .green
        case .pending, .syncing: return .orange
        case .failed: return .red
        }
    }

    private var statusText: String {
        switch captureManager.syncStatus {
        case .synced: return "All synced"
        case .pending: return "Sync pending"
        case .syncing: return "Syncing..."
        case .failed: return "Sync failed"
        }
    }

    private var recentThoughts: [String] {
        // This would fetch from Core Data
        ["Last thought preview...", "Another thought...", "Third thought..."]
    }
}

struct RecentThoughtRow: View {
    let text: String

    var body: some View {
        HStack {
            Text(text)
                .font(.caption)
                .lineLimit(1)
                .foregroundStyle(.primary)

            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

#Preview {
    MenuBarView()
        .environmentObject(CaptureManager())
        .environmentObject(AskManager())
}
