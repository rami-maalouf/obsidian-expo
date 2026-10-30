import Foundation
import Testing

@testable import VaultCore

@Suite struct ExploreFixtureTests {
  @Test func onlyExploreSimulatorBuildsCreateTheFixture() throws {
    let vault = try TestVault()
    for (identifier, simulator) in [
      ("com.ramimaalouf.obsidianexpo", true),
      ("com.ramimaalouf.obsidianexpo.preview", true),
      ("com.ramimaalouf.obsidianexpo.dev", true),
      ("com.ramimaalouf.obsidianexpo.explore", false),
    ] {
      let result = try ExploreFixture.prepare(in: vault.outside, appIdentifier: identifier, isSimulator: simulator) {
        Issue.record("disabled builds must not read fixture resources")
        return Data()
      }
      #expect(result == nil)
      #expect(!FileManager.default.fileExists(atPath: vault.outside.appendingPathComponent("expo-explore").path))
    }
  }

  @Test func initializesOnlyItsOwnFolderAndPreservesLaterEdits() throws {
    let vault = try TestVault()
    try vault.write("Personal.md", Data("untouched"))
    let folder = try #require(ExploreFixture.prepare(in: vault.outside,
      appIdentifier: "com.ramimaalouf.obsidianexpo.explore", isSimulator: true) { Data("# Welcome\n") })
    #expect(folder == vault.outside.appendingPathComponent("expo-explore", isDirectory: true))
    let note = folder.appendingPathComponent("Welcome.md")
    #expect(try Data(contentsOf: note) == Data("# Welcome\n"))
    try Data("edited in capture").write(to: note)
    _ = try ExploreFixture.prepare(in: vault.outside,
      appIdentifier: "com.ramimaalouf.obsidianexpo.explore", isSimulator: true) { Data("replacement") }
    #expect(try Data(contentsOf: note) == Data("edited in capture"))
    #expect(try vault.bytes("Personal.md") == Data("untouched"))
  }
}
