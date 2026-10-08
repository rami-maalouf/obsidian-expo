import CryptoKit
import Foundation

/// identifies file contents: two revisions are equal exactly when the bytes are equal.
public struct FileRevision: Equatable, Codable, Sendable {
  public let sha256: String
  public let size: Int

  public init(sha256: String, size: Int) {
    self.sha256 = sha256
    self.size = size
  }

  public init(data: Data) {
    self.init(sha256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), size: data.count)
  }
}

/// what is known about a path before reading or creating it (r4).
public enum FileState: Equatable, Sendable {
  case readable
  /// exists in the cloud but is not downloaded. never treated as absent.
  case placeholder
  /// positively confirmed not to exist.
  case absent
  /// permission, availability, or type could not be established.
  case unknown(String)
}

public enum FileStateProbe {
  /// the hidden stub older iCloud versions leave in place of an evicted file.
  public static func legacyPlaceholder(for url: URL) -> URL {
    url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).icloud")
  }

  public static func state(of url: URL, fileManager: FileManager = .default) -> FileState {
    var isDirectory: ObjCBool = false
    if fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory) {
      if isDirectory.boolValue {
        return .unknown("a folder exists at this path")
      }
      let values = try? url.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey])
      if values?.isUbiquitousItem == true, values?.ubiquitousItemDownloadingStatus == .notDownloaded {
        return .placeholder
      }
      return fileManager.isReadableFile(atPath: url.path) ? .readable : .unknown("the file is not readable")
    }
    if fileManager.fileExists(atPath: legacyPlaceholder(for: url).path) {
      return .placeholder
    }
    // absence is trusted only when the nearest existing ancestor folder can be listed.
    var ancestor = url.deletingLastPathComponent()
    while !fileManager.fileExists(atPath: ancestor.path, isDirectory: &isDirectory) {
      if ancestor.pathComponents.count <= 1 {
        return .unknown("no parent folder exists")
      }
      ancestor.deleteLastPathComponent()
    }
    if !isDirectory.boolValue {
      return .unknown("\(ancestor.lastPathComponent) is a file, not a folder")
    }
    do {
      _ = try fileManager.contentsOfDirectory(atPath: ancestor.path)
      return .absent
    } catch {
      return .unknown("the folder \(ancestor.lastPathComponent) cannot be listed")
    }
  }
}
