import Foundation
import PhotosUI
import RavelCore
import SwiftUI

@MainActor
final class CheckViewModel: ObservableObject {
    enum InputKind {
        case image, text, url
    }

    @Published private(set) var inputKind: InputKind = .image
    @Published var text = ""
    @Published var url = ""
    @Published private(set) var preparedImage: PreparedImage?
    @Published private(set) var isPreparingImage = false
    @Published private(set) var isChecking = false
    @Published private(set) var isSlowCheck = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var configurationMessage: String?
    @Published private(set) var response: CheckResponse?
    @Published var isShowingResult = false

    private let client: (any CheckServing)?
    private var operationID = UUID()
    private var checkTask: Task<Void, Never>?
    private var preparationTask: Task<Void, Never>?
    private var slowTask: Task<Void, Never>?

    init(client: (any CheckServing)? = nil) {
        if let client {
            self.client = client
        } else {
            do {
                self.client = CheckClient(configuration: try BundleBackendConfiguration.makeConfiguration())
            } catch let error as BackendSetupError {
                self.client = nil
                configurationMessage = error.errorDescription
            } catch {
                self.client = nil
                configurationMessage = "A valid Ravel backend must be configured for this build."
            }
        }
    }

    deinit {
        checkTask?.cancel()
        preparationTask?.cancel()
        slowTask?.cancel()
    }

    var canAnalyze: Bool {
        guard client != nil, !isChecking, !isPreparingImage else { return false }
        switch inputKind {
        case .image: return preparedImage != nil
        case .text:
            return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && text.unicodeScalars.count <= 10_000
        case .url:
            return !url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && url.unicodeScalars.count <= 2_048
        }
    }

    var privacyNotice: String {
        if inputKind == .url {
            return "This selected link will be sent to Ravel's backend for local parsing. It won't be opened or sent to Gemini. A private check creates no community report."
        }
        return "Only this selected item will be sent to Ravel's backend. In connected mode it is also sent to Google Gemini for AI analysis under Google's provider terms. A private check creates no community report."
    }

    func choose(_ kind: InputKind) {
        cancelAndClear()
        inputKind = kind
    }

    func prepare(_ selection: PhotosPickerItem) {
        cancelAndClear()
        inputKind = .image
        isPreparingImage = true
        let id = operationID
        preparationTask = Task { [weak self] in
            do {
                guard let selected = try await selection.loadTransferable(type: SelectedScreenshot.self) else {
                    throw ImagePreparationError.unreadableImage
                }
                try Task.checkCancellation()
                guard let self, self.operationID == id else { return }
                self.preparedImage = selected.image
                self.isPreparingImage = false
                self.preparationTask = nil
            } catch is CancellationError {
                guard let self, self.operationID == id else { return }
                self.isPreparingImage = false
                self.preparationTask = nil
            } catch {
                guard let self, self.operationID == id else { return }
                self.isPreparingImage = false
                self.preparationTask = nil
                self.errorMessage = (error as? ImagePreparationError)?.userFriendlyMessage
                    ?? "This selected photo couldn't be loaded. Choose it again or try another screenshot."
            }
        }
    }

    /// This is called only by an explicit Analyze privately or Retry action.
    func analyzePrivately() {
        guard canAnalyze, let client else { return }
        let submission: CheckSubmission
        switch inputKind {
        case .image:
            guard let image = preparedImage else { return }
            submission = .image(image.data, mimeType: image.mimeType)
        case .text: submission = .text(text)
        case .url: submission = .url(url)
        }
        operationID = UUID()
        let id = operationID
        errorMessage = nil
        response = nil
        isChecking = true
        isSlowCheck = false
        slowTask?.cancel()
        slowTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: 15_000_000_000)
                guard let self, self.operationID == id, self.isChecking else { return }
                self.isSlowCheck = true
            } catch { }
        }
        checkTask = Task { [weak self] in
            do {
                let response = try await client.check(submission, source: .iosApp)
                try Task.checkCancellation()
                guard let self, self.operationID == id else { return }
                self.finishCheck()
                self.response = response
                self.isShowingResult = true
            } catch {
                guard let self, self.operationID == id else { return }
                self.finishCheck()
                if error is CancellationError || (error as? CheckError) == .cancelled { return }
                self.errorMessage = (error as? CheckError)?.errorDescription
                    ?? "The private check couldn't finish. Try again when the backend is available."
            }
        }
    }

    func cancelCheck() {
        operationID = UUID()
        checkTask?.cancel()
        slowTask?.cancel()
        checkTask = nil
        slowTask = nil
        isChecking = false
        isSlowCheck = false
        errorMessage = nil
    }

    func cancelAndClear() {
        cancelCheck()
        preparationTask?.cancel()
        preparationTask = nil
        isPreparingImage = false
        preparedImage = nil
        text = ""
        url = ""
        response = nil
        isShowingResult = false
    }

    private func finishCheck() {
        checkTask = nil
        slowTask?.cancel()
        slowTask = nil
        isChecking = false
        isSlowCheck = false
    }
}
