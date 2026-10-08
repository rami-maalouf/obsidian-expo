import Foundation
import Testing

@testable import VaultCore

final class StatusLog: @unchecked Sendable {
  private let lock = NSLock()
  private var values: [DocumentStatus] = []

  func append(_ status: DocumentStatus) {
    lock.lock()
    values.append(status)
    lock.unlock()
  }

  var all: [DocumentStatus] {
    lock.lock()
    defer { lock.unlock() }
    return values
  }
}

/// a vault, a journal, and a factory for document sessions that share them.
final class DocumentHarness {
  let vault: TestVault
  let session: VaultSession
  let journal: DraftJournal
  let journalDirectory: URL

  init() throws {
    vault = try TestVault()
    session = VaultSession(id: "v1", url: vault.directory)
    journalDirectory = vault.outside.appendingPathComponent("journal")
    journal = try DraftJournal(directory: journalDirectory)
  }

  func open(_ path: String, log: StatusLog = StatusLog()) -> DocumentSession {
    DocumentSession(vaultId: "v1", path: path, session: session, journal: journal) { log.append($0) }
  }
}

@Suite struct DocumentSessionTests {
  static let crlf = Data([0xEF, 0xBB, 0xBF]) + Data("# Title\r\n\r\nbody\r\n")

  @Test func loadsTextBomAndNewlineConvention() throws {
    let harness = try DocumentHarness()
    try harness.vault.write("Note.md", Self.crlf)
    let document = harness.open("Note.md")
    guard case let .loaded(loaded) = document.load() else {
      Issue.record("expected a loaded document")
      return
    }
    #expect(loaded.text == "# Title\r\n\r\nbody\r\n")
    #expect(loaded.bom)
    #expect(loaded.newline == "\r\n")
    #expect(loaded.revision == FileRevision(data: Self.crlf))
    #expect(!loaded.restoredDraft)
    #expect(document.status == .clean)
  }

  @Test func editsAreCheckpointedThenSavedByteForByte() throws {
    let harness = try DocumentHarness()
    try harness.vault.write("Note.md", Self.crlf)
    let log = StatusLog()
    let document = harness.open("Note.md", log: log)
    _ = document.load()
    document.update(text: "# Title\r\n\r\nbody\r\nmore\r\n")
    document.persist()
    document.waitUntilIdle()
    #expect(try harness.vault.bytes("Note.md") == Data([0xEF, 0xBB, 0xBF]) + Data("# Title\r\n\r\nbody\r\nmore\r\n"))
    #expect(document.status == .clean)
    #expect(log.all == [.clean, .dirty, .journaled, .saving, .clean])
    #expect(try harness.journal.all().drafts.isEmpty)
  }

  @Test func aDraftSurvivesAProcessRestartAndIsSavedLater() throws {
    let harness = try DocumentHarness()
    try harness.vault.write("Note.md", Data("v1"))
    // the first process journals an edit but stops before saving.
    try harness.journal.checkpoint(DraftRecord(
      vaultId: "v1", path: "Note.md", base: FileRevision(data: Data("v1")),
      contents: Data("v1 + unsaved"), sequence: 3, updatedAt: Date()
    ))
    let document = harness.open("Note.md")
    guard case let .loaded(loaded) = document.load() else {
      Issue.record("expected the draft to be restored")
      return
    }
    #expect(loaded.text == "v1 + unsaved")
    #expect(loaded.restoredDraft)
    document.persist()
    document.waitUntilIdle()
    #expect(try harness.vault.bytes("Note.md") == Data("v1 + unsaved"))
    #expect(try harness.journal.all().drafts.isEmpty)
  }

  @Test func aDraftWhoseFileChangedNeedsRecoveryAndKeepsBothVersions() throws {
    let harness = try DocumentHarness()
    try harness.vault.write("Note.md", Data("changed elsewhere"))
    let draft = DraftRecord(
      vaultId: "v1", path: "Note.md", base: FileRevision(data: Data("original")),
      contents: Data("my edit"), sequence: 1, updatedAt: Date(timeIntervalSince1970: 1_791_000_000)
    )
    try harness.journal.checkpoint(draft)
    #expect(harness.open("Note.md").load() == .recoveryNeeded(draft: draft, disk: FileRevision(data: Data("changed elsewhere"))))
    #expect(try harness.vault.bytes("Note.md") == Data("changed elsewhere"))
    #expect(try harness.journal.load(vaultId: "v1", path: "Note.md") == draft)
  }

  @Test func anExternalEditWhileDirtyIsAConflictAndWritesNothing() throws {
    let harness = try DocumentHarness()
    try harness.vault.write("Note.md", Data("original"))
    let document = harness.open("Note.md")
    _ = document.load()
    try harness.vault.write("Note.md", Data("changed elsewhere"))
    document.update(text: "my edit")
    document.persist()
    document.waitUntilIdle()
    #expect(document.status == .conflict(disk: FileRevision(data: Data("changed elsewhere"))))
    #expect(try harness.vault.bytes("Note.md") == Data("changed elsewhere"))
    #expect(try harness.journal.load(vaultId: "v1", path: "Note.md")?.contents == Data("my edit"))
    // further edits stay in the journal while the conflict is open.
    document.update(text: "my edit 2")
    document.persist()
    document.waitUntilIdle()
    #expect(try harness.vault.bytes("Note.md") == Data("changed elsewhere"))
    #expect(try harness.journal.load(vaultId: "v1", path: "Note.md")?.contents == Data("my edit 2"))
  }

  @Test func aCleanDocumentFollowsAnExternalEditOnReconcile() async throws {
    let harness = try DocumentHarness()
    try harness.vault.write("Note.md", Data("original"))
    let document = harness.open("Note.md")
    _ = document.load()
    try harness.vault.write("Note.md", Data("from obsidian"))
    let text = await withCheckedContinuation { continuation in
      document.reconcile { continuation.resume(returning: $0) }
    }
    #expect(text == "from obsidian")
    #expect(document.status == .clean)
    document.update(text: "from obsidian + mine")
    document.persist()
    document.waitUntilIdle()
    #expect(try harness.vault.bytes("Note.md") == Data("from obsidian + mine"))
  }

  @Test func aDirtyDocumentDoesNotFollowAnExternalEdit() async throws {
    let harness = try DocumentHarness()
    try harness.vault.write("Note.md", Data("original"))
    let document = harness.open("Note.md")
    _ = document.load()
    document.update(text: "unsaved")
    try harness.vault.write("Note.md", Data("from obsidian"))
    let text = await withCheckedContinuation { continuation in
      document.reconcile { continuation.resume(returning: $0) }
    }
    #expect(text == nil)
    #expect(document.status == .conflict(disk: FileRevision(data: Data("from obsidian"))))
  }

  @Test func aDeletedFileIsMissingAndTheDraftIsKept() throws {
    let harness = try DocumentHarness()
    try harness.vault.write("Note.md", Data("original"))
    let document = harness.open("Note.md")
    _ = document.load()
    try FileManager.default.removeItem(at: harness.vault.url("Note.md"))
    document.update(text: "edit")
    document.persist()
    document.waitUntilIdle()
    #expect(document.status == .missing)
    #expect(!harness.vault.exists("Note.md"))
    #expect(try harness.journal.load(vaultId: "v1", path: "Note.md")?.contents == Data("edit"))
  }

  @Test func nonUtf8FilesAreReadOnlyAndNeverWritten() throws {
    let harness = try DocumentHarness()
    let latin1 = Data([0x43, 0x61, 0x66, 0xE9, 0x0A])
    try harness.vault.write("Latin.md", latin1)
    let document = harness.open("Latin.md")
    guard case .readOnly(_, "unknown") = document.load() else {
      Issue.record("expected read-only")
      return
    }
    document.update(text: "Café\n")
    document.persist()
    document.waitUntilIdle()
    #expect(try harness.vault.bytes("Latin.md") == latin1)
    #expect(try harness.journal.all().drafts.isEmpty)
  }

  @Test func aFailedCheckpointIsReportedAndTheFileIsNotTouched() throws {
    let harness = try DocumentHarness()
    try harness.vault.write("Note.md", Data("original"))
    let document = harness.open("Note.md")
    _ = document.load()
    try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: harness.journalDirectory.path)
    defer { try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: harness.journalDirectory.path) }
    document.update(text: "edit")
    document.persist()
    document.waitUntilIdle()
    if case .checkpointFailed = document.status {} else { Issue.record("expected checkpointFailed, got \(document.status)") }
    #expect(try harness.vault.bytes("Note.md") == Data("original"))
  }

  @Test func aDraftForANewNoteIsCreatedNotOverwritten() throws {
    let harness = try DocumentHarness()
    try harness.journal.checkpoint(DraftRecord(
      vaultId: "v1", path: "New.md", base: nil, contents: Data("draft"), sequence: 1, updatedAt: Date()
    ))
    let document = harness.open("New.md")
    guard case let .loaded(loaded) = document.load() else {
      Issue.record("expected the new-note draft to be restored")
      return
    }
    #expect(loaded.revision == nil)
    // another app creates the note before our save.
    try harness.vault.write("New.md", Data("someone else"))
    document.persist()
    document.waitUntilIdle()
    #expect(document.status == .conflict(disk: nil))
    #expect(try harness.vault.bytes("New.md") == Data("someone else"))
  }

  @Test(arguments: [
    ("one line", "\n"),
    ("a\nb\r\nc", "\n"),
    ("a\r\nb\nc", "\r\n"),
    ("a\rb", "\r"),
    ("ends with return\r", "\r"),
  ])
  func newlineFollowsTheFirstLineBreak(text: String, expected: String) {
    #expect(DocumentSession.newline(of: text) == expected)
  }
}
