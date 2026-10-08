import Foundation

/// a vault the user picked. the id is stable across launches and keys app-owned settings and
/// bookmarks (ktd7); the bookmark restores folder access without storing a bare path (r1).
public struct VaultRecord: Codable, Equatable, Sendable {
  public let id: String
  public var name: String
  public var bookmark: Data
  public let addedAt: Date
}

public protocol BookmarkCodec: Sendable {
  func bookmark(for url: URL) throws -> Data
  func resolve(_ bookmark: Data) throws -> (url: URL, isStale: Bool)
}

/// the platform's bookmark format. on ios a url from the folder picker yields a security-scoped
/// bookmark; the url must be accessed while the bookmark is created.
public struct SystemBookmarkCodec: BookmarkCodec {
  public init() {}

  public func bookmark(for url: URL) throws -> Data {
    #if os(iOS)
      return try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
    #else
      return try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
    #endif
  }

  public func resolve(_ bookmark: Data) throws -> (url: URL, isStale: Bool) {
    var isStale = false
    let url = try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &isStale)
    return (url, isStale)
  }
}

public enum VaultRegistryError: Error, Equatable, Sendable {
  case unknownVault(String)
  /// the bookmark no longer resolves, for example after the folder was deleted or access was
  /// revoked. the user must pick the folder again.
  case unavailable(id: String, reason: String)
}

/// app-private list of picked vaults, stored as one json file outside every vault (r16).
public final class VaultRegistry: @unchecked Sendable {
  private let file: URL
  private let codec: BookmarkCodec
  private let lock = NSLock()

  public init(file: URL, codec: BookmarkCodec = SystemBookmarkCodec()) {
    self.file = file
    self.codec = codec
  }

  public func records() throws -> [VaultRecord] {
    try locked { try load() }
  }

  /// registers a picked folder. picking a folder that is already registered keeps its id, so
  /// its settings and bookmarks survive, and refreshes its bookmark.
  public func add(url: URL, now: Date = Date()) throws -> VaultRecord {
    try locked {
      var all = try load()
      let bookmark = try codec.bookmark(for: url)
      let path = VaultRoot.canonicalComponents(of: url)
      if let index = all.firstIndex(where: { record in
        (try? codec.resolve(record.bookmark)).map { VaultRoot.canonicalComponents(of: $0.url) == path } ?? false
      }) {
        all[index].bookmark = bookmark
        all[index].name = url.lastPathComponent
        try store(all)
        return all[index]
      }
      let record = VaultRecord(id: UUID().uuidString, name: url.lastPathComponent, bookmark: bookmark, addedAt: now)
      all.append(record)
      try store(all)
      return record
    }
  }

  /// resolves a vault's folder. a stale bookmark is reported so the caller can refresh it
  /// with `refresh` while it has access.
  public func resolve(id: String) throws -> (record: VaultRecord, url: URL, isStale: Bool) {
    try locked {
      guard let record = try load().first(where: { $0.id == id }) else {
        throw VaultRegistryError.unknownVault(id)
      }
      do {
        let resolved = try codec.resolve(record.bookmark)
        return (record, resolved.url, resolved.isStale)
      } catch {
        throw VaultRegistryError.unavailable(id: id, reason: error.localizedDescription)
      }
    }
  }

  public func refresh(id: String, url: URL) throws {
    try locked {
      var all = try load()
      guard let index = all.firstIndex(where: { $0.id == id }) else {
        throw VaultRegistryError.unknownVault(id)
      }
      all[index].bookmark = try codec.bookmark(for: url)
      try store(all)
    }
  }

  /// forgets a vault. its folder and notes are not touched.
  public func remove(id: String) throws {
    try locked {
      try store(try load().filter { $0.id != id })
    }
  }

  private func locked<T>(_ body: () throws -> T) rethrows -> T {
    lock.lock()
    defer { lock.unlock() }
    return try body()
  }

  private func load() throws -> [VaultRecord] {
    guard FileManager.default.fileExists(atPath: file.path) else {
      return []
    }
    return try JSONDecoder().decode([VaultRecord].self, from: Data(contentsOf: file))
  }

  private func store(_ records: [VaultRecord]) throws {
    try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try JSONEncoder().encode(records).write(to: file, options: .atomic)
  }
}
