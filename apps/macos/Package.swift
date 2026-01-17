// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "Ultrathink",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(
            name: "Ultrathink",
            targets: ["Ultrathink"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/sindresorhus/KeyboardShortcuts", from: "2.0.0"),
        .package(url: "https://github.com/apple/swift-markdown", from: "0.3.0")
    ],
    targets: [
        .executableTarget(
            name: "Ultrathink",
            dependencies: [
                "KeyboardShortcuts",
                .product(name: "Markdown", package: "swift-markdown")
            ],
            path: "Sources",
            resources: [
                .process("Models/Ultrathink.xcdatamodeld")
            ]
        ),
        .testTarget(
            name: "UltrathinkTests",
            dependencies: ["Ultrathink"],
            path: "Tests"
        )
    ]
)