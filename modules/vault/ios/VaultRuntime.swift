import Foundation

/// process-wide vault state shared by the module's functions and the editor view.
final class VaultRuntime: @unchecked Sendable {
  static let shared = VaultRuntime()

  /// app-private storage for the vault list and drafts, outside every vault (r16).
  static let supportDirectory = FileManager.default
    .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("vault", isDirectory: true)

  let registry = VaultRegistry(file: VaultRuntime.supportDirectory.appendingPathComponent("vaults.json"))
  let journal: DraftJournal? = try? DraftJournal(directory: VaultRuntime.supportDirectory.appendingPathComponent("drafts"))
  private let lock = NSLock()
  private var sessions: [String: VaultSession] = [:]

  private init() {}

  func session(_ id: String) -> VaultSession? {
    lock.lock()
    defer { lock.unlock() }
    return sessions[id]
  }

  /// stores the session unless one is already open for the vault; returns the open session.
  func insert(_ session: VaultSession) -> VaultSession {
    lock.lock()
    defer { lock.unlock() }
    if let existing = sessions[session.id] {
      return existing
    }
    sessions[session.id] = session
    return session
  }

  func remove(_ id: String) -> VaultSession? {
    lock.lock()
    defer { lock.unlock() }
    return sessions.removeValue(forKey: id)
  }

  func removeAll() -> [VaultSession] {
    lock.lock()
    defer { lock.unlock() }
    let all = Array(sessions.values)
    sessions.removeAll()
    return all
  }
}
