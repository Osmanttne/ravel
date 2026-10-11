import RavelCore
import SwiftUI

/// Shared by the containing app and Share Extension; no reporting or external-link actions.
public struct RavelResultView: View {
    public let response: CheckResponse
    public let isURLOnly: Bool

    /// Submission context supplies URL provenance when fixture observations are absent.
    public init(response: CheckResponse, isURLOnly: Bool = false) {
        self.response = response
        self.isURLOnly = isURLOnly
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Label(modeTitle, systemImage: response.mode == .fixture ? "flask" : "sparkles")
                    .font(.subheadline.weight(.semibold))
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityLabel(modeTitle)

                VStack(alignment: .leading, spacing: 10) {
                    Text(categoryTitle)
                        .font(.title2.bold())
                        .accessibilityAddTraits(.isHeader)
                    Text(response.assessment.summary)
                    Text("Verify before sending money or sensitive information.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                if isLocallyParsedURL {
                    Label("Link parsed only. Its destination wasn't visited or analyzed by AI.",
                          systemImage: "link")
                        .font(.callout)
                }

                DisclosureGroup("Why this result?") {
                    VStack(alignment: .leading, spacing: 16) {
                        if response.assessment.indicators.isEmpty {
                            Text("No sufficiently supported tactic indicators were found. Missing evidence does not establish safety.")
                        }
                        ForEach(Array(response.assessment.indicators.enumerated()), id: \.offset) { _, indicator in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(indicator.description)
                                Text("Source: \(sourceTitle(indicator.evidenceSource.rawValue))")
                                    .font(.caption)
                                Text("Evidence: \(verificationTitle(indicator.verificationLevel.rawValue))")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .accessibilityElement(children: .combine)
                        }
                        if let observations = response.observations,
                           observations.evidenceSource.rawValue == "gemini" {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("AI observations · unverified")
                                    .font(.headline)
                                Text("Payment request: \(claimTitle(observations.paymentRequested))")
                                Text("Urgency: \(claimTitle(observations.urgencyIndicated))")
                                Text("Secrecy request: \(claimTitle(observations.secrecyRequested))")
                                Text("Password or login credential request: \(claimTitle(observations.credentialsRequested))")
                                Text("Verification-code request: \(claimTitle(observations.verificationCodeRequested))")
                                Text("Account threat: \(claimTitle(observations.accountThreatIndicated))")
                                ForEach(Array(observations.uncertaintyCodes.enumerated()), id: \.offset) { _, code in
                                    Text(uncertaintyTitle(code.rawValue))
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .font(.callout)
                        }
                        if let observations = response.observations,
                           !observations.destinations.isEmpty {
                            Text("Visible destinations")
                                .font(.headline)
                            ForEach(Array(observations.destinations.enumerated()), id: \.offset) { _, destination in
                                // Plain text only: suspect destinations are never opened by the UI.
                                Text(destination)
                                    .font(.callout.monospaced())
                                    .textSelection(.enabled)
                            }
                        }
                        Text("Community report lookup is not available yet.")
                            .font(.callout)
                    }
                    .padding(.top, 12)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Next step")
                        .font(.headline)
                        .accessibilityAddTraits(.isHeader)
                    Text(response.assessment.recommendedAction)
                }

                DisclosureGroup("Limits of this check") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(response.limitations.enumerated()), id: \.offset) { _, limitation in
                            Text(limitation)
                        }
                    }
                    .font(.callout)
                    .padding(.top, 12)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Label("Checked privately", systemImage: "lock")
                        .font(.headline)
                    Text("This check didn't create a community report.")
                    Text("Community reporting isn't available yet.")
                        .foregroundStyle(.secondary)
                }
                .font(.callout)
                .accessibilityElement(children: .combine)
            }
            .padding()
        }
    }

    private var categoryTitle: String {
        switch response.assessment.category {
        case .knownMaliciousEvidence: return "Known malicious evidence"
        case .suspiciousVerify: return "Suspicious — verify before acting"
        case .insufficientEvidence: return "Insufficient evidence"
        case .needsHumanReview: return "Needs human review"
        }
    }

    private var modeTitle: String {
        if response.mode == .fixture { return "Fixture demo · simulated analysis" }
        if isLocallyParsedURL {
            return "Gemini mode · this link wasn't analyzed by AI"
        }
        return "Gemini mode · AI observations are unverified"
    }

    private var isLocallyParsedURL: Bool {
        isURLOnly || response.observations?.evidenceSource == .notAnalyzed
    }

    private func sourceTitle(_ value: String) -> String {
        switch value {
        case "submitted_content": return "Submitted content"
        case "fixture_provider": return "Synthetic fixture provider"
        case "gemini": return "Gemini AI extraction"
        case "opt_in_reports": return "Opt-in community reports"
        case "trusted_threat_intelligence": return "Trusted threat intelligence"
        default: return "Unknown source"
        }
    }

    private func verificationTitle(_ value: String) -> String {
        switch value {
        case "observed_claim": return "Observed claim; legitimacy isn't established"
        case "unverified_inference": return "Unverified inference"
        case "unreviewed_reports": return "Unreviewed reports"
        case "independently_verified": return "Independently verified evidence"
        default: return "Not assessed"
        }
    }

    private func claimTitle(_ value: Bool?) -> String {
        switch value {
        case .some(true): return "Affirmative claim extracted"
        case .some(false): return "Explicit negative claim extracted"
        case .none: return "Unknown"
        }
    }

    private func uncertaintyTitle(_ value: String) -> String {
        switch value {
        case "identity_unverified": return "The claimed identity isn't independently verified."
        case "ticket_ownership_unverified": return "Ticket ownership isn't independently verified."
        case "content_unclear": return "Some content couldn't be read clearly."
        case "incomplete_content": return "The submitted content may be incomplete."
        case "conflicting_evidence": return "The extracted observations conflict."
        case "external_verification_needed": return "Independent verification is still needed."
        default: return "Some observations remain uncertain."
        }
    }
}
