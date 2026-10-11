import Foundation
import RavelCore

public enum BackendSetupError: Error, LocalizedError, Sendable {
    case notConfigured
    case invalidConfiguration

    public var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "A Ravel backend hasn't been configured for this build."
        case .invalidConfiguration:
            return "The backend configuration is invalid. Check this build's server settings."
        }
    }
}

public enum BundleBackendConfiguration {
    public static func makeConfiguration(bundle: Bundle = .main) throws -> BackendConfiguration {
        let configured = (bundle.object(forInfoDictionaryKey: "RavelAPIBaseURL") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !configured.isEmpty else { throw BackendSetupError.notConfigured }
        guard let url = URL(string: configured) else { throw BackendSetupError.invalidConfiguration }
        #if DEBUG
        let allowLocalHTTP = true
        #else
        let allowLocalHTTP = false
        #endif
        do {
            return try BackendConfiguration(baseURL: url, allowLocalHTTP: allowLocalHTTP,
                                            timeoutSeconds: 45)
        } catch {
            throw BackendSetupError.invalidConfiguration
        }
    }
}
