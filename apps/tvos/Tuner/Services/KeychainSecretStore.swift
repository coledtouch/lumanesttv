import Foundation
import Security
import TunerCore

/// Line passwords in the Keychain: generic passwords, service "app.tunertv.line", account = the login's id.
/// The app's default Keychain access group needs no entitlement.
final class KeychainSecretStore: SecretStore, @unchecked Sendable {
    private let service: String

    init(service: String = "app.tunertv.line") {
        self.service = service
    }

    func secret(forAccount account: String) -> String? {
        var query = base(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func setSecret(_ value: String?, forAccount account: String) {
        SecItemDelete(base(account) as CFDictionary)
        guard let value, let data = value.data(using: .utf8) else { return }
        var item = base(account)
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(item as CFDictionary, nil)
        if status != errSecSuccess {
            NSLog("Tuner: Keychain save failed (%ld)", Int(status))
        }
    }

    /// For tests: adds and removes a throwaway item. Unsigned simulator builds return errSecMissingEntitlement (-34018).
    func probe() -> OSStatus {
        let account = "probe-" + UUID().uuidString
        var item = base(account)
        item[kSecValueData as String] = Data("x".utf8)
        let status = SecItemAdd(item as CFDictionary, nil)
        SecItemDelete(base(account) as CFDictionary)
        return status
    }

    private func base(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }
}
