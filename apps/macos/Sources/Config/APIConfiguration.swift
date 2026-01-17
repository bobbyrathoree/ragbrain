import Foundation
import Security

/// Centralized API configuration for Ultrathink
final class APIConfiguration: ObservableObject {
    static let shared = APIConfiguration()

    /// API endpoint URL - update after CDK deployment
    @Published var baseURL: String {
        didSet {
            UserDefaults.standard.set(baseURL, forKey: "ultrathink.apiBaseURL")
        }
    }

    /// Whether we have a valid API key stored
    @Published var hasAPIKey: Bool = false

    /// Connection status
    @Published var isConnected: Bool = false

    private let defaultBaseURL = "https://api.ultrathink.dev"

    private init() {
        self.baseURL = UserDefaults.standard.string(forKey: "ultrathink.apiBaseURL") ?? defaultBaseURL
        self.hasAPIKey = KeychainHelper.load(key: "ultrathink-api-key") != nil
    }

    /// Get the API key from Keychain
    var apiKey: String? {
        KeychainHelper.load(key: "ultrathink-api-key")
    }

    /// Store API key in Keychain
    func setAPIKey(_ key: String) -> Bool {
        let success = KeychainHelper.save(key: "ultrathink-api-key", value: key)
        hasAPIKey = success
        return success
    }

    /// Remove API key from Keychain
    func clearAPIKey() {
        KeychainHelper.delete(key: "ultrathink-api-key")
        hasAPIKey = false
    }

    /// Test the API connection
    func testConnection() async -> Bool {
        guard let apiKey = apiKey else {
            await MainActor.run { isConnected = false }
            return false
        }

        let endpoint = URL(string: "\(baseURL)/thoughts?limit=1")!
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.timeoutInterval = 10

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            let httpResponse = response as? HTTPURLResponse
            let connected = httpResponse?.statusCode == 200

            await MainActor.run { isConnected = connected }
            return connected
        } catch {
            await MainActor.run { isConnected = false }
            return false
        }
    }
}

// MARK: - Keychain Helper
enum KeychainHelper {
    private static let serviceName = "com.ultrathink.app"

    static func save(key: String, value: String) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }

        // Delete existing item first
        delete(key: key)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        return status == errSecSuccess
    }

    static func load(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            return nil
        }

        return value
    }

    static func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key
        ]

        SecItemDelete(query as CFDictionary)
    }
}
