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

            GeneralSettingsTab()
                .tabItem {
                    Label("General", systemImage: "gear")
                }
        }
        .frame(width: 450, height: 300)
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
                Text("These shortcuts work even when Ultrathink is in the background.")
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

#Preview {
    SettingsView()
        .environmentObject(APIConfiguration.shared)
}
