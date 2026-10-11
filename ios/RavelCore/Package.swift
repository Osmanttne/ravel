// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "RavelCore",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [.library(name: "RavelCore", targets: ["RavelCore"])],
    targets: [
        .target(name: "RavelCore"),
        .testTarget(name: "RavelCoreTests", dependencies: ["RavelCore"],
                    resources: [.copy("Fixtures")])
    ]
)
