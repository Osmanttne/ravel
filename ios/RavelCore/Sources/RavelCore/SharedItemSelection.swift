import Foundation

public enum SharedItemKind: Equatable, Sendable { case image, url, text }

public enum SharedItemSelectionError: Error, LocalizedError, Equatable, Sendable {
    case unsupported, multiple

    public var errorDescription: String? {
        switch self {
        case .unsupported: return "Share a message, link, or PNG or JPEG screenshot."
        case .multiple: return "Share one item at a time for a private check."
        }
    }
}

public enum SharedItemSelection {
    /// A provider can advertise several representations of the same item.
    public static func preferredKind(supportsImage: Bool, supportsURL: Bool,
                                     supportsPlainText: Bool) -> SharedItemKind? {
        if supportsImage { return .image }
        if supportsURL { return .url }
        if supportsPlainText { return .text }
        return nil
    }

    /// Nil entries are unsupported providers. Returns the sole eligible provider's original index.
    public static func requireSingle(_ kinds: [SharedItemKind?]) throws -> Int {
        let eligible = kinds.indices.filter { kinds[$0] != nil }
        guard !eligible.isEmpty else { throw SharedItemSelectionError.unsupported }
        guard eligible.count == 1 else { throw SharedItemSelectionError.multiple }
        return eligible[0]
    }
}
