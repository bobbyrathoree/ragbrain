// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "Ragbrain",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(
            name: "Ragbrain",
            targets: ["Ragbrain"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/sindresorhus/KeyboardShortcuts", from: "2.0.0"),
        .package(url: "https://github.com/apple/swift-markdown", from: "0.3.0")
    ],
    targets: [
        .executableTarget(
            name: "Ragbrain",
            dependencies: [
                "KeyboardShortcuts",
                .product(name: "Markdown", package: "swift-markdown")
            ],
            path: "Sources",
            resources: [
                .process("Models/Ragbrain.xcdatamodeld")
            ]
        ),
        .testTarget(
            name: "RagbrainTests",
            dependencies: ["Ragbrain"],
            path: "Tests"
        )
    ]
)