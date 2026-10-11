import Foundation
import XCTest
@testable import RavelCore

final class NetworkTests: XCTestCase {
    override func tearDown() {
        MockURLProtocol.state.reset()
        super.tearDown()
    }

    func testOnlyConfiguredBackendReceivesOnePOSTAndFixtureModeRemainsVisible() async throws {
        let data = try fixture()
        MockURLProtocol.state.set { stub in
            XCTAssertEqual(stub.request.url?.absoluteString, "https://backend.example/v1/check")
            XCTAssertEqual(stub.request.httpMethod, "POST")
            XCTAssertNil(stub.request.value(forHTTPHeaderField: "Cookie"))
            XCTAssertNil(stub.request.value(forHTTPHeaderField: "Authorization"))
            stub.respond(data)
        }
        let response = try await client().check(.url("https://tickets.example/private?token=synthetic"), source: .iosShare)
        XCTAssertEqual(response.mode, .fixture)
        XCTAssertFalse(response.reportCreated)
        XCTAssertEqual(MockURLProtocol.state.requestCount, 1)
    }

    func testProviderAndValidationErrorsUseFixedMessagesWithoutServerSecrets() async throws {
        let mappings: [(String, CheckError, Int)] = [
            ("provider_timeout", .timeout, 504), ("provider_invalid_output", .providerInvalidOutput, 502),
            ("service_unavailable", .serviceUnavailable, 503), ("too_large", .tooLarge, 413),
            ("unsafe_url", .unsafeURL, 422), ("unsupported_media", .unsupportedMedia, 415),
            ("insufficient_input", .insufficientInput, 422), ("raw-private-token", .requestRejected, 422)
        ]
        for (code, expected, status) in mappings {
            let data = try JSONSerialization.data(withJSONObject: [
                "error": ["code": code, "message": "API_KEY-secret https://private.example?token=private"],
                "request_id": "private-id"
            ])
            MockURLProtocol.state.set { $0.respond(data, status: status) }
            await assertAsyncError(expected) { try await self.client().check(.text("Synthetic message"), source: .iosApp) }
            XCTAssertFalse(expected.localizedDescription.contains("secret"))
            XCTAssertFalse(expected.localizedDescription.contains("private"))
        }
    }

    func testInvalidJSONWrongMediaAndPrivacyViolatingResponseFailClosed() async throws {
        let invalid = Data("{invalid".utf8)
        MockURLProtocol.state.set { $0.respond(invalid) }
        await assertAsyncError(.invalidResponse) { try await self.client().check(.text("Synthetic"), source: .iosApp) }
        let data = try fixture()
        MockURLProtocol.state.set { $0.respond(data, headers: ["Content-Type": "text/html"]) }
        await assertAsyncError(.invalidResponse) { try await self.client().check(.text("Synthetic"), source: .iosApp) }
        var object = try fixtureObject("backend-fixture")
        object["report_created"] = true
        let reported = try JSONSerialization.data(withJSONObject: object)
        MockURLProtocol.state.set { $0.respond(reported) }
        await assertAsyncError(.invalidResponse) { try await self.client().check(.text("Synthetic"), source: .iosApp) }
    }

    func testDeclaredAndStreamingResponseLimits() async throws {
        let data = try fixture()
        MockURLProtocol.state.set { $0.respond(data, headers: ["Content-Type": "application/json", "Content-Length": "\(CheckClient.maxResponseBytes + 1)"]) }
        await assertAsyncError(.responseTooLarge) { try await self.client().check(.text("Synthetic"), source: .iosApp) }
        MockURLProtocol.state.set { stub in
            stub.beginResponse()
            for _ in 0..<9 { stub.client?.urlProtocol(stub, didLoad: Data(count: 64 * 1024)) }
            stub.client?.urlProtocolDidFinishLoading(stub)
        }
        await assertAsyncError(.responseTooLarge) { try await self.client().check(.text("Synthetic"), source: .iosApp) }
    }

    func testRedirectDoesNotForwardPrivateSubmission() async throws {
        MockURLProtocol.state.set { stub in
            stub.respond(Data(), status: 307, headers: ["Content-Type": "application/json", "Location": "https://other.example/collect"])
        }
        await assertAsyncError(.redirectRefused) { try await self.client().check(.text("Synthetic private message"), source: .iosApp) }
        XCTAssertEqual(MockURLProtocol.state.requestCount, 1)
        // Exercise the redirect callback too; the completion must refuse a new URLRequest.
        let configuration = try BackendConfiguration(baseURL: URL(string: "https://backend.example")!)
        let operation = BoundedRequest(configuration: configuration, protocolClasses: nil)
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let task = session.dataTask(with: URL(string: "https://backend.example/v1/check")!)
        let redirect = HTTPURLResponse(url: task.originalRequest!.url!, statusCode: 307, httpVersion: nil, headerFields: [:])!
        var refused = false
        operation.urlSession(session, task: task, willPerformHTTPRedirection: redirect,
                             newRequest: URLRequest(url: URL(string: "https://other.example/collect")!)) { request in
            refused = request == nil
        }
        XCTAssertTrue(refused)
    }

    func testCancellationStopsInFlightCheckAndPrecancelledCheckSendsNothing() async throws {
        let started = expectation(description: "request started")
        MockURLProtocol.state.set { _ in started.fulfill() }
        let service = try client()
        let task = Task { try await service.check(.text("Synthetic"), source: .iosApp) }
        await fulfillment(of: [started], timeout: 2)
        task.cancel()
        await assertAsyncError(.cancelled) { try await task.value }
        let count = MockURLProtocol.state.requestCount
        let cancelled = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await service.check(.text("Synthetic"), source: .iosApp)
        }
        await assertAsyncError(.cancelled) { try await cancelled.value }
        XCTAssertEqual(MockURLProtocol.state.requestCount, count)
    }

    func testTransportTimeoutAndNetworkFailureAreScrubbed() async throws {
        for (code, expected) in [(URLError.timedOut, CheckError.timeout), (.cannotConnectToHost, .networkUnavailable)] {
            MockURLProtocol.state.set { stub in
                stub.client?.urlProtocol(stub, didFailWithError: URLError(code, userInfo: [NSLocalizedDescriptionKey: "private raw transport detail"]))
            }
            await assertAsyncError(expected) { try await self.client().check(.text("Synthetic"), source: .iosApp) }
        }
    }

    private func client() throws -> CheckClient {
        CheckClient(configuration: try BackendConfiguration(baseURL: URL(string: "https://backend.example")!),
                    protocolClasses: [MockURLProtocol.self])
    }
}

private final class MockURLProtocol: URLProtocol, @unchecked Sendable {
    final class State: @unchecked Sendable {
        private let lock = NSLock()
        private var handler: ((MockURLProtocol) -> Void)?
        private var count = 0
        var requestCount: Int { lock.lock(); defer { lock.unlock() }; return count }
        func set(_ handler: @escaping (MockURLProtocol) -> Void) {
            lock.lock(); self.handler = handler; lock.unlock()
        }
        func reset() { lock.lock(); handler = nil; count = 0; lock.unlock() }
        func load(_ stub: MockURLProtocol) {
            lock.lock(); count += 1; let action = handler; lock.unlock()
            if let action { action(stub) }
            else { stub.client?.urlProtocol(stub, didFailWithError: URLError(.unsupportedURL)) }
        }
    }
    static let state = State()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.state.load(self) }
    override func stopLoading() {}
    func beginResponse(status: Int = 200, headers: [String: String] = ["Content-Type": "application/json"]) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    }
    func respond(_ data: Data, status: Int = 200, headers: [String: String] = ["Content-Type": "application/json"]) {
        beginResponse(status: status, headers: headers)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}

private func assertAsyncError<T>(_ expected: CheckError, file: StaticString = #filePath, line: UInt = #line,
                                 _ operation: () async throws -> T) async {
    do { _ = try await operation(); XCTFail("Expected \(expected)", file: file, line: line) }
    catch { XCTAssertEqual(error as? CheckError, expected, file: file, line: line) }
}
