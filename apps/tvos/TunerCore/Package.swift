// swift-tools-version: 6.0
// TunerCore: everything in Tuner for Apple TV that does not need UIKit, AVFoundation or Network.framework.
// Foundation only, Swift 6 language mode, builds and tests on Linux and macOS.
import PackageDescription

let package = Package(
    name: "TunerCore",
    platforms: [.tvOS(.v17), .macOS(.v14), .iOS(.v17)],
    products: [.library(name: "TunerCore", targets: ["TunerCore"])],
    targets: [
        .target(name: "TunerCore"),
        .testTarget(name: "TunerCoreTests", dependencies: ["TunerCore"], resources: [.copy("Fixtures")]),
    ]
)
