import Foundation

@testable import VaultCore

/// a disposable vault in the temporary directory, removed when the test ends.
final class TestVault {
  let directory: URL
  let root: VaultRoot
  let files: VaultFiles

  init() throws {
    let base = FileManager.default.temporaryDirectory.appendingPathComponent("vault-core-\(UUID().uuidString)")
    directory = base.appendingPathComponent("vault")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    root = VaultRoot(url: directory)
    files = VaultFiles(root: root)
  }

  deinit {
    let base = directory.deletingLastPathComponent()
    // restore permissions changed by a test so cleanup succeeds.
    if let enumerator = FileManager.default.enumerator(atPath: base.path) {
      for case let path as String in enumerator {
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: base.appendingPathComponent(path).path)
      }
    }
    try? FileManager.default.removeItem(at: base)
  }

  /// the folder that contains the vault, for creating things outside it.
  var outside: URL { directory.deletingLastPathComponent() }

  func url(_ path: String) -> URL {
    path.split(separator: "/").reduce(directory) { $0.appendingPathComponent(String($1)) }
  }

  @discardableResult
  func write(_ path: String, _ data: Data) throws -> URL {
    let target = url(path)
    try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: target)
    return target
  }

  func bytes(_ path: String) throws -> Data {
    try Data(contentsOf: url(path))
  }

  func exists(_ path: String) -> Bool {
    FileManager.default.fileExists(atPath: url(path).path)
  }
}

extension Data {
  init(_ text: String) {
    self = text.data(using: .utf8)!
  }
}
