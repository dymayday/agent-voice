// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AgentVoiceApp",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "AgentVoiceCore", targets: ["AgentVoiceCore"]),
        .executable(name: "AgentVoiceApp", targets: ["AgentVoiceApp"])
    ],
    targets: [
        .target(name: "AgentVoiceCore"),
        .executableTarget(name: "AgentVoiceApp", dependencies: ["AgentVoiceCore"]),
        .testTarget(name: "AgentVoiceCoreTests", dependencies: ["AgentVoiceCore"])
    ]
)
