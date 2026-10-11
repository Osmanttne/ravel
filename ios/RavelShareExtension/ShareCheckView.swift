import RavelCore
import SwiftUI

@MainActor
struct ShareCheckView: View {
    @ObservedObject var model: ShareCheckModel
    let onCancel: () -> Void
    let onDone: () -> Void
    @Environment(\.colorScheme) private var colorScheme

    private var palette: RavelPalette { RavelPalette(colorScheme) }

    var body: some View {
        NavigationStack {
            ZStack {
                RavelBackground()
                Group {
                    if let response = model.response, model.phase == .result {
                        RavelResultView(
                            response: response,
                            isURLOnly: isURLOnly,
                            imageData: resultImageData,
                            reviewInputKind: reviewInputKind,
                            onReview: { decisions in try await model.reassess(decisions) }
                        )
                    } else {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 0) {
                                RavelBrandMark(palette: palette)
                                VStack(alignment: .leading, spacing: 7) {
                                    RavelEyebrow(title: "SHARED ITEM", palette: palette)
                                    Text("Review before checking")
                                        .font(.system(.title, design: .rounded, weight: .bold))
                                        .foregroundStyle(palette.primaryText)
                                        .accessibilityAddTraits(.isHeader)
                                    Text("Only the item you selected is included. Nothing is sent until you choose to analyze privately.")
                                        .font(.subheadline)
                                        .foregroundStyle(palette.secondaryText)
                                }
                                .padding(.top, 22)
                                contentBody
                                    .padding(.top, 18)
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 16)
                            .frame(maxWidth: 620)
                            .frame(maxWidth: .infinity)
                        }
                        .scrollDismissesKeyboard(.interactively)
                    }
                }
            }
            .navigationTitle("Ravel")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar {
                if model.phase == .result {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done", action: onDone)
                    }
                } else {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel", action: onCancel)
                    }
                }
            }
        }
    }

    private var isURLOnly: Bool {
        if case .url = model.content { return true }
        return false
    }

    private var resultImageData: Data? {
        guard let content = model.content else { return nil }
        if case .image(let image) = content { return image.data }
        return nil
    }

    private var reviewInputKind: String? {
        guard let content = model.content else { return nil }
        switch content {
        case .image: return "image"
        case .text: return "text"
        case .url: return nil
        }
    }

    @ViewBuilder private var contentBody: some View {
        switch model.phase {
        case .loadingItem:
            VStack(alignment: .leading, spacing: 9) {
                sectionRule
                ProgressView("Preparing the selected item…")
                    .tint(palette.accent)
                Text("Nothing is sent until you choose Analyze privately.")
                    .font(.caption)
                    .foregroundStyle(palette.secondaryText)
            }
            if model.showsSlowFallback { manualFallback }
        case .preview, .analyzing, .checkFailed:
            selectedPreview
            privacyNotice
            if let message = model.message { notice(message, symbol: "exclamationmark.circle") }
            if let configurationMessage = model.configurationMessage {
                notice(configurationMessage, symbol: "network.slash")
                manualFallback
            } else if model.phase == .analyzing {
                sectionRule
                HStack(spacing: 10) {
                    ProgressView().tint(palette.accent)
                    Text("Analyzing privately…")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(palette.primaryText)
                }
                Button("Cancel check", action: model.cancelAnalysis)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(palette.secondaryText)
                if model.showsSlowFallback { manualFallback }
            } else {
                primaryAction(title: model.phase == .checkFailed ? "Try again privately" : "Analyze privately",
                              action: model.analyze)
                    .disabled(!model.canAnalyze)
                if model.phase == .checkFailed { manualFallback }
            }
        case .loadFailed:
            notice(model.message ?? "The selected item couldn't be prepared.",
                   symbol: "exclamationmark.circle")
            primaryAction(title: "Try loading again", action: model.retryLoading)
            manualFallback
        case .unavailable:
            notice(model.message ?? "This shared item isn't supported.", symbol: "square.and.arrow.up")
            manualFallback
            Button("Close", action: onDone).buttonStyle(.bordered)
        case .result:
            EmptyView()
        }
    }

    @ViewBuilder private var selectedPreview: some View {
        switch model.content {
        case .image(let image):
            VStack(alignment: .leading, spacing: 12) {
                sectionRule
                Label("Selected screenshot", systemImage: "photo")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(palette.primaryText)
                if let preview = model.previewImage {
                    Image(uiImage: preview)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity, maxHeight: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .accessibilityLabel("Preview of the selected screenshot")
                }
                Text("Prepared screenshot · \(image.pixelWidth) × \(image.pixelHeight)")
                    .font(.caption)
                    .foregroundStyle(palette.secondaryText)
            }
        case .text(let text):
            VStack(alignment: .leading, spacing: 9) {
                sectionRule
                Label("Selected message", systemImage: "text.alignleft")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(palette.primaryText)
                Text(verbatim: text)
                    .font(.body)
                    .foregroundStyle(palette.primaryText)
                    .lineLimit(8)
                DisclosureGroup("Inspect full selected message") {
                    Text(verbatim: text)
                        .font(.callout)
                        .foregroundStyle(palette.secondaryText)
                        .textSelection(.enabled)
                        .padding(.top, 8)
                }
                .tint(palette.accent)
                Text("\(text.unicodeScalars.count) characters will be sent.")
                    .font(.caption)
                    .foregroundStyle(palette.secondaryText)
            }
        case .url(let rawURL):
            VStack(alignment: .leading, spacing: 9) {
                sectionRule
                Label("Selected link", systemImage: "link")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(palette.primaryText)
                Text(displayOrigin(rawURL))
                    .font(.body.monospaced())
                    .foregroundStyle(palette.primaryText)
                DisclosureGroup("Inspect full selected link") {
                    Text(verbatim: rawURL)
                        .font(.callout.monospaced())
                        .foregroundStyle(palette.information)
                        .textSelection(.enabled)
                        .padding(.top, 8)
                }
                .tint(palette.accent)
                Text("The full selected link is sent for validation. Its destination is not opened.")
                    .font(.caption)
                    .foregroundStyle(palette.secondaryText)
            }
        case nil:
            EmptyView()
        }
    }

    private var privacyNotice: some View {
        VStack(alignment: .leading, spacing: 9) {
            sectionRule
            Label("Private check", systemImage: "lock.shield.fill")
                .font(.headline)
                .foregroundStyle(palette.accent)
            if case .url = model.content {
                Text("This selected link will be sent to your Ravel backend for parsing. It will not be opened or sent to Gemini for AI analysis.")
                Text("A private check does not create a community report. Parsing a link does not establish its safety.")
            } else {
                Text("This selected item will be sent to your Ravel backend. Messages and screenshots may be sent to Google Gemini for AI analysis.")
                Text("This does not create a community report. The backend processes the item without saving it as a report. AI observations can be wrong.")
                Text("Google's handling depends on the backend's service tier. Use synthetic examples during development.")
                    .font(.caption)
                Link("Google Gemini data terms", destination: URL(string: "https://ai.google.dev/gemini-api/terms")!)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(palette.accent)
            }
        }
        .foregroundStyle(palette.primaryText)
        .font(.subheadline)
    }

    private var manualFallback: some View {
        VStack(alignment: .leading, spacing: 9) {
            sectionRule
            Label("Continue in Ravel", systemImage: "arrowshape.turn.up.right")
                .font(.headline)
                .foregroundStyle(palette.primaryText)
            Text("Close this sheet, open Ravel yourself, and select the same screenshot or paste the same message or link. This shared item won't be saved or carried over.")
                .font(.subheadline)
                .foregroundStyle(palette.secondaryText)
            Button("Cancel and close", action: onCancel)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(palette.accent)
        }
    }

    private func notice(_ message: String, symbol: String) -> some View {
        Label(message, systemImage: symbol)
            .font(.subheadline)
            .foregroundStyle(palette.caution)
            .accessibilityElement(children: .combine)
            .padding(.vertical, 12)
            .overlay(alignment: .top) { sectionRule }
    }

    private var sectionRule: some View {
        Rectangle().fill(palette.border).frame(height: 1)
    }

    private func primaryAction(title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: "lock.fill")
                Text(title).font(.headline)
                Spacer()
                Image(systemName: "arrow.right")
                    .font(.subheadline.weight(.bold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .background(
                LinearGradient(colors: [palette.brandBlue, palette.brandTeal],
                               startPoint: .leading, endPoint: .trailing),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
    }

    private func displayOrigin(_ raw: String) -> String {
        guard let components = URLComponents(string: raw), let scheme = components.scheme,
              let host = components.host else { return "Selected web link" }
        let port = components.port.map { ":\($0)" } ?? ""
        return "\(scheme)://\(host)\(port)"
    }
}
