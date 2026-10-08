// swift-tools-version: 6.0
// the foundation-only vault core, built here so `swift test` can run it on a mac without a
// simulator. the app compiles the same sources through ios/Vault.podspec.
import PackageDescription

let package = Package(
  name: "VaultCore",
  platforms: [.macOS(.v14), .iOS(.v16)],
  products: [
    .library(name: "VaultCore", targets: ["VaultCore"])
  ],
  targets: [
    .target(name: "VaultCore", path: "ios/Core"),
    .testTarget(name: "VaultCoreTests", dependencies: ["VaultCore"], path: "ios/Tests"),
  ],
  swiftLanguageModes: [.v5]
)
