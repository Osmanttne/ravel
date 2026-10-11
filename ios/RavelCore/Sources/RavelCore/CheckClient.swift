import Foundation
import Darwin

public enum CheckError: Error, LocalizedError, Equatable, Sendable {
    case invalidConfiguration, insufficientInput, tooLarge, unsupportedMedia, unsafeURL
    case invalidResponse, responseTooLarge, redirectRefused, timeout, serviceUnavailable
    case providerInvalidOutput, requestRejected, cancelled, networkUnavailable
    public var errorDescription: String? {
        switch self {
        case .invalidConfiguration: return "Choose an HTTPS backend, or explicitly enable a local development server."
        case .insufficientInput: return "Add a message, link, or screenshot to check."
        case .tooLarge: return "This item exceeds the upload limit. Choose a smaller item."
        case .unsupportedMedia: return "Choose a PNG or JPEG screenshot."
        case .unsafeURL: return "Provide a complete HTTP or HTTPS link without credentials."
        case .invalidResponse: return "The server returned an invalid assessment. Please retry."
        case .responseTooLarge: return "The server response exceeded the limit. Please retry."
        case .redirectRefused: return "The backend redirected this private check. Verify its address."
        case .timeout: return "The check timed out. Please retry."
        case .serviceUnavailable: return "The check service is unavailable. Please retry."
        case .providerInvalidOutput: return "AI extraction returned incomplete evidence. Please retry."
        case .requestRejected: return "The server rejected this item. Check its format and retry."
        case .cancelled: return "The check was cancelled."
        case .networkUnavailable: return "Could not reach the backend. Check your connection and its address."
        }
    }
}

public struct BackendConfiguration: Sendable {
    public let baseURL: URL
    public let timeoutSeconds: Double
    public init(baseURL: URL, allowLocalHTTP: Bool = false, timeoutSeconds: Double = 45) throws {
        guard let url = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
              let host = url.host, !host.isEmpty, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, timeoutSeconds.isFinite,
              timeoutSeconds > 0, timeoutSeconds <= 120,
              url.port.map({ (1...65535).contains($0) }) ?? true else {
            throw CheckError.invalidConfiguration
        }
        let scheme = url.scheme?.lowercased()
        guard scheme == "https" || (scheme == "http" && allowLocalHTTP && Self.isLocal(host)) else {
            throw CheckError.invalidConfiguration
        }
        self.baseURL = baseURL; self.timeoutSeconds = timeoutSeconds
    }
    private static func isLocal(_ host: String) -> Bool {
        let name = host.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        if name == "localhost" || name == "::1" { return true }
        var ipv6 = in6_addr()
        if inet_pton(AF_INET6, name, &ipv6) == 1 {
            let bytes = withUnsafeBytes(of: ipv6) { Array($0) }
            return bytes[0] == 0xfc || bytes[0] == 0xfd
        }
        var ipv4 = in_addr()
        guard inet_pton(AF_INET, name, &ipv4) == 1 else { return false }
        let bytes = withUnsafeBytes(of: ipv4) { Array($0) }
        guard name == bytes.map({ String($0) }).joined(separator: ".") else { return false }
        return bytes[0] == 127 || bytes[0] == 10 ||
            (bytes[0] == 172 && (16...31).contains(bytes[1])) ||
            (bytes[0] == 192 && bytes[1] == 168)
    }
}

public enum CheckSource: String, Codable, Sendable { case iosApp = "ios_app", iosShare = "ios_share" }
public enum CheckSubmission: Sendable {
    case text(String), url(String), image(Data, mimeType: String)
}
public protocol CheckServing: Sendable {
    func check(_ submission: CheckSubmission, source: CheckSource) async throws -> CheckResponse
}

public struct CheckClient: CheckServing {
    public static let maxTextScalars = 10_000
    public static let maxURLScalars = 2_048
    public static let maxImageBytes = 5 * 1024 * 1024
    public static let maxRequestBytes = 6 * 1024 * 1024
    public static let maxResponseBytes = 512 * 1024
    private let configuration: BackendConfiguration
    private let protocolClasses: [AnyClass]?
    public init(configuration: BackendConfiguration) {
        self.configuration = configuration; self.protocolClasses = nil
    }
    init(configuration: BackendConfiguration, protocolClasses: [AnyClass]) {
        self.configuration = configuration; self.protocolClasses = protocolClasses
    }
    public func check(_ submission: CheckSubmission, source: CheckSource = .iosApp) async throws -> CheckResponse {
        let request = try makeRequest(submission, source: source)
        let operation = BoundedRequest(configuration: configuration, protocolClasses: protocolClasses)
        return try await withTaskCancellationHandler {
            if Task.isCancelled { throw CheckError.cancelled }
            return try await operation.perform(request)
        } onCancel: { operation.cancel() }
    }
    func makeRequest(_ submission: CheckSubmission, source: CheckSource) throws -> URLRequest {
        var request = URLRequest(url: configuration.baseURL.appendingPathComponent("v1/check"),
                                 cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: configuration.timeoutSeconds)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpShouldHandleCookies = false
        switch submission {
        case .text(let value):
            guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw CheckError.insufficientInput }
            guard value.unicodeScalars.count <= Self.maxTextScalars else { throw CheckError.tooLarge }
            request.httpBody = try JSONEncoder().encode(TextRequest(text: value, sourceChannel: source))
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        case .url(let value):
            guard !value.isEmpty else { throw CheckError.insufficientInput }
            guard value.unicodeScalars.count <= Self.maxURLScalars else { throw CheckError.tooLarge }
            guard !value.contains("\\"), !value.unicodeScalars.contains(where: { CharacterSet.whitespacesAndNewlines.union(.controlCharacters).contains($0) }),
                  let url = URLComponents(string: value), let host = url.host, !host.isEmpty,
                  ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                  url.user == nil, url.password == nil else { throw CheckError.unsafeURL }
            request.httpBody = try JSONEncoder().encode(URLRequestBody(url: value, sourceChannel: source))
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        case .image(let bytes, let mimeType):
            guard !bytes.isEmpty else { throw CheckError.insufficientInput }
            guard bytes.count <= Self.maxImageBytes else { throw CheckError.tooLarge }
            guard ["image/png", "image/jpeg"].contains(mimeType) else { throw CheckError.unsupportedMedia }
            let boundary = "Ravel-" + UUID().uuidString
            var body = Data()
            for (name, value) in [("content_type", "image"), ("source_channel", source.rawValue), ("privacy_mode", "private_check")] {
                body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8))
            }
            let filename = mimeType == "image/png" ? "shared.png" : "shared.jpg"
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"image\"; filename=\"\(filename)\"\r\nContent-Type: \(mimeType)\r\n\r\n".utf8))
            body.append(bytes); body.append(Data("\r\n--\(boundary)--\r\n".utf8))
            request.httpBody = body
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        }
        guard (request.httpBody?.count ?? 0) <= Self.maxRequestBytes else { throw CheckError.tooLarge }
        return request
    }
}

private struct TextRequest: Encodable {
    let contentType = "text", privacyMode = "private_check"
    let text: String
    let sourceChannel: CheckSource
    enum CodingKeys: String, CodingKey { case text; case contentType = "content_type", privacyMode = "privacy_mode", sourceChannel = "source_channel" }
}
private struct URLRequestBody: Encodable {
    let contentType = "url", privacyMode = "private_check"
    let url: String
    let sourceChannel: CheckSource
    enum CodingKeys: String, CodingKey { case url; case contentType = "content_type", privacyMode = "privacy_mode", sourceChannel = "source_channel" }
}
