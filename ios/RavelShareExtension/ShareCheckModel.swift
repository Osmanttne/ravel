import Combine
import Foundation
import RavelCore
import UIKit
import UniformTypeIdentifiers

enum SharedCheckContent: Sendable {
    case text(String)
    case url(String)
    case image(PreparedImage)

    var submission: CheckSubmission {
        switch self {
        case .text(let text): return .text(text)
        case .url(let url): return .url(url)
        case .image(let image): return .image(image.data, mimeType: image.mimeType)
        }
    }
}

private enum SharedItemError: Error, Sendable {
    case unavailable
    case unsupported
    case emptyText
    case textTooLarge
    case invalidURL
    case image(ImagePreparationError)

    var message: String {
        switch self {
        case .unavailable:
            return "This app couldn't provide the selected item. Share a screenshot, text, or link again."
        case .unsupported:
            return "Share one screenshot, plain-text message, or web link. Other files aren't supported."
        case .emptyText:
            return "The shared message is empty. Select some text or share a screenshot."
        case .textTooLarge:
            return "The shared message is too long. Select up to 10,000 characters and share again."
        case .invalidURL:
            return "Share a complete HTTP or HTTPS link, or a PNG, JPEG, or HEIC image file."
        case .image(let error): return error.userFriendlyMessage
        }
    }
}

/// Provider callbacks can outlive cancellation. This small gate is synchronized,
/// and the main actor separately checks an operation ID before accepting a result.
private final class SharedLoadGate: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
    }
}

private struct SharedProvider {
    let provider: NSItemProvider
    let kind: SharedItemKind
    let imageTypeIdentifier: String?
}

private enum SharedContentPreparation {
    static func text(_ value: String) throws -> SharedCheckContent {
        guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw SharedItemError.emptyText
        }
        guard value.unicodeScalars.count <= CheckClient.maxTextScalars else {
            throw SharedItemError.textTooLarge
        }
        return .text(value)
    }

    static func url(_ value: URL) throws -> SharedCheckContent {
        if value.isFileURL {
            // A local image representation is read, never treated as a web destination.
            guard value.host == nil || value.host == "" || value.host == "localhost" else {
                throw SharedItemError.invalidURL
            }
            let hasAccess = value.startAccessingSecurityScopedResource()
            defer { if hasAccess { value.stopAccessingSecurityScopedResource() } }
            return .image(try PlatformImagePreparation.prepare(fileURL: value))
        }
        let raw = value.absoluteString
        guard raw.unicodeScalars.count <= CheckClient.maxURLScalars,
              let components = URLComponents(url: value, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil else {
            throw SharedItemError.invalidURL
        }
        // Core and the backend apply the complete URL safety policy. No destination is opened.
        return .url(raw)
    }

    static func failure(_ error: Error) -> SharedItemError {
        if let known = error as? SharedItemError { return known }
        if let image = error as? ImagePreparationError { return .image(image) }
        return .unavailable
    }
}

@MainActor
final class ShareCheckModel: ObservableObject {
    enum Phase: Equatable {
        case loadingItem, preview, analyzing, result, loadFailed, checkFailed, unavailable
    }

    @Published private(set) var phase: Phase = .loadingItem
    @Published private(set) var content: SharedCheckContent?
    @Published private(set) var previewImage: UIImage?
    @Published private(set) var response: CheckResponse?
    @Published private(set) var message: String?
    @Published private(set) var showsSlowFallback = false
    let configurationMessage: String?

    private let service: (any CheckServing)?
    private var selectedProvider: SharedProvider?
    private var providerProgress: Progress?
    private var loadGate: SharedLoadGate?
    private var networkTask: Task<Void, Never>?
    private var slowTask: Task<Void, Never>?
    private var operationID = UUID()
    private var didStart = false
    private var closed = false

    init(service suppliedService: (any CheckServing)? = nil) {
        if let suppliedService {
            service = suppliedService
            configurationMessage = nil
        } else {
            do {
                service = CheckClient(configuration: try BundleBackendConfiguration.makeConfiguration())
                configurationMessage = nil
            } catch let error as BackendSetupError {
                service = nil
                configurationMessage = error.localizedDescription
            } catch {
                service = nil
                configurationMessage = "The backend isn't configured for this build."
            }
        }
    }

    var canAnalyze: Bool {
        content != nil && service != nil && !closed && (phase == .preview || phase == .checkFailed)
    }

    func start(items: [NSExtensionItem]) {
        guard !didStart, !closed else { return }
        didStart = true
        var eligible: [SharedProvider] = []
        var seenProviders = Set<ObjectIdentifier>()
        for provider in items.flatMap({ $0.attachments ?? [] }) {
            guard seenProviders.insert(ObjectIdentifier(provider)).inserted else { continue }
            guard let kind = SharedItemSelection.preferredKind(
                supportsImage: provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
                supportsURL: provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                supportsPlainText: provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
            ) else { continue }
            let identifier: String?
            if kind == .image {
                identifier = provider.registeredTypeIdentifiers.first {
                    UTType($0)?.conforms(to: .image) == true
                } ?? UTType.image.identifier
            } else {
                identifier = nil
            }
            // A URL and its plain-text alternate are one item; Core chooses the URL.
            eligible.append(SharedProvider(provider: provider, kind: kind,
                                           imageTypeIdentifier: identifier))
        }
        do {
            let index = try SharedItemSelection.requireSingle(eligible.map { Optional($0.kind) })
            let candidate = eligible[index]
            selectedProvider = candidate
            beginProviderLoad(candidate)
            return
        } catch SharedItemSelectionError.multiple {
            phase = .unavailable
            message = "Several items were shared. Select one screenshot, message, or link and share again."
            return
        } catch {
            // No eligible attachment: inspect only explicit text supplied on the extension item.
        }
        // Some hosts supply explicit text directly on NSExtensionItem rather than an attachment.
        let textItems = items.compactMap { $0.attributedContentText?.string }
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard textItems.count == 1, let text = textItems.first else {
            phase = .unavailable
            message = textItems.count > 1
                ? "Several messages were shared. Select one message and share again."
                : SharedItemError.unsupported.message
            return
        }
        do {
            acceptContent(try SharedContentPreparation.text(text))
        } catch {
            phase = .unavailable
            message = SharedContentPreparation.failure(error).message
        }
    }

    func retryLoading() {
        guard !closed, let selectedProvider else { return }
        beginProviderLoad(selectedProvider)
    }

    func analyze() {
        guard canAnalyze, let content, let service else { return }
        cancelWork()
        let id = operationID
        phase = .analyzing
        response = nil
        message = nil
        startSlowHint(id: id)
        let submission = content.submission
        networkTask = Task { [weak self] in
            do {
                let response = try await service.check(submission, source: .iosShare)
                try Task.checkCancellation()
                guard let self, self.operationID == id, !self.closed else { return }
                self.slowTask?.cancel()
                self.slowTask = nil
                self.networkTask = nil
                self.showsSlowFallback = false
                self.response = response
                self.phase = .result
            } catch {
                guard let self, self.operationID == id, !self.closed, !Task.isCancelled else { return }
                self.slowTask?.cancel()
                self.slowTask = nil
                self.networkTask = nil
                self.showsSlowFallback = false
                self.message = (error as? CheckError)?.localizedDescription
                    ?? "The check couldn't finish. Try again or select this item in Ravel."
                self.phase = .checkFailed
            }
        }
    }

    func cancelAnalysis() {
        guard phase == .analyzing else { return }
        cancelWork()
        phase = .preview
        message = "The check was cancelled. You can start a new private check."
    }

    func reassess(_ decisions: [SignalReviewDecision]) async throws -> Assessment {
        guard let service, let response, response.mode == .gemini,
              let observations = response.observations, let content, !decisions.isEmpty else {
            throw CheckError.invalidResponse
        }
        let kind: String
        switch content {
        case .image: kind = "image"
        case .text: kind = "text"
        case .url: throw CheckError.invalidResponse
        }
        return try await service.reassess(
            SignalReassessmentRequest(inputKind: kind, observations: observations, decisions: decisions)
        )
    }

    func stopForBackground() {
        guard !closed, phase == .loadingItem || phase == .analyzing else { return }
        let wasLoading = phase == .loadingItem
        cancelWork()
        phase = wasLoading ? .loadFailed : .preview
        message = "The check stopped when the source app left the screen. Try again when you're ready."
    }

    func stopForDismissal() {
        guard !closed else { return }
        closed = true
        cancelWork()
        selectedProvider = nil
        content = nil
        previewImage = nil
        response = nil
        message = nil
    }

    private func cancelWork() {
        operationID = UUID()
        loadGate?.cancel()
        loadGate = nil
        providerProgress?.cancel()
        providerProgress = nil
        networkTask?.cancel()
        networkTask = nil
        slowTask?.cancel()
        slowTask = nil
        showsSlowFallback = false
    }

    private func startSlowHint(id: UUID) {
        slowTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 8_000_000_000) } catch { return }
            guard let self, self.operationID == id, !self.closed else { return }
            self.showsSlowFallback = true
        }
    }

    private func beginProviderLoad(_ candidate: SharedProvider) {
        cancelWork()
        phase = .loadingItem
        content = nil
        previewImage = nil
        message = nil
        response = nil
        let id = operationID
        let gate = SharedLoadGate()
        loadGate = gate
        startSlowHint(id: id)
        switch candidate.kind {
        case .image:
            let identifier = candidate.imageTypeIdentifier ?? UTType.image.identifier
            providerProgress = candidate.provider.loadFileRepresentation(
                forTypeIdentifier: identifier
            ) { [weak self] url, error in
                guard !gate.isCancelled else { return }
                // Apple deletes this temporary file when this callback returns.
                // Read bounded bytes and reencode the image here, before entering a Task.
                // Data-only/UIImage fallbacks can allocate an unbounded original image;
                // unsupported providers use the manual in-app fallback instead.
                let result: Result<SharedCheckContent, SharedItemError>
                do {
                    guard error == nil, let url else { throw SharedItemError.unavailable }
                    guard url.isFileURL else { throw SharedItemError.unsupported }
                    result = .success(try SharedContentPreparation.url(url))
                } catch {
                    result = .failure(SharedContentPreparation.failure(error))
                }
                guard !gate.isCancelled else { return }
                Task { @MainActor [weak self] in self?.receive(result, id: id) }
            }
        case .url:
            providerProgress = candidate.provider.loadObject(ofClass: URL.self) { [weak self] url, error in
                guard !gate.isCancelled else { return }
                let result: Result<SharedCheckContent, SharedItemError>
                do {
                    guard error == nil, let url else { throw SharedItemError.unavailable }
                    // A file URL must also be processed while this provider callback owns it.
                    result = .success(try SharedContentPreparation.url(url))
                } catch {
                    result = .failure(SharedContentPreparation.failure(error))
                }
                guard !gate.isCancelled else { return }
                Task { @MainActor [weak self] in self?.receive(result, id: id) }
            }
        case .text:
            providerProgress = candidate.provider.loadObject(ofClass: String.self) { [weak self] text, error in
                guard !gate.isCancelled else { return }
                let result: Result<SharedCheckContent, SharedItemError>
                do {
                    guard error == nil, let text else { throw SharedItemError.unavailable }
                    result = .success(try SharedContentPreparation.text(text))
                } catch {
                    result = .failure(SharedContentPreparation.failure(error))
                }
                guard !gate.isCancelled else { return }
                Task { @MainActor [weak self] in self?.receive(result, id: id) }
            }
        }
    }

    private func receive(_ result: Result<SharedCheckContent, SharedItemError>, id: UUID) {
        guard !closed, operationID == id else { return }
        slowTask?.cancel()
        slowTask = nil
        providerProgress = nil
        loadGate = nil
        showsSlowFallback = false
        switch result {
        case .success(let content): acceptContent(content)
        case .failure(let error):
            phase = .loadFailed
            message = error.message
        }
    }

    private func acceptContent(_ content: SharedCheckContent) {
        self.content = content
        if case .image(let image) = content { previewImage = UIImage(data: image.data) }
        phase = .preview
    }
}
