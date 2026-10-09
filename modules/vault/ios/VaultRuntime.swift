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
  let appData = AppDataStore(directory: VaultRuntime.supportDirectory.appendingPathComponent("app-data"))
  private let lock = NSLock()
  private var sessions: [String: VaultSession] = [:]
  private var linkTargets: [String: WikiLinkTargets] = [:]
  /// the heading of a `[[note#heading]]` link being followed; the next editor for that note
  /// takes it. one at a time: following another link replaces it.
  private var pendingHeading: (vaultId: String, path: String, heading: String)?

  /// posted on the main queue after a vault's link targets change; `userInfo["vaultId"]`.
  static let linkTargetsChanged = Notification.Name("vault.linkTargetsChanged")

  private init() {}

  /// the notes that wikilinks can name, from the vault's last complete listing.
  func linkTargets(_ vaultId: String) -> WikiLinkTargets? {
    lock.lock()
    defer { lock.unlock() }
    return linkTargets[vaultId]
  }

  func setPendingHeading(_ heading: String?, vaultId: String, path: String) {
    lock.lock()
    defer { lock.unlock() }
    pendingHeading = heading.map { (vaultId, path, $0) }
  }

  func takePendingHeading(vaultId: String, path: String) -> String? {
    lock.lock()
    defer { lock.unlock() }
    guard let pending = pendingHeading, pending.vaultId == vaultId, pending.path == path else {
      return nil
    }
    pendingHeading = nil
    return pending.heading
  }

  func setLinkTargets(_ targets: WikiLinkTargets, for vaultId: String) {
    lock.lock()
    linkTargets[vaultId] = targets
    lock.unlock()
    DispatchQueue.main.async {
      NotificationCenter.default.post(name: VaultRuntime.linkTargetsChanged, object: nil, userInfo: ["vaultId": vaultId])
    }
  }

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
