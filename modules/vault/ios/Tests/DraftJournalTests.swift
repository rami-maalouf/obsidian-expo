import Foundation
import Testing

@testable import VaultCore

@Suite struct DraftJournalTests {
  func makeJournal() throws -> (DraftJournal, URL) {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("journal-\(UUID().uuidString)")
    return (try DraftJournal(directory: directory), directory)
  }

  func record(_ text: String, sequence: Int, path: String = "Daily/2026-10-08.md") -> DraftRecord {
    DraftRecord(
      vaultId: "vault-a",
      path: path,
      base: FileRevision(data: Data("base")),
      contents: Data(text),
      sequence: sequence,
      updatedAt: Date(timeIntervalSince1970: 1_791_000_000)
    )
  }

  @Test func checkpointRoundTripsExactBytes() throws {
    let (journal, directory) = try makeJournal()
    defer { try? FileManager.default.removeItem(at: directory) }
    let draft = DraftRecord(
      vaultId: "vault-a",
      path: "Résumé.md",
      base: nil,
      contents: Data([0xEF, 0xBB, 0xBF]) + Data("line\r\ncafe\u{301}"),
      sequence: 1,
      updatedAt: Date(timeIntervalSince1970: 1_791_000_000)
    )
    try journal.checkpoint(draft)
    #expect(try journal.load(vaultId: "vault-a", path: "Résumé.md") == draft)
    #expect(try journal.load(vaultId: "vault-b", path: "Résumé.md") == nil)
    // no temporary files are left behind.
    #expect(try FileManager.default.contentsOfDirectory(atPath: directory.path).allSatisfy { $0.hasSuffix(".draft.json") })
  }

  @Test func olderCheckpointsNeverReplaceNewerOnes() throws {
    let (journal, directory) = try makeJournal()
    defer { try? FileManager.default.removeItem(at: directory) }
    try journal.checkpoint(record("second", sequence: 2))
    #expect(throws: DraftJournalError.staleCheckpoint(stored: 2, attempted: 1)) { try journal.checkpoint(record("first", sequence: 1)) }
    #expect(throws: DraftJournalError.staleCheckpoint(stored: 2, attempted: 2)) { try journal.checkpoint(record("again", sequence: 2)) }
    try journal.checkpoint(record("third", sequence: 3))
    #expect(try journal.load(vaultId: "vault-a", path: "Daily/2026-10-08.md")?.contents == Data("third"))
  }

  @Test func discardKeepsANewerCheckpoint() throws {
    let (journal, directory) = try makeJournal()
    defer { try? FileManager.default.removeItem(at: directory) }
    try journal.checkpoint(record("saved", sequence: 4))
    try journal.checkpoint(record("typed after the save started", sequence: 5))
    #expect(try journal.discard(vaultId: "vault-a", path: "Daily/2026-10-08.md", through: 4) == false)
    #expect(try journal.load(vaultId: "vault-a", path: "Daily/2026-10-08.md")?.sequence == 5)
    #expect(try journal.discard(vaultId: "vault-a", path: "Daily/2026-10-08.md", through: 5) == true)
    #expect(try journal.load(vaultId: "vault-a", path: "Daily/2026-10-08.md") == nil)
  }

  @Test func allListsDraftsAndReportsUnreadableOnes() throws {
    let (journal, directory) = try makeJournal()
    defer { try? FileManager.default.removeItem(at: directory) }
    try journal.checkpoint(record("b", sequence: 1, path: "B.md"))
    try journal.checkpoint(record("a", sequence: 1, path: "A.md"))
    try Data("not json").write(to: directory.appendingPathComponent("broken.draft.json"))
    let listing = try journal.all()
    #expect(listing.drafts.map(\.path) == ["A.md", "B.md"])
    #expect(listing.unreadable == ["broken.draft.json"])
  }

  @Test func aFailedCheckpointThrowsAndKeepsThePreviousDraft() throws {
    let (journal, directory) = try makeJournal()
    defer {
      try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: directory.path)
      try? FileManager.default.removeItem(at: directory)
    }
    try journal.checkpoint(record("kept", sequence: 1))
    try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: directory.path)
    #expect(throws: (any Error).self) { try journal.checkpoint(record("lost", sequence: 2)) }
    #expect(try journal.load(vaultId: "vault-a", path: "Daily/2026-10-08.md")?.contents == Data("kept"))
  }
}
