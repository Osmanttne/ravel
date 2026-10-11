import RavelCore
import SwiftUI

@MainActor
struct ShareCheckView: View {
    @ObservedObject var model: ShareCheckModel
    let onCancel: () -> Void
    let onDone: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                if let response = model.response, model.phase == .result {
                    RavelResultView(response: response, isURLOnly: isURLOnly)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 20) {
                            Text("Check this shared item")
                                .font(.title2.bold())
                                .accessibilityAddTraits(.isHeader)
                            contentBody
                        }
                        .padding()
                    }
                }
            }
            .navigationTitle("Ravel")
            .navigationBarTitleDisplayMode(.inline)
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

    @ViewBuilder private var contentBody: some View {
        switch model.phase {
        case .loadingItem:
            ProgressView("Preparing the selected item…")
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("Nothing is sent until you choose Analyze privately.")
                .foregroundStyle(.secondary)
            if model.showsSlowFallback { manualFallback }
        case .preview, .analyzing, .checkFailed:
            selectedPreview
            privacyNotice
            if let message = model.message { notice(message, symbol: "exclamationmark.circle") }
            if let configurationMessage = model.configurationMessage {
                notice(configurationMessage, symbol: "network.slash")
                manualFallback
            } else if model.phase == .analyzing {
                ProgressView("Analyzing privately…")
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button("Cancel check", action: model.cancelAnalysis)
                    .buttonStyle(.bordered)
                if model.showsSlowFallback { manualFallback }
            } else {
                Button(model.phase == .checkFailed ? "Try again privately" : "Analyze privately",
                       action: model.analyze)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(!model.canAnalyze)
                    .frame(maxWidth: .infinity)
                if model.phase == .checkFailed { manualFallback }
            }
        case .loadFailed:
            notice(model.message ?? "The selected item couldn't be prepared.",
                   symbol: "exclamationmark.circle")
            Button("Try loading again", action: model.retryLoading)
                .buttonStyle(.borderedProminent)
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
            if let preview = model.previewImage {
                Image(uiImage: preview)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .accessibilityLabel("Preview of the selected screenshot")
            }
            Text("Prepared screenshot · \(image.pixelWidth) × \(image.pixelHeight)")
                .font(.caption)
                .foregroundStyle(.secondary)
        case .text(let text):
            VStack(alignment: .leading, spacing: 8) {
                Text("Selected message").font(.headline)
                Text(verbatim: text)
                    .font(.body)
                    .lineLimit(8)
                DisclosureGroup("Inspect full selected message") {
                    Text(verbatim: text)
                        .font(.callout)
                        .textSelection(.enabled)
                        .padding(.top, 8)
                }
                Text("\(text.unicodeScalars.count) characters will be sent.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        case .url(let rawURL):
            VStack(alignment: .leading, spacing: 8) {
                Text("Selected link").font(.headline)
                Text(displayOrigin(rawURL))
                    .font(.body)
                DisclosureGroup("Inspect full selected link") {
                    // Local preview only. Use plain text so a suspect URL cannot be opened.
                    Text(verbatim: rawURL)
                        .font(.callout.monospaced())
                        .textSelection(.enabled)
                        .padding(.top, 8)
                }
                Text("The full selected link is sent for validation. Its destination is not opened.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        case nil:
            EmptyView()
        }
    }

    private var privacyNotice: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Private check", systemImage: "hand.raised")
                .font(.headline)
            if case .url = model.content {
                Text("This selected link will be sent to your Ravel backend for parsing. It will not be opened or sent to Gemini for AI analysis.")
                Text("A private check does not create a community report. Parsing a link does not establish its safety.")
            } else {
                Text("This selected item will be sent to your Ravel backend. Messages and screenshots may be sent to Google Gemini for AI analysis.")
                Text("This does not create a community report. The backend processes the item without saving it as a report. AI observations can be wrong.")
                Text("Google's handling depends on the backend's service tier. Use synthetic examples during development.")
                    .font(.caption)
                Link("Google Gemini data terms", destination: URL(string: "https://ai.google.dev/gemini-api/terms")!)
                    .font(.caption)
            }
        }
        .font(.subheadline)
        .padding()
        .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }

    private var manualFallback: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Continue in Ravel").font(.headline)
            Text("Close this sheet, open Ravel yourself, and select the same screenshot or paste the same message or link. This shared item won't be saved or carried over.")
                .font(.subheadline)
            Button("Cancel and close", action: onCancel)
                .buttonStyle(.bordered)
        }
        .padding()
        .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }

    private func notice(_ message: String, symbol: String) -> some View {
        Label(message, systemImage: symbol)
            .font(.subheadline)
            .accessibilityElement(children: .combine)
    }

    private func displayOrigin(_ raw: String) -> String {
        guard let components = URLComponents(string: raw), let scheme = components.scheme,
              let host = components.host else { return "Selected web link" }
        let port = components.port.map { ":\($0)" } ?? ""
        return "\(scheme)://\(host)\(port)"
    }
}
