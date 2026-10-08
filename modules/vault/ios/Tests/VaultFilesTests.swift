import Foundation
import Testing

@testable import VaultCore

@Suite struct FileStateTests {
  @Test func readableAbsentAndFolder() throws {
    let vault = try TestVault()
    try vault.write("Daily/2026-10-08.md", Data("x"))
    #expect(try vault.files.state(of: "Daily/2026-10-08.md") == .readable)
    #expect(try vault.files.state(of: "Daily/2026-10-09.md") == .absent)
    // a missing folder is still a confirmed absence when its existing ancestor can be listed.
    #expect(try vault.files.state(of: "Journal/2026/2026-10-08.md") == .absent)
    if case .unknown = try vault.files.state(of: "Daily") {} else { Issue.record("a folder must not count as a file") }
  }

  @Test func legacyCloudStubIsAPlaceholder() throws {
    let vault = try TestVault()
    try vault.write("Daily/.2026-10-08.md.icloud", Data("stub"))
    #expect(try vault.files.state(of: "Daily/2026-10-08.md") == .placeholder)
  }

  @Test func unlistableFolderIsUnknownNotAbsent() throws {
    let vault = try TestVault()
    try FileManager.default.createDirectory(at: vault.url("Locked"), withIntermediateDirectories: true)
    try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: vault.url("Locked").path)
    if case .unknown = try vault.files.state(of: "Locked/2026-10-08.md") {} else {
      Issue.record("a folder that cannot be listed must not prove absence")
    }
  }

  @Test func revisionsCompareBytes() {
    #expect(FileRevision(data: Data("a")) == FileRevision(data: Data("a")))
    #expect(FileRevision(data: Data("a\n")) != FileRevision(data: Data("a\r\n")))
    #expect(FileRevision(data: Data()).size == 0)
  }
}

@Suite struct VaultFilesTests {
  static let crlfWithBom = Data([0xEF, 0xBB, 0xBF]) + Data("# Title\r\n\r\ncafe\u{301}\r\n")

  @Test func readReturnsExactBytesAndRevision() throws {
    let vault = try TestVault()
    try vault.write("Note.md", Self.crlfWithBom)
    #expect(try vault.files.read("Note.md") == .contents(Self.crlfWithBom, FileRevision(data: Self.crlfWithBom)))
  }

  @Test func readOfMissingOrPlaceholderIsUnavailable() throws {
    let vault = try TestVault()
    #expect(try vault.files.read("Missing.md") == .unavailable(.absent))
    try vault.write(".Cloud.md.icloud", Data("stub"))
    #expect(try vault.files.read("Cloud.md") == .unavailable(.placeholder))
  }

  @Test func createExclusiveMakesFoldersAndNeverReplaces() throws {
    let vault = try TestVault()
    let first = Data("# 2026-10-08\n")
    #expect(try vault.files.createExclusive("Daily/2026/2026-10-08.md", data: first) == .created(FileRevision(data: first)))
    #expect(try vault.bytes("Daily/2026/2026-10-08.md") == first)
    #expect(try vault.files.createExclusive("Daily/2026/2026-10-08.md", data: Data("other")) == .exists)
    #expect(try vault.bytes("Daily/2026/2026-10-08.md") == first)
  }

  @Test func createExclusiveDoesNotReplaceACloudPlaceholder() throws {
    let vault = try TestVault()
    try vault.write("Daily/.2026-10-08.md.icloud", Data("stub"))
    #expect(try vault.files.createExclusive("Daily/2026-10-08.md", data: Data("new")) == .exists)
    #expect(!vault.exists("Daily/2026-10-08.md"))
  }

  @Test func createExclusiveInAnUnlistableFolderCreatesNothing() throws {
    let vault = try TestVault()
    try FileManager.default.createDirectory(at: vault.url("Locked"), withIntermediateDirectories: true)
    try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: vault.url("Locked").path)
    let result = try vault.files.createExclusive("Locked/new.md", data: Data("x"))
    if case .unavailable(.unknown) = result {} else { Issue.record("expected unavailable, got \(result)") }
  }

  @Test func concurrentCreatesProduceExactlyOneFile() async throws {
    let vault = try TestVault()
    let files = vault.files
    let results = try await withThrowingTaskGroup(of: CreateResult.self) { group in
      for index in 0..<16 {
        group.addTask { try files.createExclusive("Daily/2026-10-08.md", data: Data("writer \(index)")) }
      }
      return try await group.reduce(into: []) { $0.append($1) }
    }
    let created = results.compactMap { result -> FileRevision? in
      if case let .created(revision) = result { return revision }
      return nil
    }
    #expect(created.count == 1)
    #expect(results.filter { $0 == .exists }.count == 15)
    #expect(FileRevision(data: try vault.bytes("Daily/2026-10-08.md")) == created.first)
  }

  @Test func createThroughAnEscapingSymlinkIsRefused() throws {
    let vault = try TestVault()
    let elsewhere = vault.outside.appendingPathComponent("elsewhere")
    try FileManager.default.createDirectory(at: elsewhere, withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(at: vault.url("Linked"), withDestinationURL: elsewhere)
    #expect(throws: VaultPathError.outsideVault) { try vault.files.createExclusive("Linked/x.md", data: Data("x")) }
    #expect(try FileManager.default.contentsOfDirectory(atPath: elsewhere.path).isEmpty)
  }

  @Test func saveReplacesOnlyTheExpectedRevision() throws {
    let vault = try TestVault()
    try vault.write("Note.md", Self.crlfWithBom)
    let base = FileRevision(data: Self.crlfWithBom)
    let edited = Self.crlfWithBom + Data("more\r\n")
    #expect(try vault.files.save("Note.md", data: edited, base: base) == .saved(FileRevision(data: edited)))
    #expect(try vault.bytes("Note.md") == edited)
  }

  @Test func saveAfterAnExternalEditIsAConflictAndWritesNothing() throws {
    let vault = try TestVault()
    try vault.write("Note.md", Data("original"))
    let base = FileRevision(data: Data("original"))
    try vault.write("Note.md", Data("changed by another app"))
    #expect(
      try vault.files.save("Note.md", data: Data("my edit"), base: base)
        == .conflict(current: FileRevision(data: Data("changed by another app")))
    )
    #expect(try vault.bytes("Note.md") == Data("changed by another app"))
  }

  @Test func saveToADeletedFileDoesNotRecreateIt() throws {
    let vault = try TestVault()
    try vault.write("Note.md", Data("original"))
    try FileManager.default.removeItem(at: vault.url("Note.md"))
    #expect(try vault.files.save("Note.md", data: Data("edit"), base: FileRevision(data: Data("original"))) == .missing)
    #expect(!vault.exists("Note.md"))
  }

  @Test func saveOfUnchangedBytesSucceedsWithoutWriting() throws {
    let vault = try TestVault()
    let target = try vault.write("Note.md", Data("same"))
    let before = try FileManager.default.attributesOfItem(atPath: target.path)[.modificationDate] as? Date
    Thread.sleep(forTimeInterval: 0.05)
    #expect(try vault.files.save("Note.md", data: Data("same"), base: FileRevision(data: Data("same"))) == .saved(FileRevision(data: Data("same"))))
    let after = try FileManager.default.attributesOfItem(atPath: target.path)[.modificationDate] as? Date
    #expect(before == after)
  }

  @Test func anUnreadableExistingFileIsNeverReplacedByANewNote() throws {
    let vault = try TestVault()
    let target = try vault.write("Daily/2026-10-08.md", Data("private"))
    try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: target.path)
    let result = try vault.files.createExclusive("Daily/2026-10-08.md", data: Data("template"))
    if case .unavailable(.unknown) = result {} else { Issue.record("expected unavailable, got \(result)") }
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: target.path)
    #expect(try vault.bytes("Daily/2026-10-08.md") == Data("private"))
  }

  @Test func aFailedWriteThrowsAndLeavesTheFileUnchanged() throws {
    let vault = try TestVault()
    try vault.write("Locked/Note.md", Data("original"))
    try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: vault.url("Locked").path)
    #expect(throws: (any Error).self) {
      try vault.files.save("Locked/Note.md", data: Data("edit"), base: FileRevision(data: Data("original")))
    }
    #expect(try vault.bytes("Locked/Note.md") == Data("original"))
  }

  @Test func aRenamedFileIsMissingAtItsOldPath() throws {
    let vault = try TestVault()
    try vault.write("Old.md", Data("text"))
    try FileManager.default.moveItem(at: vault.url("Old.md"), to: vault.url("New.md"))
    #expect(try vault.files.save("Old.md", data: Data("edit"), base: FileRevision(data: Data("text"))) == .missing)
    #expect(!vault.exists("Old.md"))
    #expect(try vault.bytes("New.md") == Data("text"))
  }

  @Test func untouchedSiblingsStayByteIdentical() throws {
    let vault = try TestVault()
    try vault.write("A.md", Self.crlfWithBom)
    try vault.write("B.md", Data("b"))
    _ = try vault.files.save("B.md", data: Data("b2"), base: FileRevision(data: Data("b")))
    _ = try vault.files.createExclusive("C.md", data: Data("c"))
    #expect(try vault.bytes("A.md") == Self.crlfWithBom)
  }
}
