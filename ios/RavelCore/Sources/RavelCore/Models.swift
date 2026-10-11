import Foundation

public enum CheckMode: String, Codable, Sendable { case fixture, gemini }
public enum AssessmentCategory: String, Codable, Sendable {
    case knownMaliciousEvidence = "known_malicious_evidence"
    case suspiciousVerify = "suspicious_verify"
    case insufficientEvidence = "insufficient_evidence"
    case needsHumanReview = "needs_human_review"

    public var title: String {
        switch self {
        case .knownMaliciousEvidence: return "Known malicious evidence"
        case .suspiciousVerify: return "Suspicious / verify before acting"
        case .insufficientEvidence: return "Insufficient evidence"
        case .needsHumanReview: return "Needs human review"
        }
    }
}
public enum ContentCategory: String, Codable, Sendable {
    case ticketOffer = "ticket_offer", promotion, unknown
}
public enum PaymentReason: String, Codable, Sendable {
    case advanceFee = "advance_fee", transferFee = "transfer_fee"
    case upfrontPayment = "upfront_payment", depositBeforeDelivery = "deposit_before_delivery"
    case genericPayment = "generic_payment"
}
public enum IndicatorEvidenceSource: String, Codable, Sendable {
    case submittedContent = "submitted_content", fixtureProvider = "fixture_provider", gemini
    case optInReports = "opt_in_reports", trustedThreatIntelligence = "trusted_threat_intelligence"
}
public enum IndicatorVerificationLevel: String, Codable, Sendable {
    case observedClaim = "observed_claim", unverifiedInference = "unverified_inference"
    case unreviewedReports = "unreviewed_reports", independentlyVerified = "independently_verified"
}
public enum ObservationEvidenceSource: String, Codable, Sendable {
    case fixtureProvider = "fixture_provider", gemini, notAnalyzed = "not_analyzed"
}
public enum ObservationVerificationLevel: String, Codable, Sendable {
    case unverifiedInference = "unverified_inference", notAssessed = "not_assessed"
}
public enum UncertaintyCode: String, Codable, Sendable {
    case identityUnverified = "identity_unverified", ticketOwnershipUnverified = "ticket_ownership_unverified"
    case contentUnclear = "content_unclear", incompleteContent = "incomplete_content"
    case conflictingEvidence = "conflicting_evidence", externalVerificationNeeded = "external_verification_needed"
}
public enum VisualSignal: String, Codable, CaseIterable, Hashable, Sendable {
    case paymentRequested = "payment_requested"
    case urgencyIndicated = "urgency_indicated"
    case credentialsRequested = "credentials_requested"
    case verificationCodeRequested = "verification_code_requested"
    case accountThreatIndicated = "account_threat_indicated"

    public var title: String {
        switch self {
        case .paymentRequested: return "Payment request"
        case .urgencyIndicated: return "Urgency"
        case .credentialsRequested: return "Password or login details"
        case .verificationCodeRequested: return "Verification code request"
        case .accountThreatIndicated: return "Account threat"
        }
    }
}

public struct VisualRegion: Codable, Sendable {
    public let field: VisualSignal
    public let box2D: [Int]
    enum CodingKeys: String, CodingKey { case field; case box2D = "box_2d" }
}

public enum SignalReviewChoice: String, Codable, Hashable, Sendable {
    case confirm, notPresent = "not_present", unclear
}

public struct SignalReviewDecision: Codable, Sendable {
    public let field: VisualSignal
    public let choice: SignalReviewChoice
    public init(field: VisualSignal, choice: SignalReviewChoice) {
        self.field = field
        self.choice = choice
    }
}

public struct SignalReassessmentRequest: Codable, Sendable {
    public let inputKind: String
    public let observations: PublicObservations
    public let decisions: [SignalReviewDecision]
    public init(inputKind: String, observations: PublicObservations,
                decisions: [SignalReviewDecision]) {
        self.inputKind = inputKind
        self.observations = observations
        self.decisions = decisions
    }
    enum CodingKeys: String, CodingKey {
        case observations, decisions
        case inputKind = "input_kind"
    }
}

public struct Indicator: Codable, Sendable {
    public let code: String
    public let description: String
    public let evidenceSource: IndicatorEvidenceSource
    public let verificationLevel: IndicatorVerificationLevel
    public init(code: String, description: String, evidenceSource: IndicatorEvidenceSource,
                verificationLevel: IndicatorVerificationLevel) {
        self.code = code; self.description = description
        self.evidenceSource = evidenceSource; self.verificationLevel = verificationLevel
    }
    enum CodingKeys: String, CodingKey {
        case code, description
        case evidenceSource = "evidence_source", verificationLevel = "verification_level"
    }
}

public struct Assessment: Codable, Sendable {
    public let category: AssessmentCategory
    public let summary: String
    public let verifiedFraud: Bool
    public let indicators: [Indicator]
    public let recommendedAction: String
    public let relatedReportCount: Int
    public let knownThreat: Bool

    public init(category: AssessmentCategory, summary: String, verifiedFraud: Bool = false,
                indicators: [Indicator] = [], recommendedAction: String,
                relatedReportCount: Int = 0, knownThreat: Bool = false) throws {
        guard !verifiedFraud, !knownThreat, relatedReportCount >= 0,
              category != .knownMaliciousEvidence else { throw CheckError.invalidResponse }
        self.category = category; self.summary = summary; self.verifiedFraud = verifiedFraud
        self.indicators = indicators; self.recommendedAction = recommendedAction
        self.relatedReportCount = relatedReportCount; self.knownThreat = knownThreat
    }
    enum CodingKeys: String, CodingKey {
        case category, summary, indicators
        case verifiedFraud = "verified_fraud", recommendedAction = "recommended_action"
        case relatedReportCount = "related_report_count", knownThreat = "known_threat"
    }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(category: values.decode(AssessmentCategory.self, forKey: .category),
                      summary: values.decode(String.self, forKey: .summary),
                      verifiedFraud: values.decode(Bool.self, forKey: .verifiedFraud),
                      indicators: values.decode([Indicator].self, forKey: .indicators),
                      recommendedAction: values.decode(String.self, forKey: .recommendedAction),
                      relatedReportCount: values.decode(Int.self, forKey: .relatedReportCount),
                      knownThreat: values.decode(Bool.self, forKey: .knownThreat))
    }
}

public struct PublicObservations: Codable, Sendable {
    public let category: ContentCategory
    public let paymentRequested: Bool?
    public let paymentReason: PaymentReason?
    public let secrecyRequested: Bool?
    public let urgencyIndicated: Bool?
    public let credentialsRequested: Bool?
    public let verificationCodeRequested: Bool?
    public let accountThreatIndicated: Bool?
    public let visualRegions: [VisualRegion]
    public let destinations: [String]
    public let evidenceSource: ObservationEvidenceSource
    public let verificationLevel: ObservationVerificationLevel
    public let uncertaintyCodes: [UncertaintyCode]
    enum CodingKeys: String, CodingKey {
        case category, destinations
        case paymentRequested = "payment_requested", paymentReason = "payment_reason"
        case secrecyRequested = "secrecy_requested", urgencyIndicated = "urgency_indicated"
        case credentialsRequested = "credentials_requested"
        case verificationCodeRequested = "verification_code_requested"
        case accountThreatIndicated = "account_threat_indicated"
        case visualRegions = "visual_regions"
        case evidenceSource = "evidence_source", verificationLevel = "verification_level"
        case uncertaintyCodes = "uncertainty_codes"
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        category = try values.decodeIfPresent(ContentCategory.self, forKey: .category) ?? .unknown
        paymentRequested = try values.decodeIfPresent(Bool.self, forKey: .paymentRequested)
        paymentReason = try values.decodeIfPresent(PaymentReason.self, forKey: .paymentReason)
        secrecyRequested = try values.decodeIfPresent(Bool.self, forKey: .secrecyRequested)
        urgencyIndicated = try values.decodeIfPresent(Bool.self, forKey: .urgencyIndicated)
        credentialsRequested = try values.decodeIfPresent(Bool.self, forKey: .credentialsRequested)
        verificationCodeRequested = try values.decodeIfPresent(Bool.self, forKey: .verificationCodeRequested)
        accountThreatIndicated = try values.decodeIfPresent(Bool.self, forKey: .accountThreatIndicated)
        visualRegions = try values.decodeIfPresent([VisualRegion].self, forKey: .visualRegions) ?? []
        destinations = try values.decodeIfPresent([String].self, forKey: .destinations) ?? []
        evidenceSource = try values.decodeIfPresent(ObservationEvidenceSource.self, forKey: .evidenceSource) ?? .notAnalyzed
        verificationLevel = try values.decodeIfPresent(ObservationVerificationLevel.self, forKey: .verificationLevel) ?? .notAssessed
        uncertaintyCodes = try values.decodeIfPresent([UncertaintyCode].self, forKey: .uncertaintyCodes) ?? []
    }
}

public struct CheckResponse: Codable, Sendable {
    public let checkID: String
    public let mode: CheckMode
    public let assessment: Assessment
    public let observations: PublicObservations?
    public let reportCreated: Bool
    public let limitations: [String]

    public init(checkID: String, mode: CheckMode, assessment: Assessment,
                observations: PublicObservations? = nil, reportCreated: Bool = false,
                limitations: [String] = []) throws {
        guard !checkID.isEmpty, !reportCreated else { throw CheckError.invalidResponse }
        if let observations {
            guard observations.destinations.count <= 20, observations.uncertaintyCodes.count <= 6,
                  observations.visualRegions.count <= 12,
                  observations.destinations.allSatisfy(Self.isOrigin),
                  observations.visualRegions.allSatisfy({ region in
                      guard region.box2D.count == 4,
                            region.box2D.allSatisfy({ (0...1000).contains($0) }),
                            let top = region.box2D.first,
                            let left = region.box2D.dropFirst().first,
                            let bottom = region.box2D.dropFirst(2).first,
                            let right = region.box2D.last,
                            top < bottom, left < right else { return false }
                      return Self.isPositive(region.field, observations: observations)
                  }) else {
                throw CheckError.invalidResponse
            }
        }
        self.checkID = checkID; self.mode = mode; self.assessment = assessment
        self.observations = observations; self.reportCreated = reportCreated; self.limitations = limitations
    }
    enum CodingKeys: String, CodingKey {
        case mode, assessment, observations, limitations
        case checkID = "check_id", reportCreated = "report_created"
    }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(checkID: values.decode(String.self, forKey: .checkID),
                      mode: values.decode(CheckMode.self, forKey: .mode),
                      assessment: values.decode(Assessment.self, forKey: .assessment),
                      observations: values.decodeIfPresent(PublicObservations.self, forKey: .observations),
                      reportCreated: values.decode(Bool.self, forKey: .reportCreated),
                      limitations: values.decode([String].self, forKey: .limitations))
    }
    private static func isOrigin(_ value: String) -> Bool {
        guard value.unicodeScalars.count <= 2048,
              let url = URLComponents(string: value), let host = url.host, !host.isEmpty,
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty else { return false }
        return true
    }
    private static func isPositive(_ field: VisualSignal, observations: PublicObservations) -> Bool {
        switch field {
        case .paymentRequested: return observations.paymentRequested == true
        case .urgencyIndicated: return observations.urgencyIndicated == true
        case .credentialsRequested: return observations.credentialsRequested == true
        case .verificationCodeRequested: return observations.verificationCodeRequested == true
        case .accountThreatIndicated: return observations.accountThreatIndicated == true
        }
    }
}
