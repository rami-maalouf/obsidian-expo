import Foundation

public enum ReadResult: Equatable, Sendable {
  case contents(Data, FileRevision)
  case unavailable(FileState)
}

public enum CreateResult: Equatable, Sendable {
  case created(FileRevision)
  /// a readable file or a cloud placeholder already exists; nothing was written.
  case exists
  case unavailable(FileState)
}

public enum SaveResult: Equatable, Sendable {
  case saved(FileRevision)
  /// the file on disk no longer matches the base revision; nothing was written.
  case conflict(current: FileRevision)
  /// the file was deleted; it is never recreated silently.
  case missing
  case unavailable(FileState)
}

public enum VaultFileError: Error, Equatable, Sendable {
  case coordination(String)
  case io(String)
}

/// coordinated file operations on vault-relative paths. callers run these off the main thread.
public final class VaultFiles: @unchecked Sendable {
  public let root: VaultRoot
  private let fileManager = FileManager()

  public init(root: VaultRoot) {
    self.root = root
  }

  public func state(of path: String) throws -> FileState {
    FileStateProbe.state(of: try root.resolve(path), fileManager: fileManager)
  }

  public func read(_ path: String) throws -> ReadResult {
    let url = try root.resolve(path)
    let state = FileStateProbe.state(of: url, fileManager: fileManager)
    guard state == .readable else {
      if state == .placeholder {
        // ask the provider to download; the caller shows unavailable and retries later.
        try? fileManager.startDownloadingUbiquitousItem(at: url)
      }
      return .unavailable(state)
    }
    var result = ReadResult.unavailable(.absent)
    try coordinate(reading: url) { readURL in
      _ = try self.root.resolve(path)
      let data = try Data(contentsOf: readURL)
      result = .contents(data, FileRevision(data: data))
    }
    return result
  }

  /// creates a new file and any missing parent folders, never replacing an existing file.
  public func createExclusive(_ path: String, data: Data) throws -> CreateResult {
    let url = try root.resolve(path)
    var result = CreateResult.exists
    try coordinate(writing: url, options: []) { writeURL in
      _ = try self.root.resolve(path)
      switch FileStateProbe.state(of: writeURL, fileManager: self.fileManager) {
      case .absent:
        break
      case .readable, .placeholder:
        result = .exists
        return
      case let other:
        result = .unavailable(other)
        return
      }
      let folder = writeURL.deletingLastPathComponent()
      try self.fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
      // the new folders could have been swapped for symlinks; check containment again.
      _ = try self.root.resolve(path)
      result = try self.placeExclusively(data, at: writeURL) ? .created(FileRevision(data: data)) : .exists
    }
    return result
  }

  /// replaces a file only if its current bytes still match `base` (persistence protocol).
  public func save(_ path: String, data: Data, base: FileRevision) throws -> SaveResult {
    let url = try root.resolve(path)
    var result = SaveResult.missing
    try coordinate(writing: url, options: .forReplacing) { writeURL in
      _ = try self.root.resolve(path)
      switch FileStateProbe.state(of: writeURL, fileManager: self.fileManager) {
      case .readable:
        break
      case .absent:
        result = .missing
        return
      case let other:
        result = .unavailable(other)
        return
      }
      let current = FileRevision(data: try Data(contentsOf: writeURL))
      guard current == base else {
        result = .conflict(current: current)
        return
      }
      let next = FileRevision(data: data)
      if next != current {
        try self.replace(writeURL, with: data)
      }
      result = .saved(next)
    }
    return result
  }

  // MARK: - helpers

  private func coordinate(reading url: URL, _ body: (URL) throws -> Void) throws {
    var coordinationError: NSError?
    var bodyError: Error?
    NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &coordinationError) { readURL in
      do { try body(readURL) } catch { bodyError = error }
    }
    if let coordinationError {
      throw VaultFileError.coordination(coordinationError.localizedDescription)
    }
    if let bodyError {
      throw bodyError
    }
  }

  private func coordinate(
    writing url: URL,
    options: NSFileCoordinator.WritingOptions,
    _ body: (URL) throws -> Void
  ) throws {
    var coordinationError: NSError?
    var bodyError: Error?
    NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: options, error: &coordinationError) { writeURL in
      do { try body(writeURL) } catch { bodyError = error }
    }
    if let coordinationError {
      throw VaultFileError.coordination(coordinationError.localizedDescription)
    }
    if let bodyError {
      throw bodyError
    }
  }

  /// writes `data` to a synced temporary file on the target's volume, outside the vault folder.
  private func stage(_ data: Data, near target: URL) throws -> URL {
    let folder = try fileManager.url(
      for: .itemReplacementDirectory,
      in: .userDomainMask,
      appropriateFor: target.deletingLastPathComponent(),
      create: true
    )
    let file = folder.appendingPathComponent(UUID().uuidString)
    guard fileManager.createFile(atPath: file.path, contents: nil) else {
      throw VaultFileError.io("could not create a temporary file")
    }
    let handle = try FileHandle(forWritingTo: file)
    defer { try? handle.close() }
    try handle.write(contentsOf: data)
    try handle.synchronize()
    return file
  }

  /// moves staged bytes into place only if nothing exists there. returns false on a collision.
  private func placeExclusively(_ data: Data, at target: URL) throws -> Bool {
    let staged = try stage(data, near: target)
    defer { try? fileManager.removeItem(at: staged.deletingLastPathComponent()) }
    if renamex_np(staged.path, target.path, UInt32(RENAME_EXCL)) == 0 {
      return true
    }
    let code = errno
    if code == EEXIST {
      return false
    }
    if code == EXDEV {
      // a different volume: fall back to an exclusive, non-atomic write at the target.
      do {
        try data.write(to: target, options: .withoutOverwriting)
        return true
      } catch let error as CocoaError where error.code == .fileWriteFileExists {
        return false
      }
    }
    throw VaultFileError.io(String(cString: strerror(code)))
  }

  private func replace(_ target: URL, with data: Data) throws {
    let staged = try stage(data, near: target)
    defer { try? fileManager.removeItem(at: staged.deletingLastPathComponent()) }
    _ = try fileManager.replaceItemAt(target, withItemAt: staged)
  }
}
