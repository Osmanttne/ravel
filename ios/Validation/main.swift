// Compile with SharedUI/PlatformImagePreparation.swift using the macOS SDK.
// These synthetic pixel checks do not validate UIKit, PhotosPicker, or the Share menu.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum ValidationFailure: Error { case failed(String) }

func require(_ condition: @autoclosure () -> Bool, _ description: String) throws {
    guard condition() else { throw ValidationFailure.failed(description) }
}

func sourceImage(width: Int, height: Int, type: UTType, orientation: Int = 1) throws -> Data {
    guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                  bytesPerRow: 0, space: colorSpace,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        throw ValidationFailure.failed("Synthetic image allocation")
    }
    context.setFillColor(CGColor(gray: 0.5, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
    guard let image = context.makeImage() else { throw ValidationFailure.failed("Synthetic pixels") }
    let output = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(output as CFMutableData,
                                                            type.identifier as CFString, 1, nil) else {
        throw ValidationFailure.failed("Synthetic encoder")
    }
    let properties: [CFString: Any] = [
        kCGImagePropertyOrientation: orientation,
        kCGImagePropertyTIFFDictionary: [kCGImagePropertyTIFFImageDescription: "private synthetic marker"],
        kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 40.0,
                                       kCGImagePropertyGPSLatitudeRef: "N",
                                       kCGImagePropertyGPSLongitude: 70.0,
                                       kCGImagePropertyGPSLongitudeRef: "W"]
    ]
    CGImageDestinationAddImage(destination, image, properties as CFDictionary)
    try require(CGImageDestinationFinalize(destination), "Synthetic encoder finalization")
    return output as Data
}

func expectImageError(_ expected: ImagePreparationError, _ operation: () throws -> Void) throws {
    do {
        try operation()
        throw ValidationFailure.failed("Expected image error")
    } catch let actual as ImagePreparationError {
        try require(String(describing: actual) == String(describing: expected), "Correct image error")
    }
}

func checkPrepared(_ prepared: PreparedImage) throws {
    try require(prepared.data.count <= PlatformImagePreparation.maximumOutputBytes, "Upload bounded")
    try require(prepared.pixelWidth <= 2_000 && prepared.pixelHeight <= 2_000, "Dimensions bounded")
    try require(["image/png", "image/jpeg"].contains(prepared.mimeType), "Supported wire MIME")
    guard let source = CGImageSourceCreateWithData(prepared.data as CFData, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else {
        throw ValidationFailure.failed("Prepared image decodable")
    }
    try require(CGImageSourceGetCount(source) == 1, "Single frame")
    try require(properties[kCGImagePropertyGPSDictionary] == nil, "GPS not copied")
    let tiff = properties[kCGImagePropertyTIFFDictionary] as? [CFString: Any]
    try require(tiff?[kCGImagePropertyTIFFImageDescription] == nil, "Private description not copied")
    try require(!String(describing: properties).contains("private synthetic marker"), "Marker absent")
}

do {
    let orientedJPEG = try sourceImage(width: 3_000, height: 1_500, type: .jpeg, orientation: 6)
    let originalSource = CGImageSourceCreateWithData(orientedJPEG as CFData, nil)!
    let originalProperties = CGImageSourceCopyPropertiesAtIndex(originalSource, 0, nil)!
        as NSDictionary
    try require(originalProperties[kCGImagePropertyGPSDictionary] != nil,
                "Synthetic source actually contains GPS metadata")
    try require(String(describing: originalProperties).contains("private synthetic marker"),
                "Synthetic source actually contains private description")
    let prepared = try PlatformImagePreparation.prepare(data: orientedJPEG)
    try checkPrepared(prepared)
    try require(prepared.pixelWidth == 1_000 && prepared.pixelHeight == 2_000,
                "Orientation applied while downsampling")

    let png = try sourceImage(width: 120, height: 80, type: .png)
    let preparedPNG = try PlatformImagePreparation.prepare(data: png)
    try checkPrepared(preparedPNG)
    try require(preparedPNG.pixelWidth == 120 && preparedPNG.pixelHeight == 80, "Small image not upscaled")

    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    let selected = folder.appendingPathComponent("selected.png")
    try png.write(to: selected)
    try checkPrepared(PlatformImagePreparation.prepare(fileURL: selected))

    try expectImageError(.unreadableImage) { _ = try PlatformImagePreparation.prepare(data: Data()) }
    try expectImageError(.unsupportedImage) {
        _ = try PlatformImagePreparation.prepare(data: Data("not an image".utf8))
    }
    try expectImageError(.sourceTooLarge) {
        _ = try PlatformImagePreparation.prepare(data: Data(repeating: 0,
            count: PlatformImagePreparation.maximumSourceBytes + 1))
    }
    try expectImageError(.unreadableImage) {
        _ = try PlatformImagePreparation.prepare(fileURL: URL(string: "https://tickets.example/offer")!)
    }
    try expectImageError(.unreadableImage) { _ = try PlatformImagePreparation.prepare(fileURL: folder) }
    print("Image preparation checks passed: pixel bounds, rotation, metadata removal, file import, invalid/oversized input.")
} catch {
    print("Image preparation validation failed: \(error)")
    exit(1)
}
