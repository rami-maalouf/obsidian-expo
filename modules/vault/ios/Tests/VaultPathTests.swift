import Foundation
import Testing

@testable import VaultCore

@Suite struct VaultPathTests {
  @Test func acceptsNestedRelativePaths() throws {
    #expect(try VaultRoot.segments(of: "Daily/2026-10-08.md") == ["Daily", "2026-10-08.md"])
    #expect(try VaultRoot.segments(of: "Résumé.md") == ["Résumé.md"])
  }

  @Test(arguments: [
    ("", VaultPathError.empty),
    ("/etc/passwd", VaultPathError.absolute),
    ("../outside.md", VaultPathError.invalidSegment("..")),
    ("Daily/../../x.md", VaultPathError.invalidSegment("..")),
    ("./x.md", VaultPathError.invalidSegment(".")),
    ("a//b.md", VaultPathError.invalidSegment("")),
    ("Daily/", VaultPathError.invalidSegment("")),
    (".obsidian/app.json", VaultPathError.hiddenSegment(".obsidian")),
    ("Notes/.trash/x.md", VaultPathError.hiddenSegment(".trash")),
  ])
  func rejectsUnsafePaths(path: String, error: VaultPathError) {
    #expect(throws: error) { try VaultRoot.segments(of: path) }
  }

  @Test func resolvesInsideTheVault() throws {
    let vault = try TestVault()
    let url = try vault.root.resolve("Daily/2026-10-08.md")
    #expect(url.path.hasSuffix("/vault/Daily/2026-10-08.md"))
    #expect(vault.root.relativePath(of: url) == "Daily/2026-10-08.md")
  }

  @Test func rejectsSymlinkedFolderOutsideTheVault() throws {
    let vault = try TestVault()
    let elsewhere = vault.outside.appendingPathComponent("elsewhere")
    try FileManager.default.createDirectory(at: elsewhere, withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(at: vault.url("Linked"), withDestinationURL: elsewhere)
    #expect(throws: VaultPathError.outsideVault) { try vault.root.resolve("Linked/note.md") }
    #expect(throws: VaultPathError.outsideVault) { try vault.root.resolve("Linked/deeper/note.md") }
  }

  @Test func rejectsDanglingSymlinkOutsideTheVault() throws {
    let vault = try TestVault()
    let missing = vault.outside.appendingPathComponent("not-created-yet")
    try FileManager.default.createSymbolicLink(atPath: vault.url("Dangling").path, withDestinationPath: missing.path)
    try FileManager.default.createSymbolicLink(atPath: vault.url("dangling.md").path, withDestinationPath: missing.path)
    #expect(throws: VaultPathError.outsideVault) { try vault.root.resolve("Dangling/note.md") }
    #expect(throws: VaultPathError.outsideVault) { try vault.root.resolve("dangling.md") }
  }

  @Test func relativeSymlinkEscapingTheVaultIsRejected() throws {
    let vault = try TestVault()
    try FileManager.default.createDirectory(at: vault.outside.appendingPathComponent("sibling"), withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(atPath: vault.url("Up").path, withDestinationPath: "../sibling")
    #expect(throws: VaultPathError.outsideVault) { try vault.root.resolve("Up/note.md") }
  }

  @Test func allowsSymlinksThatStayInside() throws {
    let vault = try TestVault()
    try vault.write("Real/note.md", Data("x"))
    try FileManager.default.createSymbolicLink(atPath: vault.url("Alias").path, withDestinationPath: "Real")
    #expect(throws: Never.self) { try vault.root.resolve("Alias/note.md") }
  }

  @Test func relativePathIsNilOutsideTheVault() throws {
    let vault = try TestVault()
    #expect(vault.root.relativePath(of: vault.outside.appendingPathComponent("x.md")) == nil)
  }
}
