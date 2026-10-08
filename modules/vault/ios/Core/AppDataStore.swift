import CryptoKit
import Foundation

/// small app-owned values such as per-vault settings and bookmarks, stored as one file per key
/// in app-private storage, outside every vault (r16, ktd7).
public final class AppDataStore: @unchecked Sendable {
  public let directory: URL
  private let lock = NSLock()

  public init(directory: URL) {
    self.directory = directory
  }

  public func read(_ key: String) throws -> String? {
    lock.lock()
    defer { lock.unlock() }
    let url = fileURL(key)
    guard FileManager.default.fileExists(atPath: url.path) else {
      return nil
    }
    return String(decoding: try Data(contentsOf: url), as: UTF8.self)
  }

  /// replaces the value atomically; nil removes it.
  public func write(_ key: String, _ value: String?) throws {
    lock.lock()
    defer { lock.unlock() }
    let url = fileURL(key)
    guard let value else {
      if FileManager.default.fileExists(atPath: url.path) {
        try FileManager.default.removeItem(at: url)
      }
      return
    }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try Data(value.utf8).write(to: url, options: .atomic)
  }

  private func fileURL(_ key: String) -> URL {
    let name = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    return directory.appendingPathComponent("\(name).json")
  }
}
