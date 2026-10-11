import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Only the re-encoded pixels remain in memory; no selected file is copied or saved.
public struct PreparedImage: Sendable {
    public let data: Data
    public let mimeType: String
    public let pixelWidth: Int
    public let pixelHeight: Int
}

public enum ImagePreparationError: Error, LocalizedError, Sendable {
    case sourceTooLarge
    case unsupportedImage
    case unreadableImage
    case imageTooLarge

    public var userFriendlyMessage: String {
        switch self {
        case .sourceTooLarge:
            return "Choose an image smaller than 20 MB or crop the screenshot first."
        case .unsupportedImage:
            return "Choose a PNG, JPEG, or HEIC image. Animated images aren't supported."
        case .unreadableImage:
            return "This image couldn't be prepared. Choose another screenshot and try again."
        case .imageTooLarge:
            return "This image is too large to analyze. Crop the screenshot and try again."
        }
    }

    public var errorDescription: String? { userFriendlyMessage }
}

/// Stateless preparation can run on a background task or inside an item-provider callback.
public enum PlatformImagePreparation {
    public static let maximumSourceBytes = 20 * 1_024 * 1_024
    public static let maximumOutputBytes = 5 * 1_024 * 1_024
    public static let maximumOutputDimension = 2_000
    private static let maximumSourcePixels = 64_000_000

    /// Call this before a provider's temporary URL expires; the returned value owns its bytes.
    public static func prepare(fileURL: URL) throws -> PreparedImage {
        guard fileURL.isFileURL else { throw ImagePreparationError.unreadableImage }
        let values: URLResourceValues
        do {
            values = try fileURL.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        } catch {
            throw ImagePreparationError.unreadableImage
        }
        guard values.isRegularFile == true else { throw ImagePreparationError.unreadableImage }
        if let size = values.fileSize, size > maximumSourceBytes {
            throw ImagePreparationError.sourceTooLarge
        }
        let handle: FileHandle
        do {
            handle = try FileHandle(forReadingFrom: fileURL)
        } catch {
            throw ImagePreparationError.unreadableImage
        }
        defer { try? handle.close() }
        var data = Data()
        do {
            while let chunk = try handle.read(upToCount: min(1_024 * 1_024,
                                                            maximumSourceBytes + 1 - data.count)),
                  !chunk.isEmpty {
                try Task.checkCancellation()
                data.append(chunk)
                if data.count > maximumSourceBytes { throw ImagePreparationError.sourceTooLarge }
            }
        } catch let error as ImagePreparationError {
            throw error
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw ImagePreparationError.unreadableImage
        }
        return try prepare(data: data)
    }

    public static func prepare(data: Data) throws -> PreparedImage {
        guard !data.isEmpty else { throw ImagePreparationError.unreadableImage }
        guard data.count <= maximumSourceBytes else { throw ImagePreparationError.sourceTooLarge }
        try Task.checkCancellation()
        guard let source = CGImageSourceCreateWithData(
            data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary
        ), let identifier = CGImageSourceGetType(source),
              let type = UTType(identifier as String),
              type.conforms(to: .png) || type.conforms(to: .jpeg)
                || type.conforms(to: .heic) || type.conforms(to: .heif),
              CGImageSourceGetCount(source) == 1 else {
            throw ImagePreparationError.unsupportedImage
        }
        guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil)
                as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 20_000, height <= 20_000,
              width <= maximumSourcePixels / height else {
            throw ImagePreparationError.imageTooLarge
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maximumOutputDimension,
            kCGImageSourceShouldCacheImmediately: true
        ]
        guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
              thumbnail.width <= maximumOutputDimension,
              thumbnail.height <= maximumOutputDimension,
              let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: thumbnail.width, height: thumbnail.height,
                                      bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw ImagePreparationError.unreadableImage
        }
        // Render new opaque sRGB pixels: source EXIF, GPS, text, and ICC metadata aren't copied.
        let bounds = CGRect(x: 0, y: 0, width: CGFloat(thumbnail.width), height: CGFloat(thumbnail.height))
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(bounds)
        context.draw(thumbnail, in: bounds)
        guard let cleanImage = context.makeImage() else { throw ImagePreparationError.unreadableImage }
        try Task.checkCancellation()
        if let png = encode(cleanImage, type: .png, quality: nil), png.count <= maximumOutputBytes {
            return PreparedImage(data: png, mimeType: "image/png",
                                 pixelWidth: cleanImage.width, pixelHeight: cleanImage.height)
        }
        for quality in [0.9, 0.75, 0.6] {
            try Task.checkCancellation()
            if let jpeg = encode(cleanImage, type: .jpeg, quality: quality),
               jpeg.count <= maximumOutputBytes {
                return PreparedImage(data: jpeg, mimeType: "image/jpeg",
                                     pixelWidth: cleanImage.width, pixelHeight: cleanImage.height)
            }
        }
        throw ImagePreparationError.imageTooLarge
    }

    private static func encode(_ image: CGImage, type: UTType, quality: Double?) -> Data? {
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output as CFMutableData, type.identifier as CFString, 1, nil
        ) else { return nil }
        let options: [CFString: Any] = quality.map {
            [kCGImageDestinationLossyCompressionQuality: $0]
        } ?? [:]
        CGImageDestinationAddImage(destination, image, options as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return output as Data
    }
}
