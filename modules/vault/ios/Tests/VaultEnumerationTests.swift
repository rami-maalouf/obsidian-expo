import Foundation
import Testing

@testable import VaultCore

@Suite struct VaultEnumerationTests {
  func collect(_ vault: TestVault, batchSize: Int = 500) -> ([VaultEntry], EnumerationSummary) {
    var entries: [VaultEntry] = []
    let summary = vault.files.enumerateNotes(batchSize: batchSize) { batch in
      entries.append(contentsOf: batch)
      return true
    }
    return (entries.sorted { $0.path < $1.path }, summary)
  }

  @Test func listsMarkdownAndSkipsHiddenFoldersOtherFilesAndSymlinks() throws {
    let vault = try TestVault()
    try vault.write("Welcome.md", Data("hello"))
    try vault.write("Projects/Alpha/Index.md", Data("a"))
    try vault.write("Projects/Beta/Index.md", Data("b"))
    try vault.write("Projects/Upper.MD", Data("c"))
    try vault.write("attachments/pixel.png", Data("png"))
    try vault.write(".obsidian/plugins/note.md", Data("hidden"))
    try vault.write(".trash/old.md", Data("trash"))
    try vault.write(".hidden.md", Data("hidden file"))
    let elsewhere = vault.outside.appendingPathComponent("elsewhere")
    try FileManager.default.createDirectory(at: elsewhere, withIntermediateDirectories: true)
    try Data("outside").write(to: elsewhere.appendingPathComponent("outside.md"))
    try FileManager.default.createSymbolicLink(at: vault.url("Linked"), withDestinationURL: elsewhere)
    try FileManager.default.createSymbolicLink(atPath: vault.url("alias.md").path, withDestinationPath: "Welcome.md")

    let (entries, summary) = collect(vault)
    #expect(entries.map(\.path) == ["Projects/Alpha/Index.md", "Projects/Beta/Index.md", "Projects/Upper.MD", "Welcome.md"])
    #expect(entries.allSatisfy { $0.state == .readable })
    #expect(entries.first { $0.path == "Welcome.md" }?.size == 5)
    #expect(summary == EnumerationSummary(notes: 4, unreadableFolders: [], stopped: false))
  }

  @Test func legacyCloudStubsAppearAsPlaceholdersUnderTheirRealName() throws {
    let vault = try TestVault()
    try vault.write("Daily/.2026-10-08.md.icloud", Data("stub"))
    try vault.write("Daily/.image.png.icloud", Data("stub"))
    let (entries, _) = collect(vault)
    #expect(entries.map(\.path) == ["Daily/2026-10-08.md"])
    #expect(entries.first?.state == .placeholder)
    #expect(entries.first?.size == nil)
  }

  @Test func batchesAndEarlyStop() throws {
    let vault = try TestVault()
    for index in 0..<25 {
      try vault.write("Notes/\(index).md", Data("\(index)"))
    }
    var sizes: [Int] = []
    let all = vault.files.enumerateNotes(batchSize: 10) { batch in
      sizes.append(batch.count)
      return true
    }
    #expect(sizes == [10, 10, 5])
    #expect(all.notes == 25)

    var batches = 0
    let stopped = vault.files.enumerateNotes(batchSize: 10) { _ in
      batches += 1
      return false
    }
    #expect(batches == 1)
    #expect(stopped.stopped)
  }

  @Test func fileIdsSurviveARename() throws {
    let vault = try TestVault()
    try vault.write("Old.md", Data("x"))
    try vault.write("Other.md", Data("y"))
    let before = collect(vault).0
    try FileManager.default.createDirectory(at: vault.url("Moved"), withIntermediateDirectories: true)
    try FileManager.default.moveItem(at: vault.url("Old.md"), to: vault.url("Moved/New.md"))
    let after = collect(vault).0
    let oldId = before.first { $0.path == "Old.md" }?.fileId
    #expect(oldId != nil)
    #expect(after.first { $0.path == "Moved/New.md" }?.fileId == oldId)
    #expect(after.first { $0.path == "Other.md" }?.fileId != oldId)
  }

  @Test func reportsCreationAndModificationDates() throws {
    let vault = try TestVault()
    let target = try vault.write("Dated.md", Data("x"))
    let date = Date(timeIntervalSince1970: 1_700_000_000)
    try FileManager.default.setAttributes([.creationDate: date], ofItemAtPath: target.path)
    let entry = collect(vault).0.first { $0.path == "Dated.md" }
    let created = try #require(entry?.created)
    #expect(abs(created.timeIntervalSince(date)) < 1)
    #expect(entry?.modified != nil)
  }

  @Test func unreadableFoldersAreReported() throws {
    let vault = try TestVault()
    try vault.write("Open/a.md", Data("a"))
    try vault.write("Locked/b.md", Data("b"))
    try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: vault.url("Locked").path)
    let (entries, summary) = collect(vault)
    #expect(entries.map(\.path) == ["Open/a.md"])
    #expect(summary.unreadableFolders == ["Locked"])
  }
}
