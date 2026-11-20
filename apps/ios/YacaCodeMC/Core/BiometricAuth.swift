import Foundation
import LocalAuthentication

enum BiometricKind: Equatable {
    case faceID
    case touchID
    case opticID
    case none

    var displayName: String {
        switch self {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        case .none: return "Biometria"
        }
    }

    var systemImage: String {
        switch self {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        case .opticID: return "opticid"
        case .none: return "lock.shield"
        }
    }
}

enum BiometricAuth {
    static func availableKind() -> BiometricKind {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            return .none
        }
        switch context.biometryType {
        case .faceID: return .faceID
        case .touchID: return .touchID
        case .opticID: return .opticID
        default: return .none
        }
    }

    static func canUseDeviceAuth() -> Bool {
        let context = LAContext()
        var error: NSError?
        return context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    }

    static func authenticate(reason: String) async -> Result<Void, Error> {
        let context = LAContext()
        context.localizedCancelTitle = "Usar senha"
        context.localizedFallbackTitle = "Usar código"

        let policy: LAPolicy = availableKind() != .none
            ? .deviceOwnerAuthenticationWithBiometrics
            : .deviceOwnerAuthentication

        return await withCheckedContinuation { continuation in
            context.evaluatePolicy(policy, localizedReason: reason) { success, error in
                if success {
                    continuation.resume(returning: .success(()))
                } else {
                    let err = error ?? NSError(
                        domain: "BiometricAuth",
                        code: -1,
                        userInfo: [NSLocalizedDescriptionKey: "Autenticação biométrica cancelada ou falhou."]
                    )
                    continuation.resume(returning: .failure(err))
                }
            }
        }
    }
}
