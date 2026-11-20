import Foundation
import Security

enum KeychainStore {
    private static let service = "com.yacacode.minecraft.credentials"

    enum Key: String {
        case username = "yc_username"
        case password = "yc_password"
        case serverURL = "yc_server_url"
        case sessionCookie = "yc_session_cookie"
    }

    @discardableResult
    static func set(_ value: String, for key: Key) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }
        delete(key)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecValueData as String: data
        ]
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    static func get(_ key: Key) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func delete(_ key: Key) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue
        ]
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    static func clearCredentials() {
        delete(.username)
        delete(.password)
    }

    static func hasSavedCredentials() -> Bool {
        guard let u = get(.username), let p = get(.password) else { return false }
        return !u.isEmpty && !p.isEmpty
    }
}
