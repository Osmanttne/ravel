import CoreTransferable
import UniformTypeIdentifiers

/// Import a bounded file while its system-provided URL is valid; retain prepared bytes only.
struct SelectedScreenshot: Transferable, Sendable {
    let image: PreparedImage

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .image) { received in
            let fileURL = received.file
            let preparation = Task.detached(priority: .userInitiated) {
                try PlatformImagePreparation.prepare(fileURL: fileURL)
            }
            // Await preparation inside the import closure: the system URL is still valid.
            return try await withTaskCancellationHandler {
                SelectedScreenshot(image: try await preparation.value)
            } onCancel: {
                preparation.cancel()
            }
        }
    }
}
