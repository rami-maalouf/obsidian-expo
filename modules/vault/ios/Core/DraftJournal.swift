import CryptoKit
import Foundation

/// one recoverable draft: the exact bytes to save, the revision they were edited from, and the
/// document they belong to (persistence protocol).
public struct DraftRecord: Codable, Equatable, Sendable {
  public let vaultId: String
  public let path: String
  /// the on-disk revision the draft started from; nil when the note does not exist yet.
  public let base: FileRevision?
  public let contents: Data
  /// increases with every checkpoint of the same document, so an older one never wins.
  public let sequence: Int
  public let updatedAt: Date

  public init(vaultId: String, path: String, base: FileRevision?, contents: Data, sequence: Int, updatedAt: Date) {
    self.vaultId = vaultId
    self.path = path
    self.base = base
    self.contents = contents
    self.sequence = sequence
    self.updatedAt = updatedAt
  }
}

public enum DraftJournalError: Error, Equatable, Sendable {
  /// a checkpoint with the same or a newer sequence is already stored.
  case staleCheckpoint(stored: Int, attempted: Int)
  case io(String)
}

/// app-private storage for unsaved drafts, outside the vault (r16). a checkpoint returns only
/// after its bytes and the rename are flushed, so a returned call is a durable acknowledgement.
public final class DraftJournal: @unchecked Sendable {
  public let directory: URL
  private let lock = NSLock()
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  public init(directory: URL) throws {
    self.directory = directory
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: DraftJournal.protection)
  }

  public func checkpoint(_ record: DraftRecord) throws {
    try locked {
      let url = fileURL(vaultId: record.vaultId, path: record.path)
      if let stored = try? read(url), stored.sequence >= record.sequence {
        throw DraftJournalError.staleCheckpoint(stored: stored.sequence, attempted: record.sequence)
      }
      try durableWrite(try encoder.encode(record), to: url)
    }
  }

  public func load(vaultId: String, path: String) throws -> DraftRecord? {
    try locked {
      let url = fileURL(vaultId: vaultId, path: path)
      return FileManager.default.fileExists(atPath: url.path) ? try read(url) : nil
    }
  }

  /// every stored draft, plus the files that could not be decoded. unreadable drafts are
  /// reported rather than dropped, so recovery can say that something was not restored.
  public func all() throws -> (drafts: [DraftRecord], unreadable: [String]) {
    try locked {
      var drafts: [DraftRecord] = []
      var unreadable: [String] = []
      for name in try FileManager.default.contentsOfDirectory(atPath: directory.path) where name.hasSuffix(".draft.json") {
        if let record = try? read(directory.appendingPathComponent(name)) {
          drafts.append(record)
        } else {
          unreadable.append(name)
        }
      }
      return (drafts.sorted { ($0.vaultId, $0.path) < ($1.vaultId, $1.path) }, unreadable.sorted())
    }
  }

  /// removes a draft after a verified save or an explicit discard. a newer checkpoint than
  /// `sequence` is kept. returns whether a draft was removed.
  @discardableResult
  public func discard(vaultId: String, path: String, through sequence: Int) throws -> Bool {
    try locked {
      let url = fileURL(vaultId: vaultId, path: path)
      guard let stored = try? read(url), stored.sequence <= sequence else {
        return false
      }
      try FileManager.default.removeItem(at: url)
      DraftJournal.syncFolder(directory)
      return true
    }
  }

  // MARK: - helpers

  private static var protection: [FileAttributeKey: Any]? {
    #if os(iOS)
      return [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
    #else
      return nil
    #endif
  }

  private func locked<T>(_ body: () throws -> T) rethrows -> T {
    lock.lock()
    defer { lock.unlock() }
    return try body()
  }

  private func fileURL(vaultId: String, path: String) -> URL {
    let key = SHA256.hash(data: Data("\(vaultId)\u{0}\(path)".utf8)).map { String(format: "%02x", $0) }.joined()
    return directory.appendingPathComponent("\(key).draft.json")
  }

  private func read(_ url: URL) throws -> DraftRecord {
    try decoder.decode(DraftRecord.self, from: Data(contentsOf: url))
  }

  /// writes a temporary file, flushes it, renames it over the target, then flushes the folder.
  private func durableWrite(_ data: Data, to url: URL) throws {
    let temporary = directory.appendingPathComponent(".\(UUID().uuidString).tmp")
    guard FileManager.default.createFile(atPath: temporary.path, contents: nil, attributes: DraftJournal.protection) else {
      throw DraftJournalError.io("could not create a temporary draft file")
    }
    do {
      let handle = try FileHandle(forWritingTo: temporary)
      defer { try? handle.close() }
      try handle.write(contentsOf: data)
      try handle.synchronize()
      if rename(temporary.path, url.path) != 0 {
        throw DraftJournalError.io(String(cString: strerror(errno)))
      }
    } catch {
      try? FileManager.default.removeItem(at: temporary)
      throw error
    }
    DraftJournal.syncFolder(directory)
  }

  private static func syncFolder(_ folder: URL) {
    let descriptor = open(folder.path, O_RDONLY)
    if descriptor >= 0 {
      fsync(descriptor)
      close(descriptor)
    }
  }
}
