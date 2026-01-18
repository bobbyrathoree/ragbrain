import SwiftUI
import KeyboardShortcuts

struct SettingsView: View {
    var body: some View {
        TabView {
            APISettingsTab()
                .tabItem {
                    Label("API", systemImage: "network")
                }

            HotkeySettingsTab()
                .tabItem {
                    Label("Hotkeys", systemImage: "keyboard")
                }

            ObsidianSettingsTab()
                .tabItem {
                    Label("Obsidian", systemImage: "doc.text")
                }

            GeneralSettingsTab()
                .tabItem {
                    Label("General", systemImage: "gear")
                }
        }
        .frame(width: 500, height: 380)
    }
}

// MARK: - API Settings
struct APISettingsTab: View {
    @EnvironmentObject var config: APIConfiguration
    @State private var apiKey = ""
    @State private var isTestingConnection = false
    @State private var connectionResult: ConnectionResult?

    enum ConnectionResult {
        case success
        case failure(String)
    }

    var body: some View {
        Form {
            Section {
                TextField("API Endpoint", text: $config.baseURL)
                    .textFieldStyle(.roundedBorder)

                HStack {
                    SecureField("API Key", text: $apiKey)
                        .textFieldStyle(.roundedBorder)
                        .onAppear {
                            apiKey = config.apiKey ?? ""
                        }

                    Button(config.hasAPIKey ? "Update" : "Save") {
                        _ = config.setAPIKey(apiKey)
                    }
                    .disabled(apiKey.isEmpty)
                }

                if config.hasAPIKey {
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                        Text("API key stored in Keychain")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        Spacer()

                        Button("Clear", role: .destructive) {
                            config.clearAPIKey()
                            apiKey = ""
                        }
                        .font(.caption)
                    }
                }
            } header: {
                Text("Connection")
            }

            Section {
                HStack {
                    if isTestingConnection {
                        ProgressView()
                            .scaleEffect(0.8)
                        Text("Testing connection...")
                            .foregroundStyle(.secondary)
                    } else if let result = connectionResult {
                        switch result {
                        case .success:
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                            Text("Connected successfully")
                                .foregroundStyle(.green)
                        case .failure(let message):
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.red)
                            Text(message)
                                .foregroundStyle(.red)
                        }
                    } else {
                        Text("Not tested")
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Button("Test Connection") {
                        testConnection()
                    }
                    .disabled(isTestingConnection || !config.hasAPIKey)
                }
            } header: {
                Text("Status")
            }
        }
        .formStyle(.grouped)
        .padding()
    }

    private func testConnection() {
        isTestingConnection = true
        connectionResult = nil

        Task {
            let success = await config.testConnection()
            await MainActor.run {
                isTestingConnection = false
                connectionResult = success ? .success : .failure("Connection failed. Check endpoint and API key.")
            }
        }
    }
}

// MARK: - Hotkey Settings
struct HotkeySettingsTab: View {
    var body: some View {
        Form {
            Section {
                KeyboardShortcuts.Recorder("Capture Thought", name: .captureThought)
                KeyboardShortcuts.Recorder("Ask Question", name: .askQuestion)
            } header: {
                Text("Global Shortcuts")
            } footer: {
                Text("These shortcuts work even when Ragbrain is in the background.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}

// MARK: - General Settings
struct GeneralSettingsTab: View {
    @AppStorage("launchAtLogin") private var launchAtLogin = false
    @AppStorage("showInDock") private var showInDock = true
    @AppStorage("captureContext") private var captureContext = true

    var body: some View {
        Form {
            Section {
                Toggle("Launch at Login", isOn: $launchAtLogin)
                Toggle("Show in Dock", isOn: $showInDock)
            } header: {
                Text("Startup")
            }

            Section {
                Toggle("Capture Context", isOn: $captureContext)
            } header: {
                Text("Capture")
            } footer: {
                Text("When enabled, captures the current app, file, and git branch with each thought.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}

// MARK: - Obsidian Settings
struct ObsidianSettingsTab: View {
    @StateObject private var syncManager = ObsidianSyncManager()
    @State private var isSelectingVault = false

    var body: some View {
        Form {
            Section {
                HStack {
                    if let vault = syncManager.vaultPath {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(vault.lastPathComponent)
                                .fontWeight(.medium)
                            Text(vault.path)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    } else {
                        Text("No vault selected")
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Button("Detect") {
                        Task {
                            await syncManager.detectVault()
                        }
                    }
                    .disabled(syncManager.syncStatus == .detecting)

                    Button("Browse...") {
                        selectVault()
                    }
                }

                if syncManager.vaultPath != nil {
                    Toggle("Enable Sync", isOn: $syncManager.syncEnabled)
                }
            } header: {
                Text("Vault")
            } footer: {
                Text("Select your Obsidian vault to sync thoughts and conversations as markdown files.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if syncManager.vaultPath != nil {
                Section {
                    HStack {
                        syncStatusView

                        Spacer()

                        Button("Sync Now") {
                            Task {
                                await syncManager.sync()
                            }
                        }
                        .disabled(!canSync)
                    }

                    if let progress = syncManager.syncProgress {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(progress.phase)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if progress.total > 0 {
                                ProgressView(value: Double(progress.current), total: Double(progress.total))
                            }
                        }
                    }

                    if let lastSync = syncManager.lastSync {
                        HStack {
                            Text("Last synced:")
                                .foregroundStyle(.secondary)
                            Text(lastSync, style: .relative)
                                .foregroundStyle(.secondary)
                        }
                        .font(.caption)
                    }
                } header: {
                    Text("Sync Status")
                }
            }
        }
        .formStyle(.grouped)
        .padding()
    }

    private var canSync: Bool {
        guard syncManager.vaultPath != nil else { return false }
        switch syncManager.syncStatus {
        case .syncing, .detecting:
            return false
        default:
            return true
        }
    }

    @ViewBuilder
    private var syncStatusView: some View {
        switch syncManager.syncStatus {
        case .idle:
            HStack(spacing: 4) {
                Image(systemName: "circle")
                    .foregroundStyle(.secondary)
                Text("Ready")
                    .foregroundStyle(.secondary)
            }
        case .detecting:
            HStack(spacing: 4) {
                ProgressView()
                    .scaleEffect(0.7)
                Text("Detecting vault...")
                    .foregroundStyle(.secondary)
            }
        case .syncing:
            HStack(spacing: 4) {
                ProgressView()
                    .scaleEffect(0.7)
                Text("Syncing...")
                    .foregroundStyle(.blue)
            }
        case .success(let thoughts, let conversations):
            HStack(spacing: 4) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("Synced \(thoughts) thoughts, \(conversations) conversations")
                    .foregroundStyle(.green)
            }
        case .error(let message):
            HStack(spacing: 4) {
                Image(systemName: "exclamationmark.circle.fill")
                    .foregroundStyle(.red)
                Text(message)
                    .foregroundStyle(.red)
                    .lineLimit(1)
            }
        }
    }

    private func selectVault() {
        let panel = NSOpenPanel()
        panel.title = "Select Obsidian Vault"
        panel.message = "Choose the folder containing your Obsidian vault"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false

        if panel.runModal() == .OK, let url = panel.url {
            syncManager.setVaultPath(url)
        }
    }
}

#Preview {
    SettingsView()
        .environmentObject(APIConfiguration.shared)
}
