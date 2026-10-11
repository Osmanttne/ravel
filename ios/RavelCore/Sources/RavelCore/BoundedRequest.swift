import Foundation

/// A fresh ephemeral session per check. Locking covers cancellation races; delegate callbacks are serial.
final class BoundedRequest: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let configuration: BackendConfiguration
    private let protocolClasses: [AnyClass]?
    private let lock = NSLock()
    private var continuation: CheckedContinuation<CheckResponse, Error>?
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var body = Data()
    private var response: HTTPURLResponse?
    private var finished = false
    init(configuration: BackendConfiguration, protocolClasses: [AnyClass]?) {
        self.configuration = configuration; self.protocolClasses = protocolClasses
    }
    func perform(_ request: URLRequest) async throws -> CheckResponse {
        try await withCheckedThrowingContinuation { continuation in
            lock.lock()
            guard !finished else { lock.unlock(); continuation.resume(throwing: CheckError.cancelled); return }
            self.continuation = continuation
            let options = Self.sessionConfiguration(configuration, protocolClasses: protocolClasses)
            let session = URLSession(configuration: options, delegate: self, delegateQueue: nil)
            self.session = session
            let task = session.dataTask(with: request)
            self.task = task
            lock.unlock()
            task.resume()
        }
    }
    static func sessionConfiguration(_ configuration: BackendConfiguration,
                                     protocolClasses: [AnyClass]? = nil) -> URLSessionConfiguration {
        let options = URLSessionConfiguration.ephemeral
        options.urlCache = nil; options.httpCookieStorage = nil; options.urlCredentialStorage = nil
        options.httpShouldSetCookies = false; options.requestCachePolicy = .reloadIgnoringLocalCacheData
        options.timeoutIntervalForRequest = configuration.timeoutSeconds
        options.timeoutIntervalForResource = configuration.timeoutSeconds
        options.waitsForConnectivity = false
        if let protocolClasses { options.protocolClasses = protocolClasses }
        return options
    }
    func cancel() { finish(.failure(CheckError.cancelled)) }
    private func finish(_ result: Result<CheckResponse, Error>) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        let continuation = self.continuation, session = self.session, task = self.task
        self.continuation = nil; self.session = nil; self.task = nil; body.removeAll()
        lock.unlock()
        task?.cancel(); session?.invalidateAndCancel()
        continuation?.resume(with: result)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse else {
            finish(.failure(CheckError.invalidResponse)); completionHandler(.cancel); return
        }
        guard !(300...399).contains(http.statusCode) else {
            finish(.failure(CheckError.redirectRefused)); completionHandler(.cancel); return
        }
        guard response.expectedContentLength <= Int64(CheckClient.maxResponseBytes) else {
            finish(.failure(CheckError.responseTooLarge)); completionHandler(.cancel); return
        }
        guard http.mimeType?.lowercased() == "application/json" else {
            finish(.failure(CheckError.invalidResponse)); completionHandler(.cancel); return
        }
        lock.lock(); self.response = http; lock.unlock()
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        guard body.count + data.count <= CheckClient.maxResponseBytes else {
            lock.unlock(); finish(.failure(CheckError.responseTooLarge)); return
        }
        body.append(data); lock.unlock()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            let code = (error as? URLError)?.code
            finish(.failure(code == .cancelled ? CheckError.cancelled : code == .timedOut ? CheckError.timeout : CheckError.networkUnavailable))
            return
        }
        lock.lock(); let response = self.response, data = body; let finished = self.finished; lock.unlock()
        guard !finished else { return }
        guard let response else { finish(.failure(CheckError.invalidResponse)); return }
        if response.statusCode == 200 {
            do { finish(.success(try JSONDecoder().decode(CheckResponse.self, from: data))) }
            catch { finish(.failure(CheckError.invalidResponse)) }
        } else {
            let code = (try? JSONDecoder().decode(ErrorEnvelope.self, from: data))?.error.code
            finish(.failure(Self.publicError(code)))
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil); finish(.failure(CheckError.redirectRefused))
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, willCacheResponse proposedResponse: CachedURLResponse,
                    completionHandler: @escaping (CachedURLResponse?) -> Void) { completionHandler(nil) }
    private static func publicError(_ code: String?) -> CheckError {
        switch code {
        case "too_large": return .tooLarge
        case "unsupported_media": return .unsupportedMedia
        case "unsafe_url": return .unsafeURL
        case "insufficient_input": return .insufficientInput
        case "provider_timeout": return .timeout
        case "provider_invalid_output": return .providerInvalidOutput
        case "service_unavailable": return .serviceUnavailable
        default: return .requestRejected
        }
    }
}
private struct ErrorEnvelope: Decodable {
    let error: Detail
    struct Detail: Decodable { let code: String }
}
