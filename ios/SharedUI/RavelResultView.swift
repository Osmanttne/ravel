import RavelCore
import SwiftUI

public struct RavelResultView: View {
    public let response: CheckResponse
    public let isURLOnly: Bool

    @Environment(\.colorScheme) private var colorScheme

    private var palette: RavelPalette { RavelPalette(colorScheme) }

    public init(response: CheckResponse, isURLOnly: Bool = false) {
        self.response = response
        self.isURLOnly = isURLOnly
    }

    public var body: some View {
        ZStack {
            RavelBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    modeBadge
                    assessmentCard
                    if isLocallyParsedURL {
                        localURLNotice
                    }
                    nextStepCard
                    explanationCard
                    limitsCard
                    privacyCard
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 30)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private var modeBadge: some View {
        HStack(spacing: 9) {
            Image(systemName: response.mode == .fixture ? "flask.fill" : "sparkles")
                .foregroundStyle(response.mode == .fixture ? palette.review : palette.information)
            Text(modeTitle)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(palette.primaryText)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.bottom, 18)
        .accessibilityLabel(modeTitle)
    }

    private var assessmentCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 9) {
                    RavelEyebrow(title: "ASSESSMENT", palette: palette)
                    Text(categoryTitle)
                        .font(.system(.title2, design: .rounded, weight: .bold))
                        .foregroundStyle(palette.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                }
                Spacer(minLength: 0)
                Image(systemName: statusSymbol)
                    .font(.system(size: 25, weight: .medium))
                    .foregroundStyle(statusColor)
                    .padding(.top, 2)
            }
            Rectangle()
                .fill(palette.border)
                .frame(height: 1)
            Text(response.assessment.summary)
                .font(.body)
                .foregroundStyle(palette.primaryText)
                .fixedSize(horizontal: false, vertical: true)
            Label("Verify before sending money or sensitive information.",
                  systemImage: "arrow.up.right.circle")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(palette.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 18)
        .overlay(alignment: .topLeading) {
            Rectangle().fill(statusColor).frame(width: 32, height: 2)
        }
    }

    private var localURLNotice: some View {
        Label("Link parsed only. Its destination wasn't visited or analyzed by AI.",
              systemImage: "link")
            .font(.subheadline.weight(.medium))
            .foregroundStyle(palette.information)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, 16)
            .overlay(alignment: .top) { resultDivider }
    }

    private var nextStepCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "arrow.turn.down.right")
                    .foregroundStyle(palette.accent)
                RavelEyebrow(title: "A PRACTICAL NEXT STEP", palette: palette)
            }
            Text(response.assessment.recommendedAction)
                .font(.body.weight(.medium))
                .foregroundStyle(palette.primaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 17)
        .overlay(alignment: .top) { resultDivider }
    }

    private var explanationCard: some View {
        VStack(spacing: 0) {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 16) {
                    if response.assessment.indicators.isEmpty {
                        Text("No sufficiently supported tactic indicators were found. Missing evidence does not establish safety.")
                            .foregroundStyle(palette.secondaryText)
                    }
                    ForEach(Array(response.assessment.indicators.enumerated()), id: \.offset) { _, indicator in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(indicator.description)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(palette.primaryText)
                            Text("Source: \(sourceTitle(indicator.evidenceSource.rawValue))")
                                .font(.caption)
                                .foregroundStyle(palette.secondaryText)
                            Text("Evidence: \(verificationTitle(indicator.verificationLevel.rawValue))")
                                .font(.caption)
                                .foregroundStyle(palette.secondaryText)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    if let observations = response.observations,
                       observations.evidenceSource.rawValue == "gemini" {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("AI observations · unverified")
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(palette.information)
                            Text("Payment request: \(claimTitle(observations.paymentRequested))")
                            Text("Urgency: \(claimTitle(observations.urgencyIndicated))")
                            Text("Secrecy request: \(claimTitle(observations.secrecyRequested))")
                            Text("Password or login credential request: \(claimTitle(observations.credentialsRequested))")
                            Text("Verification-code request: \(claimTitle(observations.verificationCodeRequested))")
                            Text("Account threat: \(claimTitle(observations.accountThreatIndicated))")
                            ForEach(Array(observations.uncertaintyCodes.enumerated()), id: \.offset) { _, code in
                                Text(uncertaintyTitle(code.rawValue))
                                    .foregroundStyle(palette.secondaryText)
                            }
                        }
                        .font(.callout)
                        .foregroundStyle(palette.primaryText)
                    }
                    if let observations = response.observations,
                       !observations.destinations.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Visible destinations")
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(palette.primaryText)
                            ForEach(Array(observations.destinations.enumerated()), id: \.offset) { _, destination in
                                Text(destination)
                                    .font(.callout.monospaced())
                                    .foregroundStyle(palette.information)
                                    .textSelection(.enabled)
                            }
                        }
                    }
                    Text("Community report lookup is not available yet.")
                        .font(.caption)
                        .foregroundStyle(palette.secondaryText)
                }
                .padding(.top, 14)
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "waveform.path.ecg.rectangle")
                        .foregroundStyle(palette.brandTeal)
                    Text("Why this result?")
                        .font(.headline)
                        .foregroundStyle(palette.primaryText)
                }
            }
            .tint(palette.accent)
        }
        .padding(.vertical, 15)
        .overlay(alignment: .top) { resultDivider }
    }

    private var limitsCard: some View {
        VStack(spacing: 0) {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(response.limitations.enumerated()), id: \.offset) { _, limitation in
                        Text(limitation)
                            .font(.callout)
                            .foregroundStyle(palette.secondaryText)
                    }
                }
                .padding(.top, 12)
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "info.circle")
                        .foregroundStyle(palette.brandViolet)
                    Text("Limits of this check")
                        .font(.headline)
                        .foregroundStyle(palette.primaryText)
                }
            }
            .tint(palette.accent)
        }
        .padding(.vertical, 15)
        .overlay(alignment: .top) { resultDivider }
    }

    private var privacyCard: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(palette.accent)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 6) {
                Text("Checked privately")
                    .font(.headline)
                    .foregroundStyle(palette.primaryText)
                Text("This check didn't create a community report.")
                    .font(.subheadline)
                    .foregroundStyle(palette.primaryText)
                Text("Community reporting isn't available yet.")
                    .font(.caption)
                    .foregroundStyle(palette.secondaryText)
            }
        }
        .padding(.vertical, 16)
        .overlay(alignment: .top) { resultDivider }
        .accessibilityElement(children: .combine)
    }

    private var resultDivider: some View {
        Rectangle().fill(palette.border).frame(height: 1)
    }

    private var categoryTitle: String {
        switch response.assessment.category {
        case .knownMaliciousEvidence: return "Known malicious evidence"
        case .suspiciousVerify: return "Suspicious: verify before acting"
        case .insufficientEvidence: return "Insufficient evidence"
        case .needsHumanReview: return "Needs human review"
        }
    }

    private var statusSymbol: String {
        switch response.assessment.category {
        case .knownMaliciousEvidence: return "xmark.shield.fill"
        case .suspiciousVerify: return "exclamationmark.shield.fill"
        case .insufficientEvidence: return "questionmark.circle"
        case .needsHumanReview: return "person.crop.circle.badge.questionmark"
        }
    }

    private var statusColor: Color {
        switch response.assessment.category {
        case .knownMaliciousEvidence: return palette.danger
        case .suspiciousVerify: return palette.caution
        case .insufficientEvidence: return palette.information
        case .needsHumanReview: return palette.review
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
