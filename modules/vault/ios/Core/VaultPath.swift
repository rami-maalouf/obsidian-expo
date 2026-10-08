import Foundation

/// reasons a vault-relative path is refused before any file access.
public enum VaultPathError: Error, Equatable, Sendable {
  case empty
  case absolute
  case invalidSegment(String)
  case hiddenSegment(String)
  case outsideVault
}

/// the root folder of an opened vault. every operation takes a vault-relative path and resolves
/// it here, so javascript never supplies an absolute path.
public struct VaultRoot: Sendable {
  /// the root as given, used to build file urls.
  public let url: URL
  /// the root's canonical path components, used for containment checks.
  private let components: [String]

  public init(url: URL) {
    self.url = url.standardizedFileURL
    components = VaultRoot.canonicalComponents(of: url)
  }

  /// splits and validates a vault-relative path such as `Daily/2026-10-08.md`.
  public static func segments(of relativePath: String) throws -> [String] {
    if relativePath.isEmpty {
      throw VaultPathError.empty
    }
    if relativePath.hasPrefix("/") {
      throw VaultPathError.absolute
    }
    let segments = relativePath.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    for segment in segments {
      if segment.isEmpty || segment == "." || segment == ".." || segment.contains("\0") {
        throw VaultPathError.invalidSegment(segment)
      }
      // hidden items include .obsidian and .trash, which the app never modifies (r16).
      if segment.hasPrefix(".") {
        throw VaultPathError.hiddenSegment(segment)
      }
    }
    return segments
  }

  /// resolves a vault-relative path to a url inside the vault.
  ///
  /// every symlink on the way, including dangling ones, and the deepest existing ancestor must
  /// resolve inside the root, so a symlink cannot redirect reads or writes outside the vault.
  /// call this again inside each coordinated operation, because the tree can change in between.
  public func resolve(_ relativePath: String) throws -> URL {
    let fileManager = FileManager.default
    var candidate = url
    for segment in try VaultRoot.segments(of: relativePath) {
      candidate.appendPathComponent(segment)
      if let destination = try? fileManager.destinationOfSymbolicLink(atPath: candidate.path) {
        let target = destination.hasPrefix("/")
          ? URL(fileURLWithPath: destination)
          : candidate.deletingLastPathComponent().appendingPathComponent(destination)
        if !contains(target) {
          throw VaultPathError.outsideVault
        }
      }
    }
    var existing = candidate
    while !fileManager.fileExists(atPath: existing.path), existing.pathComponents.count > url.pathComponents.count {
      existing.deleteLastPathComponent()
    }
    if !contains(existing) {
      throw VaultPathError.outsideVault
    }
    return candidate
  }

  /// the vault-relative path of a url inside the vault, or nil when it is outside.
  public func relativePath(of other: URL) -> String? {
    let path = VaultRoot.canonicalComponents(of: other)
    guard isPrefix(path) else {
      return nil
    }
    return path.dropFirst(components.count).joined(separator: "/")
  }

  public func contains(_ other: URL) -> Bool {
    isPrefix(VaultRoot.canonicalComponents(of: other))
  }

  private func isPrefix(_ path: [String]) -> Bool {
    path.count >= components.count && Array(path.prefix(components.count)) == components
  }

  /// resolves symlinks and `..`, and drops the `/private` prefix that the system adds or removes
  /// depending on whether the path exists (`/var` and `/tmp` are links into `/private`).
  static func canonicalComponents(of url: URL) -> [String] {
    var path = url.standardizedFileURL.resolvingSymlinksInPath().standardizedFileURL.pathComponents
    if path.count > 1, path[1] == "private" {
      path.remove(at: 1)
    }
    return path
  }
}
