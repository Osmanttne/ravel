// Standalone runtime checks for environments without XCTest. Compile alongside
// the actual Core sources; these checks never contact Google or a real server.
import Foundation

private enum CoreValidationError: Error { case failed(String) }

private func requireCore(_ value: @autoclosure () -> Bool, _ label: String) throws {
    guard value() else { throw CoreValidationError.failed(label) }
}

private func expectCoreError(_ expected: CheckError, _ action: () throws -> Void) throws {
    do { try action(); throw CoreValidationError.failed("Expected bounded client rejection") }
    catch let error as CheckError { try requireCore(error == expected, "Correct client error") }
}

private final class ReplayState: @unchecked Sendable {
    enum Scenario { case response(Data), redirect, oversized, timeout, waiting }
    private let lock = NSLock()
    private var scenario: Scenario = .waiting
    private var count = 0
    var requestCount: Int { lock.lock(); defer { lock.unlock() }; return count }
    func set(_ value: Scenario) { lock.lock(); scenario = value; lock.unlock() }
    func next() -> Scenario { lock.lock(); defer { lock.unlock() }; count += 1; return scenario }
}

private final class ReplayProtocol: URLProtocol, @unchecked Sendable {
    static let state = ReplayState()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        guard request.url?.absoluteString == "https://backend.example/v1/check",
              request.httpMethod == "POST" else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        let scenario = Self.state.next()
        if case .waiting = scenario { return }
        if case .timeout = scenario {
            client?.urlProtocol(self, didFailWithError: URLError(.timedOut))
            return
        }
        var status = 200
        var headers = ["Content-Type": "application/json"]
        var data = Data()
        switch scenario {
        case .response(let response): data = response
        case .redirect:
            status = 307
            headers["Location"] = "https://other.example/collect"
        case .oversized: headers["Content-Length"] = String(CheckClient.maxResponseBytes + 1)
        case .timeout, .waiting: break
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: status,
                                       httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}

@main
private struct CoreChecks {
    static func main() async {
        do {
            let folder = URL(fileURLWithPath: "ios/RavelCore/Tests/RavelCoreTests/Fixtures")
            for name in ["backend-fixture", "gemini-text", "gemini-image"] {
                let data = try Data(contentsOf: folder.appendingPathComponent(name + ".json"))
                let response = try JSONDecoder().decode(CheckResponse.self, from: data)
                try requireCore(!response.reportCreated && !response.assessment.verifiedFraud
                                && !response.assessment.knownThreat, "Private unverified response")
                try requireCore(response.mode == (name == "backend-fixture" ? .fixture : .gemini),
                                "Provider mode preserved")
            }
            let fixtureData = try Data(contentsOf: folder.appendingPathComponent("backend-fixture.json"))
            let configuration = try BackendConfiguration(baseURL: URL(string: "https://backend.example")!)
            let service = CheckClient(configuration: configuration, protocolClasses: [ReplayProtocol.self])
            for input in [CheckSubmission.text("Synthetic message 🧪"), .url("https://tickets.example/offer")] {
                let request = try service.makeRequest(input, source: .iosShare)
                let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: String]
                try requireCore(body.count == 4 && body["privacy_mode"] == "private_check"
                                && body["source_channel"] == "ios_share", "Private JSON wire fields")
                try requireCore(request.value(forHTTPHeaderField: "Authorization") == nil
                                && !request.httpShouldHandleCookies, "No client credentials/cookies")
            }
            let image = try Data(contentsOf: URL(fileURLWithPath: "backend/app/fixtures/ticket_offer.png"))
            let multipart = try service.makeRequest(.image(image, mimeType: "image/png"), source: .iosApp)
            let body = String(decoding: multipart.httpBody!, as: UTF8.self)
            try requireCore(body.contains("name=\"privacy_mode\"\r\n\r\nprivate_check")
                            && body.contains("name=\"source_channel\"\r\n\r\nios_app")
                            && multipart.httpBody!.range(of: image) != nil, "Private multipart wire fields")
            try expectCoreError(.tooLarge) {
                _ = try service.makeRequest(.text(String(repeating: "a\u{301}", count: 5_001)), source: .iosApp)
            }
            try expectCoreError(.invalidConfiguration) {
                _ = try BackendConfiguration(baseURL: URL(string: "http://backend.example")!, allowLocalHTTP: true)
            }
            _ = try BackendConfiguration(baseURL: URL(string: "http://localhost:8001")!, allowLocalHTTP: true)
            var reported = try JSONSerialization.jsonObject(with: fixtureData) as! [String: Any]
            reported["report_created"] = true
            let reportedData = try JSONSerialization.data(withJSONObject: reported)
            try expectCoreError(.invalidResponse) { _ = try JSONDecoder().decode(CheckResponse.self, from: reportedData) }
            try requireCore(SharedItemSelection.preferredKind(supportsImage: false, supportsURL: true,
                                                            supportsPlainText: true) == .url,
                            "URL preferred over alternate text")
            do {
                _ = try SharedItemSelection.requireSingle([.image, .text])
                throw CoreValidationError.failed("Multiple items rejected")
            } catch SharedItemSelectionError.multiple {}

            ReplayProtocol.state.set(.response(fixtureData))
            let response = try await service.check(.url("https://tickets.example/offer"), source: .iosShare)
            try requireCore(response.mode == .fixture && !response.reportCreated, "URLSession fixture response")
            for (scenario, expected) in [(ReplayState.Scenario.redirect, CheckError.redirectRefused),
                                         (.oversized, .responseTooLarge), (.timeout, .timeout),
                                         (.response(Data("invalid JSON".utf8)), .invalidResponse)] {
                ReplayProtocol.state.set(scenario)
                do {
                    _ = try await service.check(.text("Synthetic"), source: .iosApp)
                    throw CoreValidationError.failed("Transport rejection")
                } catch let error as CheckError {
                    try requireCore(error == expected, "Correct transport rejection")
                }
            }
            ReplayProtocol.state.set(.waiting)
            let operation = Task { try await service.check(.text("Synthetic"), source: .iosApp) }
            try await Task.sleep(nanoseconds: 50_000_000)
            operation.cancel()
            do { _ = try await operation.value; throw CoreValidationError.failed("Cancellation") }
            catch let error as CheckError { try requireCore(error == .cancelled, "Active check cancelled") }
            print("Core runtime checks passed: real response contracts, private JSON/multipart, limits, provider selection, URLSession, redirect/response/error bounds, cancellation.")
        } catch {
            print("Core runtime validation failed: \(error)")
            exit(1)
        }
    }
}
