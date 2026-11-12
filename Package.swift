// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SilentSpeak",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "SilentSpeakCore", targets: ["SilentSpeakCore"]),
        .executable(name: "silentspeak-eval", targets: ["silentspeak-eval"]),
    ],
    targets: [
        .target(name: "SilentSpeakCore"),
        .executableTarget(name: "silentspeak-eval", dependencies: ["SilentSpeakCore"]),
        .testTarget(name: "SilentSpeakCoreTests", dependencies: ["SilentSpeakCore"]),
    ]
)
