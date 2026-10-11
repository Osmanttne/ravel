import RavelCore
import SwiftUI
import UIKit

public struct RavelResultView: View {
    public let response: CheckResponse
    public let isURLOnly: Bool
    public let imageData: Data?
    public let reviewInputKind: String?
    public let onReview: (([SignalReviewDecision]) async throws -> Assessment)?

    @State private var reviewedAssessment: Assessment?
    @State private var reviewSelections: [String: SignalReviewChoice] = [:]
    @State private var isSubmittingReview = false
    @State private var reviewStatus: String?

    @Environment(\.colorScheme) private var colorScheme

    private var palette: RavelPalette { RavelPalette(colorScheme) }

    public init(response: CheckResponse, isURLOnly: Bool = false, imageData: Data? = nil,
                reviewInputKind: String? = nil,
                onReview: (([SignalReviewDecision]) async throws -> Assessment)? = nil) {
        self.response = response
        self.isURLOnly = isURLOnly
        self.imageData = imageData
        self.reviewInputKind = reviewInputKind
        self.onReview = onReview
    }

    public var body: some View {
        ZStack {
            RavelBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    modeBadge
                    assessmentCard
                    evidenceReviewSection
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

    private var assessment: Assessment { reviewedAssessment ?? response.assessment }

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

    @ViewBuilder private var evidenceReviewSection: some View {
        if response.mode == .gemini,
           reviewInputKind != nil,
           let observations = response.observations,
           observations.evidenceSource == .gemini,
           !reviewableSignals.isEmpty,
           let onReview {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    RavelEyebrow(title: "EVIDENCE REVIEW", palette: palette)
                    Text("Check the highlighted signals")
                        .font(.headline)
                        .foregroundStyle(palette.primaryText)
                    Text("Gemini's marks are approximate. Review the original item before changing the assessment.")
                        .font(.subheadline)
                        .foregroundStyle(palette.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let imageData, let image = UIImage(data: imageData), !observations.visualRegions.isEmpty {
                    ImageEvidenceOverlay(image: image, regions: observations.visualRegions)
                        .frame(height: 300)
                } else if reviewInputKind == "image" {
                    Label("No reliable screenshot regions were marked. Review each signal against the image.",
                          systemImage: "viewfinder")
                        .font(.subheadline)
                        .foregroundStyle(palette.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                ForEach(reviewableSignals, id: \.rawValue) { signal in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 8) {
                            Circle().fill(signalColor(signal)).frame(width: 8, height: 8)
                            Text(signal.title)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(palette.primaryText)
                            if reviewInputKind == "image" {
                                let indices = observations.visualRegions.enumerated()
                                    .filter { $0.element.field == signal }
                                    .map { String(format: "%02d", $0.offset + 1) }
                                if !indices.isEmpty {
                                    Text("MARKED \(indices.joined(separator: ", "))")
                                        .font(.caption2.monospaced().weight(.semibold))
                                        .foregroundStyle(signalColor(signal))
                                }
                            }
                        }
                        HStack(spacing: 7) {
                            reviewChoiceButton(.confirm, title: "Present", signal: signal)
                            reviewChoiceButton(.notPresent, title: "Not present", signal: signal)
                            reviewChoiceButton(.unclear, title: "Unsure", signal: signal)
                        }
                    }
                    .padding(.vertical, 10)
                    .overlay(alignment: .bottom) { resultDivider }
                }

                if isSubmittingReview {
                    HStack(spacing: 8) {
                        ProgressView().tint(palette.accent)
                        Text("Updating assessment")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(palette.secondaryText)
                    }
                } else if let reviewStatus {
                    Text(reviewStatus)
                        .font(.caption)
                        .foregroundStyle(palette.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.vertical, 18)
            .overlay(alignment: .top) { resultDivider }
        }
    }

    private var reviewableSignals: [VisualSignal] {
        guard let observations = response.observations else { return [] }
        return VisualSignal.allCases.filter { signal in
            switch signal {
            case .paymentRequested: return observations.paymentRequested == true
            case .urgencyIndicated: return observations.urgencyIndicated == true
            case .credentialsRequested: return observations.credentialsRequested == true
            case .verificationCodeRequested: return observations.verificationCodeRequested == true
            case .accountThreatIndicated: return observations.accountThreatIndicated == true
            }
        }
    }

    private func reviewChoiceButton(_ choice: SignalReviewChoice, title: String,
                                    signal: VisualSignal) -> some View {
        let selected = reviewSelections[signal.rawValue] == choice
        return Button {
            submitReview(choice, for: signal)
        } label: {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(selected ? Color.white : palette.secondaryText)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 9)
                .background(selected ? signalColor(signal) : palette.raisedSurface)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(selected ? signalColor(signal) : palette.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(isSubmittingReview)
        .accessibilityLabel("\(title): \(signal.title)")
    }

    private func submitReview(_ choice: SignalReviewChoice, for signal: VisualSignal) {
        guard !isSubmittingReview, let onReview else { return }
        var proposed = reviewSelections
        proposed[signal.rawValue] = choice
        let decisions = VisualSignal.allCases.compactMap { field in
            proposed[field.rawValue].map { SignalReviewDecision(field: field, choice: $0) }
        }
        isSubmittingReview = true
        reviewStatus = nil
        Task {
            do {
                reviewedAssessment = try await onReview(decisions)
                reviewSelections = proposed
                reviewStatus = "Assessment updated using your review. Gemini's observations are unchanged."
            } catch {
                reviewStatus = (error as? LocalizedError)?.errorDescription
                    ?? "The assessment couldn't be updated. Your original result remains."
            }
            isSubmittingReview = false
        }
    }

    private func signalColor(_ signal: VisualSignal) -> Color {
        switch signal {
        case .paymentRequested: return .orange
        case .urgencyIndicated: return .purple
        case .credentialsRequested: return .blue
        case .verificationCodeRequested: return .teal
        case .accountThreatIndicated: return .green
        }
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
            Text(assessment.summary)
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
            Text(assessment.recommendedAction)
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
                    if assessment.indicators.isEmpty {
                        Text("No sufficiently supported tactic indicators were found. Missing evidence does not establish safety.")
                            .foregroundStyle(palette.secondaryText)
                    }
                    ForEach(Array(assessment.indicators.enumerated()), id: \.offset) { _, indicator in
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
        switch assessment.category {
        case .knownMaliciousEvidence: return "Known malicious evidence"
        case .suspiciousVerify: return "Suspicious: verify before acting"
        case .insufficientEvidence: return "Insufficient evidence"
        case .needsHumanReview: return "Needs human review"
        }
    }

    private var statusSymbol: String {
        switch assessment.category {
        case .knownMaliciousEvidence: return "xmark.shield.fill"
        case .suspiciousVerify: return "exclamationmark.shield.fill"
        case .insufficientEvidence: return "questionmark.circle"
        case .needsHumanReview: return "person.crop.circle.badge.questionmark"
        }
    }

    private var statusColor: Color {
        switch assessment.category {
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

private struct ImageEvidenceOverlay: View {
    let image: UIImage
    let regions: [VisualRegion]

    var body: some View {
        GeometryReader { geometry in
            let size = fittedSize(in: geometry.size)
            let origin = CGPoint(
                x: (geometry.size.width - size.width) / 2,
                y: (geometry.size.height - size.height) / 2
            )
            ZStack(alignment: .topLeading) {
                Image(uiImage: image)
                    .resizable()
                    .frame(width: size.width, height: size.height)
                    .position(x: origin.x + size.width / 2, y: origin.y + size.height / 2)
                    .accessibilityHidden(true)

                ForEach(Array(regions.enumerated()), id: \.offset) { index, region in
                    if let rect = boxRect(region.box2D, origin: origin, size: size) {
                        Rectangle()
                            .stroke(color(for: region.field), lineWidth: 2)
                            .frame(width: rect.width, height: rect.height)
                            .position(x: rect.midX, y: rect.midY)
                        Text(String(format: "%02d", index + 1))
                            .font(.caption2.monospaced().weight(.bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 3)
                            .background(color(for: region.field), in: Capsule())
                            .position(
                                x: min(max(rect.minX + 12, origin.x + 12), origin.x + size.width - 12),
                                y: min(max(rect.minY + 10, origin.y + 10), origin.y + size.height - 10)
                            )
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
            }
            .accessibilityLabel("Selected screenshot with approximate Gemini regions")
        }
    }

    private func fittedSize(in container: CGSize) -> CGSize {
        let scale = min(container.width / image.size.width, container.height / image.size.height)
        return CGSize(width: image.size.width * scale, height: image.size.height * scale)
    }

    private func boxRect(_ box: [Int], origin: CGPoint, size: CGSize) -> CGRect? {
        guard box.count == 4 else { return nil }
        let top = CGFloat(box[0]) / 1000
        let left = CGFloat(box[1]) / 1000
        let bottom = CGFloat(box[2]) / 1000
        let right = CGFloat(box[3]) / 1000
        guard top < bottom, left < right else { return nil }
        return CGRect(
            x: origin.x + left * size.width,
            y: origin.y + top * size.height,
            width: (right - left) * size.width,
            height: (bottom - top) * size.height
        )
    }

    private func color(for signal: VisualSignal) -> Color {
        switch signal {
        case .paymentRequested: return .orange
        case .urgencyIndicated: return .purple
        case .credentialsRequested: return .blue
        case .verificationCodeRequested: return .teal
        case .accountThreatIndicated: return .green
        }
    }
}
