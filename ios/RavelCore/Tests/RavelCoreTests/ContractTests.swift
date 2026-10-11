import Foundation
import XCTest
@testable import RavelCore

final class ContractTests: XCTestCase {
    func testActualBackendFixtureAndLiveGeminiProofDecode() throws {
        for (name, mode) in [("backend-fixture", CheckMode.fixture), ("gemini-text", .gemini), ("gemini-image", .gemini)] {
            let response = try JSONDecoder().decode(CheckResponse.self, from: fixture(name))
            XCTAssertEqual(response.mode, mode)
            XCTAssertFalse(response.reportCreated)
            XCTAssertFalse(response.assessment.verifiedFraud)
            XCTAssertFalse(response.assessment.knownThreat)
            XCTAssertEqual(response.assessment.relatedReportCount, 0)
            XCTAssertEqual(response.assessment.category, .suspiciousVerify)
            XCTAssertFalse(response.limitations.isEmpty)
            if mode == .gemini {
                XCTAssertEqual(response.observations?.category, .ticketOffer)
                XCTAssertEqual(response.observations?.paymentRequested, true)
                XCTAssertEqual(response.observations?.urgencyIndicated, true)
                XCTAssertEqual(response.observations?.evidenceSource, .gemini)
                XCTAssertEqual(response.observations?.verificationLevel, .unverifiedInference)
                XCTAssertEqual(response.observations?.destinations, ["https://tickets.example"])
            }
            let roundtrip = try JSONDecoder().decode(CheckResponse.self, from: JSONEncoder().encode(response))
            XCTAssertEqual(roundtrip.checkID, response.checkID)
            XCTAssertEqual(roundtrip.mode, mode)
        }
    }

    func testUnknownObservationsRemainUnknownRatherThanFalseOrSafe() throws {
        var object = try fixtureObject("gemini-text")
        var observations = object["observations"] as! [String: Any]
        for field in ["payment_requested", "payment_reason", "secrecy_requested", "urgency_indicated"] {
            observations[field] = NSNull()
        }
        observations["category"] = "unknown"
        observations["destinations"] = []
        observations["evidence_source"] = "not_analyzed"
        observations["verification_level"] = "not_assessed"
        object["observations"] = observations
        let response = try decode(object)
        XCTAssertNil(response.observations?.paymentRequested)
        XCTAssertNil(response.observations?.paymentReason)
        XCTAssertNil(response.observations?.secrecyRequested)
        XCTAssertNil(response.observations?.urgencyIndicated)
        XCTAssertEqual(response.observations?.category, .unknown)
        XCTAssertEqual(response.observations?.verificationLevel, .notAssessed)
        object["observations"] = NSNull()
        XCTAssertNil(try decode(object).observations)
    }

    func testOlderResponsesKeepNewObservationFieldsUnknown() throws {
        // Recorded responses predate the additive credential/code/account fields.
        for name in ["gemini-text", "gemini-image"] {
            let response = try JSONDecoder().decode(CheckResponse.self, from: fixture(name))
            XCTAssertNil(response.observations?.credentialsRequested)
            XCTAssertNil(response.observations?.verificationCodeRequested)
            XCTAssertNil(response.observations?.accountThreatIndicated)
            XCTAssertEqual(response.assessment.category, .suspiciousVerify)
            XCTAssertFalse(response.reportCreated)
        }
    }

    func testNewObservationFlagsPreserveTrueFalseAndUnknownOnRoundtrip() throws {
        for value in [true as Any, false as Any, NSNull()] {
            var object = try fixtureObject("gemini-text")
            var observations = object["observations"] as! [String: Any]
            for field in ["credentials_requested", "verification_code_requested", "account_threat_indicated"] {
                observations[field] = value
            }
            object["observations"] = observations
            let response = try decode(object)
            let roundtrip = try JSONDecoder().decode(CheckResponse.self, from: JSONEncoder().encode(response))
            let expected = value as? Bool
            for decoded in [response, roundtrip] {
                XCTAssertEqual(decoded.observations?.credentialsRequested, expected)
                XCTAssertEqual(decoded.observations?.verificationCodeRequested, expected)
                XCTAssertEqual(decoded.observations?.accountThreatIndicated, expected)
                XCTAssertEqual(decoded.observations?.evidenceSource, .gemini)
                XCTAssertEqual(decoded.observations?.verificationLevel, .unverifiedInference)
                XCTAssertFalse(decoded.assessment.verifiedFraud)
                XCTAssertFalse(decoded.assessment.knownThreat)
                XCTAssertFalse(decoded.reportCreated)
                XCTAssertEqual(decoded.assessment.relatedReportCount, 0)
            }
            let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(response)) as? [String: Any])
            let encodedObservations = try XCTUnwrap(encoded["observations"] as? [String: Any])
            if let expected {
                XCTAssertEqual(encodedObservations["credentials_requested"] as? Bool, expected)
                XCTAssertEqual(encodedObservations["verification_code_requested"] as? Bool, expected)
                XCTAssertEqual(encodedObservations["account_threat_indicated"] as? Bool, expected)
            }
            XCTAssertNil(encodedObservations["credentialsRequested"])
            XCTAssertNil(encodedObservations["verificationCodeRequested"])
            XCTAssertNil(encodedObservations["accountThreatIndicated"])
        }
    }

    func testNewObservationFlagsRejectNonBooleanClaims() throws {
        for field in ["credentials_requested", "verification_code_requested", "account_threat_indicated"] {
            for value in ["true" as Any, 1, ["value": true]] {
                var object = try fixtureObject("gemini-text")
                var observations = object["observations"] as! [String: Any]
                observations[field] = value
                object["observations"] = observations
                XCTAssertThrowsError(try decode(object), field)
            }
        }
    }

    func testRejectsReportedOrVerifiedClaimsAndInventedSafeVerdict() throws {
        let original = try fixtureObject("backend-fixture")
        var object = original
        object["report_created"] = true
        XCTAssertThrowsError(try decode(object))
        for (field, value) in [("verified_fraud", true as Any), ("known_threat", true),
                               ("related_report_count", -1), ("category", "safe"),
                               ("category", "known_malicious_evidence")] {
            object = original
            var assessment = object["assessment"] as! [String: Any]
            assessment[field] = value
            object["assessment"] = assessment
            XCTAssertThrowsError(try decode(object), field)
        }
    }

    func testRejectsUnsanitizedDestinations() throws {
        for value in ["https://tickets.example/private?token=secret", "https://user:secret@tickets.example",
                      "https://tickets.example#secret", "file:///tmp/private", "https://tickets.example/"] {
            var object = try fixtureObject("gemini-text")
            var observations = object["observations"] as! [String: Any]
            observations["destinations"] = [value]
            object["observations"] = observations
            XCTAssertThrowsError(try decode(object))
        }
    }

    func testSingleSharedItemSelectionAndRepresentationPriority() throws {
        XCTAssertEqual(SharedItemSelection.preferredKind(supportsImage: true, supportsURL: true, supportsPlainText: true), .image)
        XCTAssertEqual(SharedItemSelection.preferredKind(supportsImage: false, supportsURL: true, supportsPlainText: true), .url)
        XCTAssertEqual(SharedItemSelection.preferredKind(supportsImage: false, supportsURL: false, supportsPlainText: true), .text)
        XCTAssertNil(SharedItemSelection.preferredKind(supportsImage: false, supportsURL: false, supportsPlainText: false))
        XCTAssertEqual(try SharedItemSelection.requireSingle([nil, .url, nil]), 1)
        XCTAssertThrowsError(try SharedItemSelection.requireSingle([nil])) { error in
            XCTAssertEqual(error as? SharedItemSelectionError, .unsupported)
        }
        XCTAssertThrowsError(try SharedItemSelection.requireSingle([.image, .text])) { error in
            XCTAssertEqual(error as? SharedItemSelectionError, .multiple)
        }
    }

    private func decode(_ object: [String: Any]) throws -> CheckResponse {
        try JSONDecoder().decode(CheckResponse.self, from: JSONSerialization.data(withJSONObject: object))
    }
}

func fixture(_ name: String = "backend-fixture") throws -> Data {
    let url = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
    return try Data(contentsOf: url)
}
func fixtureObject(_ name: String) throws -> [String: Any] {
    try XCTUnwrap(JSONSerialization.jsonObject(with: fixture(name)) as? [String: Any])
}
