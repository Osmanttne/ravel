import PhotosUI
import RavelCore
import SwiftUI
import UIKit

@MainActor
struct CheckHomeView: View {
    private enum InputFocus: Hashable {
        case message, url
    }

    @StateObject private var model = CheckViewModel()
    @State private var selectedPhoto: PhotosPickerItem?
    @FocusState private var focusedInput: InputFocus?
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme

    private let photonTextNumber = "+16465792852"

    private var palette: RavelPalette { RavelPalette(colorScheme) }
    private var photonMessageURL: URL { URL(string: "sms:\(photonTextNumber)")! }

    var body: some View {
        NavigationStack {
            ZStack {
                RavelBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        topBar
                        heroSection
                        sourcePicker
                        inputPanel
                        serviceState
                        privacyPanel
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 10)
                    .padding(.bottom, 32)
                    .frame(maxWidth: 620)
                    .frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .toolbar(.hidden, for: .navigationBar)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done typing") { dismissInputFocus() }
                }
            }
        }
        .onChange(of: selectedPhoto) { _, selection in
            if let selection {
                dismissInputFocus()
                model.prepare(selection)
                selectedPhoto = nil
            }
        }
        .sheet(isPresented: $model.isShowingResult, onDismiss: {
            dismissInputFocus()
            selectedPhoto = nil
            model.cancelAndClear()
        }) {
            NavigationStack {
                if let response = model.response {
                    RavelResultView(response: response, isURLOnly: model.inputKind == .url)
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) {
                                Button("Done") { model.isShowingResult = false }
                            }
                        }
                }
            }
            .onAppear { dismissInputFocus() }
        }
        .onChange(of: model.isShowingResult) { _, isShowing in
            if isShowing { dismissInputFocus() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background {
                dismissInputFocus()
                selectedPhoto = nil
                model.cancelAndClear()
            }
        }
        .onDisappear {
            if !model.isShowingResult {
                dismissInputFocus()
                selectedPhoto = nil
                model.cancelAndClear()
            }
        }
    }

    private var topBar: some View {
        HStack {
            RavelBrandMark(palette: palette)
            Spacer()
            Button {
                dismissInputFocus()
                selectedPhoto = nil
                model.cancelAndClear()
            } label: {
                Label("Clear", systemImage: "arrow.counterclockwise")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(palette.secondaryText)
                    .padding(.vertical, 8)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Cancels this check and clears selected content from app memory.")
        }
    }

    private var heroSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("A second look.\nOn your terms.")
                .font(.system(size: 36, weight: .bold, design: .rounded))
                .tracking(-0.9)
                .foregroundStyle(palette.primaryText)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)

            Text("Messages, screenshots, and links are checked only when you choose. Nothing is scanned in the background.")
                .font(.subheadline)
                .foregroundStyle(palette.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 10)

            RavelSignalField(palette: palette)
                .frame(height: 112)
                .padding(.top, 8)
        }
    }

    private var sourcePicker: some View {
        let photoAccent = palette.brandBlue
        let photoPrimary = palette.primaryText
        let photoSecondary = palette.secondaryText

        return VStack(alignment: .leading, spacing: 0) {
            Text("Choose what to check")
                .font(.title3.weight(.semibold))
                .foregroundStyle(palette.primaryText)
                .accessibilityAddTraits(.isHeader)
                .padding(.bottom, 5)

            PhotosPicker(selection: $selectedPhoto, matching: .images,
                         preferredItemEncoding: .current) {
                HStack(spacing: 15) {
                    Image(systemName: "viewfinder")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(photoAccent)
                        .frame(width: 28, height: 30)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Screenshot")
                            .font(.system(size: 17, weight: .semibold, design: .rounded))
                            .foregroundStyle(photoPrimary)
                        Text("Choose one image from Photos")
                            .font(.caption)
                            .foregroundStyle(photoSecondary)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(photoAccent.opacity(0.9))
                }
                .padding(.vertical, 13)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(model.isChecking)
            .accessibilityLabel("Check screenshot")
            .accessibilityHint("Choose one screenshot from Photos for a private check.")

            sourceDivider

            Button {
                dismissInputFocus()
                selectedPhoto = nil
                model.choose(.text)
            } label: {
                sourceRow(title: "Message", subtitle: "Paste or type text",
                          symbol: "text.alignleft", color: palette.brandTeal,
                          primary: palette.primaryText, secondary: palette.secondaryText)
            }
            .buttonStyle(.plain)
            .disabled(model.isChecking)
            .accessibilityLabel("Paste message")

            sourceDivider

            Button {
                dismissInputFocus()
                selectedPhoto = nil
                model.choose(.url)
            } label: {
                sourceRow(title: "Link", subtitle: "Parse a URL without opening it",
                          symbol: "point.topleft.down.curvedto.point.bottomright.up", color: palette.brandViolet,
                          primary: palette.primaryText, secondary: palette.secondaryText)
            }
            .buttonStyle(.plain)
            .disabled(model.isChecking)
            .accessibilityLabel("Check link")

            sourceDivider

            Link(destination: photonMessageURL) {
                sourceRow(title: "Use Ravel in Messages", subtitle: "Open a blank chat with the Ravel agent",
                          symbol: "bubble.left.and.bubble.right", color: palette.brandGreen,
                          primary: palette.primaryText, secondary: palette.secondaryText)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Use Ravel in Messages")
            .accessibilityHint("Opens a blank Messages conversation with Ravel. Nothing is sent automatically.")
        }
    }

    private var sourceDivider: some View {
        Rectangle()
            .fill(palette.border)
            .frame(height: 1)
            .padding(.leading, 43)
    }

    private func sourceRow(title: String, subtitle: String, symbol: String, color: Color,
                           primary: Color, secondary: Color) -> some View {
        HStack(spacing: 15) {
            Image(systemName: symbol)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(color)
                .frame(width: 28, height: 30)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 17, weight: .semibold, design: .rounded))
                    .foregroundStyle(primary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(secondary)
            }
            Spacer(minLength: 8)
            Image(systemName: "arrow.up.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(color.opacity(0.9))
        }
        .padding(.vertical, 13)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var inputPanel: some View {
        switch model.inputKind {
        case .image:
            imageInput
        case .text:
            textInput
        case .url:
            urlInput
        }
    }

    private var imageInput: some View {
        VStack(alignment: .leading, spacing: 12) {
            sourceDivider
            HStack {
                RavelEyebrow(title: "SCREENSHOT", palette: palette)
                Spacer()
                Image(systemName: "lock.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(palette.accent)
            }
            if model.isPreparingImage {
                ProgressView("Preparing selected image…")
                    .tint(palette.accent)
            } else if let prepared = model.preparedImage,
                      let image = UIImage(data: prepared.data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 260)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityLabel("Preview of the selected screenshot")
                Text("\(prepared.pixelWidth) × \(prepared.pixelHeight) pixels · prepared for private analysis")
                    .font(.caption)
                    .foregroundStyle(palette.secondaryText)
            } else {
                Label("No screenshot selected", systemImage: "photo")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(palette.secondaryText)
                Text("Choose an image above. Ravel only checks the item you select.")
                    .font(.caption)
                    .foregroundStyle(palette.secondaryText)
            }
        }
    }

    private var textInput: some View {
        VStack(alignment: .leading, spacing: 12) {
            sourceDivider
            RavelEyebrow(title: "MESSAGE TO CHECK", palette: palette)
            ZStack(alignment: .topLeading) {
                if model.text.isEmpty {
                    Text("Paste or type the message here. Nothing is read automatically.")
                        .font(.body)
                        .foregroundStyle(palette.secondaryText.opacity(0.8))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 12)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $model.text)
                    .focused($focusedInput, equals: .message)
                    .font(.body)
                    .foregroundStyle(palette.primaryText)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 135)
                    .disabled(model.isChecking)
                    .accessibilityLabel("Message to check")
            }
            sourceDivider
            Text("\(model.text.unicodeScalars.count) / 10,000 characters")
                .font(.caption.monospacedDigit())
                .foregroundStyle(palette.secondaryText)
        }
    }

    private var urlInput: some View {
        VStack(alignment: .leading, spacing: 12) {
            sourceDivider
            RavelEyebrow(title: "LINK TO CHECK", palette: palette)
            TextField("https://example.com", text: $model.url, axis: .vertical)
                .focused($focusedInput, equals: .url)
                .font(.body.monospaced())
                .foregroundStyle(palette.primaryText)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(model.isChecking)
                .accessibilityLabel("Link to check")
            sourceDivider
            Label("The destination is parsed locally, never opened.", systemImage: "arrow.up.right.square")
                .font(.caption)
                .foregroundStyle(palette.secondaryText)
        }
    }

    @ViewBuilder
    private var serviceState: some View {
        if let configurationMessage = model.configurationMessage {
            inlineNotice(title: "Backend setup", message: configurationMessage,
                         detail: "This build needs a configured server before it can analyze an item.",
                         symbol: "network.slash", color: palette.caution)
        }

        if model.isChecking {
            VStack(alignment: .leading, spacing: 10) {
                sourceDivider
                HStack(spacing: 12) {
                    ProgressView().tint(palette.accent)
                    Text("Checking privately…")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(palette.primaryText)
                }
                if model.isSlowCheck {
                    Text("Taking longer than usual. You can cancel, choose a smaller screenshot, or paste readable text instead.")
                        .font(.caption)
                        .foregroundStyle(palette.secondaryText)
                        .padding(.top, 8)
                }
                Button("Cancel check", role: .cancel) { model.cancelCheck() }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(palette.accent)
            }
        }

        if let error = model.errorMessage {
            inlineNotice(title: "Check couldn't finish", message: error,
                         detail: nil, symbol: "exclamationmark.triangle", color: palette.caution)
            Button("Retry privately") { analyzePrivately() }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(palette.accent)
                .disabled(!model.canAnalyze)
        }
    }

    private func inlineNotice(title: String, message: String, detail: String?,
                              symbol: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            sourceDivider
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(color)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(palette.primaryText)
            if let detail {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(palette.secondaryText)
            }
        }
    }

    private var privacyPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            sourceDivider
            HStack(spacing: 9) {
                Image(systemName: "lock.shield.fill")
                    .foregroundStyle(palette.accent)
                Text("Your check stays yours")
                    .font(.headline)
                    .foregroundStyle(palette.primaryText)
            }
            Text(model.privacyNotice)
                .font(.subheadline)
                .foregroundStyle(palette.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
            if model.inputKind != .url {
                Link("Google Gemini data terms", destination: URL(string: "https://ai.google.dev/gemini-api/terms")!)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(palette.accent)
            }
            Text("Selected content stays in app memory and is cleared when this check is dismissed or the app goes into the background.")
                .font(.caption)
                .foregroundStyle(palette.secondaryText)

            Button(action: analyzePrivately) {
                HStack(spacing: 10) {
                    Image(systemName: model.isChecking ? "hourglass" : "lock.fill")
                    Text(model.isChecking ? "Checking privately…" : "Analyze privately")
                        .font(.headline)
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
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                )
                .shadow(color: palette.brandBlue.opacity(0.24), radius: 16, y: 5)
            }
            .buttonStyle(.plain)
            .disabled(!model.canAnalyze)
            .opacity(model.canAnalyze ? 1 : 0.55)
            .accessibilityHint("Sends only this selected item to the configured backend.")
        }
    }

    private func analyzePrivately() {
        dismissInputFocus()
        model.analyzePrivately()
    }

    private func dismissInputFocus() {
        focusedInput = nil
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),
                                        to: nil, from: nil, for: nil)
    }
}
