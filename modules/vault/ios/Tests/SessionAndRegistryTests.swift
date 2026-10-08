import Foundation
import Testing

@testable import VaultCore

@Suite struct TextCodecTests {
  @Test(arguments: [
    Data("plain\n"),
    Data([0xEF, 0xBB, 0xBF]) + Data("bom\r\n"),
    Data([0xEF, 0xBB, 0xBF, 0xEF, 0xBB, 0xBF]) + Data("two boms"),
    Data("cafe\u{301} and caf\u{E9}\r\nmixed\rnewlines\n"),
    Data("👩‍💻 \u{00A0} \u{200D} 𝔘"),
    Data("replacement char \u{FFFD} written on purpose"),
    Data(),
  ])
  func utf8RoundTripsByteForByte(data: Data) {
    guard case let .editable(text, bom) = TextCodec.decode(data) else {
      Issue.record("valid utf-8 must be editable")
      return
    }
    #expect(TextCodec.encode(text, bom: bom) == data)
  }

  @Test func invalidUtf8IsReadOnly() {
    let latin1 = Data([0x43, 0x61, 0x66, 0xE9, 0x0A])
    guard case let .readOnly(preview, encoding) = TextCodec.decode(latin1) else {
      Issue.record("latin-1 bytes must not be editable")
      return
    }
    #expect(encoding == "unknown")
    #expect(preview.contains("\u{FFFD}"))
  }

  @Test func utf16IsReadOnlyWithAReadablePreview() {
    let utf16 = Data([0xFF, 0xFE]) + "# UTF-16\n".data(using: .utf16LittleEndian)!
    #expect(TextCodec.decode(utf16) == .readOnly(preview: "# UTF-16\n", encoding: "utf-16"))
  }
}

@Suite struct VaultRegistryTests {
  func makeRegistry() throws -> (VaultRegistry, TestVault) {
    let vault = try TestVault()
    let file = vault.outside.appendingPathComponent("app/vaults.json")
    return (VaultRegistry(file: file), vault)
  }

  @Test func addResolveAndForget() throws {
    let (registry, vault) = try makeRegistry()
    let record = try registry.add(url: vault.directory)
    #expect(record.name == "vault")
    let resolved = try registry.resolve(id: record.id)
    #expect(VaultRoot(url: resolved.url).contains(vault.url("note.md")))
    #expect(try registry.records().map(\.id) == [record.id])
    try registry.remove(id: record.id)
    #expect(try registry.records().isEmpty)
    // forgetting a vault never touches its folder.
    #expect(FileManager.default.fileExists(atPath: vault.directory.path))
  }

  @Test func pickingTheSameFolderKeepsItsId() throws {
    let (registry, vault) = try makeRegistry()
    let first = try registry.add(url: vault.directory)
    let again = try registry.add(url: vault.directory.appendingPathComponent("."))
    #expect(again.id == first.id)
    #expect(try registry.records().count == 1)
  }

  @Test func aDeletedFolderIsUnavailableOrResolvesOutside() throws {
    let (registry, vault) = try makeRegistry()
    let other = vault.outside.appendingPathComponent("other")
    try FileManager.default.createDirectory(at: other, withIntermediateDirectories: true)
    let record = try registry.add(url: other)
    try FileManager.default.removeItem(at: other)
    // a removed folder must never silently resolve to a usable, different location.
    if let resolved = try? registry.resolve(id: record.id) {
      #expect(!FileManager.default.fileExists(atPath: resolved.url.path))
    }
  }

  @Test func unknownIdsThrow() throws {
    let (registry, _) = try makeRegistry()
    #expect(throws: VaultRegistryError.unknownVault("missing")) { try registry.resolve(id: "missing") }
  }
}

final class RecordingScope: SecurityScope, @unchecked Sendable {
  private let lock = NSLock()
  private var events: [String] = []

  func start(_ url: URL) -> Bool {
    record("start")
    return true
  }

  func stop(_ url: URL) {
    record("stop")
  }

  func record(_ event: String) {
    lock.lock()
    events.append(event)
    lock.unlock()
  }

  var log: [String] {
    lock.lock()
    defer { lock.unlock() }
    return events
  }
}

final class ResultBox: @unchecked Sendable {
  var value: SaveResult?
}

@Suite struct VaultSessionTests {
  @Test func closeReleasesAccessOnceAndRefusesNewWork() throws {
    let vault = try TestVault()
    let scope = RecordingScope()
    let session = VaultSession(id: "a", url: vault.directory, scope: scope)
    #expect(try session.perform { try $0.state(of: "x.md") } == .absent)
    session.close()
    session.close()
    #expect(scope.log == ["start", "stop"])
    #expect(throws: VaultSessionError.closed) { try session.perform { _ in 1 } }
  }

  @Test func closeWaitsForARunningSave() throws {
    let vault = try TestVault()
    try vault.write("Note.md", Data("before"))
    let scope = RecordingScope()
    let session = VaultSession(id: "a", url: vault.directory, scope: scope)
    let entered = DispatchSemaphore(value: 0)
    let proceed = DispatchSemaphore(value: 0)
    let done = DispatchSemaphore(value: 0)
    let result = ResultBox()
    Thread.detachNewThread {
      result.value = try? session.perform { files in
        entered.signal()
        proceed.wait()
        scope.record("save")
        return try files.save("Note.md", data: Data("after"), base: FileRevision(data: Data("before")))
      }
      done.signal()
    }
    entered.wait()
    session.close()
    #expect(!session.isReleased)
    proceed.signal()
    done.wait()
    #expect(session.isReleased)
    #expect(scope.log == ["start", "save", "stop"])
    #expect(result.value == .saved(FileRevision(data: Data("after"))))
  }
}
