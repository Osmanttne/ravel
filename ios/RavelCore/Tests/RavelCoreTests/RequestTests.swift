import Foundation
import XCTest
@testable import RavelCore

final class RequestTests: XCTestCase {
    func testHTTPSAndExplicitLocalDevelopmentConfiguration() throws {
        _ = try BackendConfiguration(baseURL: URL(string: "https://backend.example/api")!)
        for host in ["localhost", "127.0.0.1", "[::1]", "10.0.0.2", "172.16.0.1", "192.168.1.7", "[fd00::1]"] {
            let url = URL(string: "http://\(host):8001")!
            XCTAssertThrowsError(try BackendConfiguration(baseURL: url))
            _ = try BackendConfiguration(baseURL: url, allowLocalHTTP: true)
        }
        for value in ["http://backend.example", "http://8.8.8.8", "http://172.32.0.1", "http://192.169.1.7",
                      "http://010.0.0.1", "http://[fd::1]", "http://[fcf::1]",
                      "https://user:password@backend.example", "https://backend.example?token=private",
                      "https://backend.example#fragment", "file:///tmp/backend"] {
            XCTAssertThrowsError(try BackendConfiguration(baseURL: URL(string: value)!, allowLocalHTTP: true), value)
        }
        for timeout in [0, -1, .infinity, .nan, 121] {
            XCTAssertThrowsError(try BackendConfiguration(baseURL: URL(string: "https://backend.example")!, timeoutSeconds: timeout))
        }
    }

    func testTextAndURLRequestsHaveExactlyOnePrivateInput() throws {
        let client = try makeClient()
        for (submission, key, value) in [(CheckSubmission.text("A quoted message 🧪"), "text", "A quoted message 🧪"),
                                         (.url("https://tickets.example/offer?token=private"), "url", "https://tickets.example/offer?token=private")] {
            let request = try client.makeRequest(submission, source: .iosShare)
            XCTAssertEqual(request.url?.absoluteString, "https://backend.example/api/v1/check")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertFalse(request.httpShouldHandleCookies)
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: String])
            XCTAssertEqual(Set(body.keys), ["content_type", key, "source_channel", "privacy_mode"])
            XCTAssertEqual(body[key], value)
            XCTAssertEqual(body["content_type"], key)
            XCTAssertEqual(body["source_channel"], "ios_share")
            XCTAssertEqual(body["privacy_mode"], "private_check")
        }
    }

    func testMultipartContainsOnlyFixedMetadataAndOriginalImage() throws {
        let client = try makeClient()
        let bytes = Data([0x89, 0x50, 0x4e, 0x47, 0, 255])
        let request = try client.makeRequest(.image(bytes, mimeType: "image/png"), source: .iosApp)
        let type = try XCTUnwrap(request.value(forHTTPHeaderField: "Content-Type"))
        let boundary = try XCTUnwrap(type.components(separatedBy: "boundary=").last)
        let body = try XCTUnwrap(request.httpBody)
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertTrue(type.hasPrefix("multipart/form-data; boundary=Ravel-"))
        XCTAssertEqual(text.components(separatedBy: "Content-Disposition: form-data;").count - 1, 4)
        XCTAssertTrue(text.contains("name=\"privacy_mode\"\r\n\r\nprivate_check\r\n"))
        XCTAssertTrue(text.contains("name=\"source_channel\"\r\n\r\nios_app\r\n"))
        XCTAssertTrue(text.contains("filename=\"shared.png\"\r\nContent-Type: image/png"))
        XCTAssertNotNil(body.range(of: bytes))
        XCTAssertTrue(text.hasSuffix("\r\n--\(boundary)--\r\n"))
        XCTAssertLessThan(body.count, CheckClient.maxRequestBytes)
    }

    func testInputLimitsCountUnicodeScalarsAndRejectUnsupportedInput() throws {
        let client = try makeClient()
        _ = try client.makeRequest(.text(String(repeating: "🧪", count: 10_000)), source: .iosApp)
        assertError(.tooLarge) { try client.makeRequest(.text(String(repeating: "🧪", count: 10_001)), source: .iosApp) }
        assertError(.tooLarge) { try client.makeRequest(.text(String(repeating: "a\u{301}", count: 5_001)), source: .iosApp) }
        assertError(.insufficientInput) { try client.makeRequest(.text(" \n\t"), source: .iosApp) }
        let longURL = "https://tickets.example/" + String(repeating: "a", count: 2_050)
        assertError(.tooLarge) { try client.makeRequest(.url(longURL), source: .iosApp) }
        for value in ["file:///tmp/private", "https://user:password@tickets.example", "https://tickets.example/\n", "https:\\tickets.example"] {
            assertError(.unsafeURL) { try client.makeRequest(.url(value), source: .iosApp) }
        }
        assertError(.insufficientInput) { try client.makeRequest(.image(Data(), mimeType: "image/png"), source: .iosApp) }
        assertError(.unsupportedMedia) { try client.makeRequest(.image(Data([1]), mimeType: "image/heic"), source: .iosApp) }
        assertError(.tooLarge) { try client.makeRequest(.image(Data(count: CheckClient.maxImageBytes + 1), mimeType: "image/png"), source: .iosApp) }
    }

    func testSessionHasNoCookieCacheCredentialOrPersistentStore() throws {
        let configuration = try BackendConfiguration(baseURL: URL(string: "https://backend.example")!)
        let options = BoundedRequest.sessionConfiguration(configuration)
        XCTAssertNil(options.identifier)
        XCTAssertNil(options.httpCookieStorage)
        XCTAssertNil(options.urlCredentialStorage)
        XCTAssertNil(options.urlCache)
        XCTAssertFalse(options.httpShouldSetCookies)
        XCTAssertFalse(options.waitsForConnectivity)
        XCTAssertEqual(options.requestCachePolicy, .reloadIgnoringLocalCacheData)
        XCTAssertEqual(options.timeoutIntervalForRequest, 45)
        XCTAssertEqual(options.timeoutIntervalForResource, 45)
    }
}

func makeClient() throws -> CheckClient {
    CheckClient(configuration: try BackendConfiguration(baseURL: URL(string: "https://backend.example/api")!))
}
func assertError<T>(_ expected: CheckError, file: StaticString = #filePath, line: UInt = #line,
                    _ operation: () throws -> T) {
    XCTAssertThrowsError(try operation(), file: file, line: line) { error in
        XCTAssertEqual(error as? CheckError, expected, file: file, line: line)
    }
}
