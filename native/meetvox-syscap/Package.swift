// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "meetvox-syscap",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "meetvox-syscap",
            path: "Sources/meetvox-syscap"
        )
    ]
)
