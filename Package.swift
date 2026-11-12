// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SilentSpeak",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "SilentSpeakCore", targets: ["SilentSpeakCore"]),
        .executable(name: "silentspeak-eval", targets: ["silentspeak-eval"]),
        .executable(name: "silentspeak-bridge", targets: ["silentspeak-bridge"]),
    ],
    targets: [
        .target(name: "SilentSpeakCore"),
        .executableTarget(name: "silentspeak-eval", dependencies: ["SilentSpeakCore"]),
        .executableTarget(
            name: "silentspeak-bridge",
            dependencies: ["SilentSpeakCore"],
            exclude: ["Info.plist"],
            linkerSettings: [
                // Embed Info.plist so macOS shows the Motion usage description for this tool.
                .unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist",
                              "-Xlinker", "Sources/silentspeak-bridge/Info.plist"]),
            ]),
        .testTarget(name: "SilentSpeakCoreTests", dependencies: ["SilentSpeakCore"]),
    ]
)
