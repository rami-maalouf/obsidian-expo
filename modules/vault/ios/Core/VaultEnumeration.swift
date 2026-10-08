import Foundation

/// a markdown file found by enumeration. contents are not read or downloaded.
public struct VaultEntry: Equatable, Sendable {
  public let path: String
  public let size: Int?
  public let modified: Date?
  /// `.readable` or `.placeholder`.
  public let state: FileState
}

public struct EnumerationSummary: Equatable, Sendable {
  public let notes: Int
  /// vault-relative folders that could not be listed; results are incomplete when non-empty.
  public let unreadableFolders: [String]
  /// true when the handler stopped the enumeration early.
  public let stopped: Bool
}

extension VaultFiles {
  /// lists markdown files in batches without reading or downloading them, so filenames are
  /// known before content indexing (ktd4). hidden folders such as .obsidian and all symlinks
  /// are skipped. return false from `handle` to stop. run this off the main thread.
  public func enumerateNotes(batchSize: Int = 500, _ handle: ([VaultEntry]) -> Bool) -> EnumerationSummary {
    let keys: [URLResourceKey] = [
      .isDirectoryKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey,
      .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey,
    ]
    var unreadable: [String] = []
    let enumerator = FileManager.default.enumerator(
      at: root.url,
      includingPropertiesForKeys: keys,
      options: [.skipsPackageDescendants],
      errorHandler: { [root] url, _ in
        unreadable.append(root.relativePath(of: url) ?? url.lastPathComponent)
        return true
      }
    )
    guard let enumerator else {
      return EnumerationSummary(notes: 0, unreadableFolders: [""], stopped: false)
    }
    let rootComponents = root.url.pathComponents
    var batch: [VaultEntry] = []
    var count = 0
    var stopped = false

    for case let url as URL in enumerator {
      let name = url.lastPathComponent
      let values = try? url.resourceValues(forKeys: Set(keys))
      if values?.isSymbolicLink == true {
        continue
      }
      if values?.isDirectory == true {
        if name.hasPrefix(".") {
          enumerator.skipDescendants()
        }
        continue
      }
      var noteName = name
      var state = FileState.readable
      if name.hasPrefix(".") {
        // older iCloud versions replace an evicted `Note.md` with a hidden `.Note.md.icloud`.
        guard name.hasSuffix(".icloud"), name.count > ".x.icloud".count else {
          continue
        }
        noteName = String(name.dropFirst().dropLast(".icloud".count))
        state = .placeholder
      } else if values?.isUbiquitousItem == true, values?.ubiquitousItemDownloadingStatus == .notDownloaded {
        state = .placeholder
      }
      guard noteName.lowercased().hasSuffix(".md"), !noteName.hasPrefix(".") else {
        continue
      }
      let components = url.deletingLastPathComponent().appendingPathComponent(noteName).pathComponents
      let path: String? = Array(components.prefix(rootComponents.count)) == rootComponents
        ? components.dropFirst(rootComponents.count).joined(separator: "/")
        : root.relativePath(of: url.deletingLastPathComponent().appendingPathComponent(noteName))
      guard let path else {
        continue
      }
      batch.append(VaultEntry(
        path: path,
        size: state == .readable ? values?.fileSize : nil,
        modified: values?.contentModificationDate,
        state: state
      ))
      count += 1
      if batch.count >= batchSize {
        let keepGoing = handle(batch)
        batch.removeAll(keepingCapacity: true)
        if !keepGoing {
          stopped = true
          break
        }
      }
    }
    if !stopped, !batch.isEmpty, !handle(batch) {
      stopped = true
    }
    return EnumerationSummary(notes: count, unreadableFolders: unreadable.sorted(), stopped: stopped)
  }
}
