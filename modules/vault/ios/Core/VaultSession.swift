import Foundation

/// starts and stops access to a security-scoped folder. replaceable in tests.
public protocol SecurityScope: Sendable {
  func start(_ url: URL) -> Bool
  func stop(_ url: URL)
}

public struct SystemSecurityScope: SecurityScope {
  public init() {}
  public func start(_ url: URL) -> Bool { url.startAccessingSecurityScopedResource() }
  public func stop(_ url: URL) { url.stopAccessingSecurityScopedResource() }
}

public enum VaultSessionError: Error, Equatable, Sendable {
  case closed
}

/// an opened vault. folder access stays active until the session is closed and every operation
/// that started before the close has finished, so switching vaults cannot cut off a save.
public final class VaultSession: @unchecked Sendable {
  public let id: String
  public let files: VaultFiles
  private let url: URL
  private let scope: SecurityScope
  private let didStartAccess: Bool
  private let lock = NSLock()
  private var inFlight = 0
  private var closing = false
  private var released = false

  public init(id: String, url: URL, scope: SecurityScope = SystemSecurityScope()) {
    self.id = id
    self.url = url
    self.scope = scope
    didStartAccess = scope.start(url)
    files = VaultFiles(root: VaultRoot(url: url))
  }

  public var isReleased: Bool {
    lock.lock()
    defer { lock.unlock() }
    return released
  }

  /// runs one operation. throws `closed` once `close` has been called.
  public func perform<T>(_ body: (VaultFiles) throws -> T) throws -> T {
    lock.lock()
    if closing {
      lock.unlock()
      throw VaultSessionError.closed
    }
    inFlight += 1
    lock.unlock()
    defer { finish() }
    return try body(files)
  }

  /// stops new operations; access is released when the running ones finish.
  public func close() {
    lock.lock()
    closing = true
    let release = inFlight == 0 && !released
    if release {
      released = true
    }
    lock.unlock()
    if release {
      stopAccess()
    }
  }

  private func finish() {
    lock.lock()
    inFlight -= 1
    let release = closing && inFlight == 0 && !released
    if release {
      released = true
    }
    lock.unlock()
    if release {
      stopAccess()
    }
  }

  private func stopAccess() {
    if didStartAccess {
      scope.stop(url)
    }
  }
}
