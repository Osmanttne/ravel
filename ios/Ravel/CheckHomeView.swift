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

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Choose one screenshot, message, or link to check privately.")
                    Text("Ravel doesn't monitor your messages or clipboard.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                Section("Choose an item") {
                    PhotosPicker(selection: $selectedPhoto, matching: .images,
                                 preferredItemEncoding: .current) {
                        Label("Check screenshot", systemImage: "photo")
                    }
                    .disabled(model.isChecking)
                    Button {
                        dismissInputFocus()
                        selectedPhoto = nil
                        model.choose(.text)
                    } label: {
                        Label("Paste message", systemImage: "text.bubble")
                    }
                    .disabled(model.isChecking)
                    Button {
                        dismissInputFocus()
                        selectedPhoto = nil
                        model.choose(.url)
                    } label: {
                        Label("Check link", systemImage: "link")
                    }
                    .disabled(model.isChecking)
                }

                inputSection

                if let configurationMessage = model.configurationMessage {
                    Section("Backend setup") {
                        Text(configurationMessage)
                        Text("This build needs a configured server before it can analyze an item.")
                            .font(.callout)
                    }
                }

                Section("Before you analyze") {
                    Text(model.privacyNotice)
                        .font(.callout)
                    if model.inputKind != .url {
                        Text("Google's handling depends on the backend's service tier. Use synthetic examples during development.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Link("Google Gemini data terms", destination: URL(string: "https://ai.google.dev/gemini-api/terms")!)
                            .font(.caption)
                    }
                    Text("Selected content stays in app memory and is cleared when this check is dismissed or the app goes into the background.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button("Analyze privately") {
                        analyzePrivately()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!model.canAnalyze)
                    .accessibilityHint("Sends only this selected item to the configured backend.")
                }

                if model.isChecking {
                    Section {
                        ProgressView("Checking privately…")
                        if model.isSlowCheck {
                            Text("This check is taking longer than usual. You can cancel and retry, crop a smaller screenshot, or paste its readable text instead.")
                                .font(.callout)
                        }
                        Button("Cancel check", role: .cancel) { model.cancelCheck() }
                    }
                }

                if let error = model.errorMessage {
                    Section("Check couldn't finish") {
                        Text(error)
                        Button("Retry privately") { analyzePrivately() }
                            .disabled(!model.canAnalyze)
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Ravel")
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done typing") { dismissInputFocus() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Clear") {
                        dismissInputFocus()
                        selectedPhoto = nil
                        model.cancelAndClear()
                    }
                    .accessibilityHint("Cancels this check and clears selected content from app memory.")
                }
            }
        }
        .onChange(of: selectedPhoto) { _, selection in
            if let selection {
                dismissInputFocus()
                model.prepare(selection)
                // Allow choosing the same photo again after a failed or cancelled import.
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
                        .navigationTitle("Private result")
                        .navigationBarTitleDisplayMode(.inline)
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

    @ViewBuilder
    private var inputSection: some View {
        switch model.inputKind {
        case .image:
            Section("Selected screenshot") {
                if model.isPreparingImage {
                    ProgressView("Preparing selected image…")
                } else if let prepared = model.preparedImage,
                          let image = UIImage(data: prepared.data) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxHeight: 260)
                        .accessibilityLabel("Preview of the selected screenshot")
                    Text("\(prepared.pixelWidth) × \(prepared.pixelHeight) pixels · prepared for private analysis")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Choose a screenshot with Check screenshot above.")
                        .foregroundStyle(.secondary)
                }
            }
        case .text:
            Section("Selected message") {
                Text("Paste or type the message here. Nothing is read automatically.")
                    .font(.callout)
                TextEditor(text: $model.text)
                    .focused($focusedInput, equals: .message)
                    .frame(minHeight: 140)
                    .disabled(model.isChecking)
                    .accessibilityLabel("Message to check")
                Text("\(model.text.unicodeScalars.count) / 10,000 characters")
                    .font(.caption)
            }
        case .url:
            Section("Selected link") {
                TextField("https://example.com", text: $model.url, axis: .vertical)
                    .focused($focusedInput, equals: .url)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .disabled(model.isChecking)
                    .accessibilityLabel("Link to check")
                Text("The destination won't be visited.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func analyzePrivately() {
        // Resign input before starting a request, including fast fixture responses.
        dismissInputFocus()
        model.analyzePrivately()
    }

    private func dismissInputFocus() {
        focusedInput = nil
        // This app-only responder action also dismisses an already visible UIKit keyboard.
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),
                                        to: nil, from: nil, for: nil)
    }
}
