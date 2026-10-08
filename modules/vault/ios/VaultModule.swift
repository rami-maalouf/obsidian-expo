import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

final class VaultException: GenericException<String> {
  override var reason: String { param }
}

/// javascript binding for the vault core. it stays thin: path, state, and save rules live in
/// Core/, which `swift test` covers. javascript passes vault ids and vault-relative paths only.
public class VaultModule: Module {
  private let runtime = VaultRuntime.shared
  /// touched only on the main queue.
  private var pickerDelegate: FolderPickerDelegate?

  public func definition() -> ModuleDefinition {
    Name("Vault")

    Constant("coreVersion") {
      VaultCoreInfo.version
    }

    // where the disposable search index lives: app caches, outside every vault and backups.
    Constant("indexDirectory") {
      FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("vault-index", isDirectory: true).path
    }

    // returns nil for a valid vault-relative path, or the reason it is refused.
    Function("checkRelativePath") { (path: String) -> String? in
      do {
        _ = try VaultRoot.segments(of: path)
        return nil
      } catch {
        return String(describing: error)
      }
    }

    // resolves with the picked vault, or nil when the user cancels. cancelling leaves any open
    // vault untouched.
    AsyncFunction("pickVault") { (promise: Promise) in
      self.presentFolderPicker(promise)
    }.runOnQueue(.main)

    AsyncFunction("listVaults") { () -> [[String: Any]] in
      try self.runtime.registry.records().map { ["id": $0.id, "name": $0.name] }
    }

    AsyncFunction("openVault") { (id: String) -> [String: Any] in
      try self.open(id: id)
    }

    AsyncFunction("closeVault") { (id: String) in
      self.runtime.remove(id)?.close()
    }

    AsyncFunction("forgetVault") { (id: String) in
      self.runtime.remove(id)?.close()
      try self.runtime.registry.remove(id: id)
    }

    AsyncFunction("fileState") { (vaultId: String, path: String) -> [String: Any] in
      try self.withFiles(vaultId) { files in VaultModule.encode(try files.state(of: path)) }
    }

    AsyncFunction("readText") { (vaultId: String, path: String) -> [String: Any] in
      try self.withFiles(vaultId) { files in
        switch try files.read(path) {
        case let .unavailable(state):
          return ["kind": "unavailable", "state": VaultModule.encode(state)]
        case let .contents(data, revision):
          switch TextCodec.decode(data) {
          case let .editable(text, bom):
            return ["kind": "text", "text": text, "bom": bom, "revision": VaultModule.encode(revision)]
          case let .readOnly(preview, encoding):
            return ["kind": "read-only", "preview": preview, "encoding": encoding, "revision": VaultModule.encode(revision)]
          }
        }
      }
    }

    AsyncFunction("createExclusive") { (vaultId: String, path: String, text: String) -> [String: Any] in
      try self.withFiles(vaultId) { files in
        switch try files.createExclusive(path, data: TextCodec.encode(text, bom: false)) {
        case let .created(revision):
          return ["kind": "created", "revision": VaultModule.encode(revision)]
        case .exists:
          return ["kind": "exists"]
        case let .unavailable(state):
          return ["kind": "unavailable", "state": VaultModule.encode(state)]
        }
      }
    }

    AsyncFunction("saveText") { (vaultId: String, path: String, text: String, bom: Bool, baseSha256: String, baseSize: Int) -> [String: Any] in
      try self.withFiles(vaultId) { files in
        let base = FileRevision(sha256: baseSha256, size: baseSize)
        switch try files.save(path, data: TextCodec.encode(text, bom: bom), base: base) {
        case let .saved(revision):
          return ["kind": "saved", "revision": VaultModule.encode(revision)]
        case let .conflict(current):
          return ["kind": "conflict", "current": VaultModule.encode(current)]
        case .missing:
          return ["kind": "missing"]
        case let .unavailable(state):
          return ["kind": "unavailable", "state": VaultModule.encode(state)]
        }
      }
    }

    AsyncFunction("listNotes") { (vaultId: String) -> [String: Any] in
      try self.withFiles(vaultId) { files in
        var notes: [[String: Any]] = []
        let summary = files.enumerateNotes { batch in
          notes.append(contentsOf: batch.map { entry in
            var note: [String: Any] = ["path": entry.path, "placeholder": entry.state == .placeholder]
            if let size = entry.size { note["size"] = size }
            if let modified = entry.modified { note["modified"] = modified.timeIntervalSince1970 * 1000 }
            return note
          })
          return true
        }
        return ["notes": notes, "unreadableFolders": summary.unreadableFolders]
      }
    }

    AsyncFunction("checkpointDraft") { (vaultId: String, path: String, text: String, bom: Bool, baseSha256: String?, baseSize: Int?, sequence: Int) in
      let base = baseSha256.flatMap { sha in baseSize.map { FileRevision(sha256: sha, size: $0) } }
      try self.requireJournal().checkpoint(DraftRecord(
        vaultId: vaultId,
        path: path,
        base: base,
        contents: TextCodec.encode(text, bom: bom),
        sequence: sequence,
        updatedAt: Date()
      ))
    }

    AsyncFunction("listDrafts") { () -> [String: Any] in
      let listing = try self.requireJournal().all()
      let drafts: [[String: Any]] = listing.drafts.map { draft in
        var item: [String: Any] = [
          "vaultId": draft.vaultId,
          "path": draft.path,
          "sequence": draft.sequence,
          "updatedAt": draft.updatedAt.timeIntervalSince1970 * 1000,
        ]
        if let base = draft.base { item["base"] = VaultModule.encode(base) }
        if case let .editable(text, bom) = TextCodec.decode(draft.contents) {
          item["text"] = text
          item["bom"] = bom
        }
        return item
      }
      return ["drafts": drafts, "unreadable": listing.unreadable]
    }

    AsyncFunction("discardDraft") { (vaultId: String, path: String, sequence: Int) -> Bool in
      try self.requireJournal().discard(vaultId: vaultId, path: path, through: sequence)
    }

    View(VaultEditorView.self) {
      Events("onStatus", "onLoad")

      Prop("vaultId") { (view, vaultId: String?) in
        view.vaultId = vaultId
      }

      Prop("path") { (view, path: String?) in
        view.path = path
      }

      OnViewDidUpdateProps { view in
        view.openIfNeeded()
      }

      // starts writing pending edits to the journal and then the file; status events follow.
      AsyncFunction("flush") { (view: VaultEditorView) in
        view.flush()
      }

      AsyncFunction("focus") { (view: VaultEditorView) in
        view.focus()
      }
    }

    OnCreate {
      #if targetEnvironment(simulator)
        // simulator-only test hook: `-VaultTestFolder vault` registers Documents/vault, so
        // automated runs can open a fixture vault without the system folder picker.
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "-VaultTestFolder"), index + 1 < arguments.count {
          let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
          _ = try? self.runtime.registry.add(url: documents.appendingPathComponent(arguments[index + 1]))
        }
      #endif
    }

    OnDestroy {
      self.runtime.removeAll().forEach { $0.close() }
    }
  }

  // MARK: - sessions

  private func open(id: String) throws -> [String: Any] {
    if runtime.session(id) != nil {
      return ["id": id, "status": "open"]
    }
    let resolved: (record: VaultRecord, url: URL, isStale: Bool)
    do {
      resolved = try runtime.registry.resolve(id: id)
    } catch {
      throw VaultException("The vault folder is no longer available. Pick it again. (\(error))")
    }
    let session = VaultSession(id: id, url: resolved.url)
    if resolved.isStale {
      try? runtime.registry.refresh(id: id, url: resolved.url)
    }
    if runtime.insert(session) !== session {
      // another call opened the vault first; keep that session.
      session.close()
    }
    return ["id": id, "name": resolved.record.name, "status": "open"]
  }

  private func withFiles<T>(_ vaultId: String, _ body: (VaultFiles) throws -> T) throws -> T {
    guard let session = runtime.session(vaultId) else {
      throw VaultException("The vault is not open.")
    }
    do {
      return try session.perform(body)
    } catch let error as VaultPathError {
      throw VaultException("Invalid vault path: \(error)")
    }
  }

  private func requireJournal() throws -> DraftJournal {
    guard let journal = runtime.journal else {
      throw VaultException("The draft journal could not be created.")
    }
    return journal
  }

  // MARK: - picker

  private func presentFolderPicker(_ promise: Promise) {
    guard pickerDelegate == nil else {
      promise.reject(VaultException("A folder picker is already open."))
      return
    }
    guard let controller = appContext?.utilities?.currentViewController() else {
      promise.reject(VaultException("No view controller is available to present the folder picker."))
      return
    }
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
    let delegate = FolderPickerDelegate { [weak self] url in
      guard let self else { return }
      self.pickerDelegate = nil
      guard let url else {
        promise.resolve(nil)
        return
      }
      let accessing = url.startAccessingSecurityScopedResource()
      defer { if accessing { url.stopAccessingSecurityScopedResource() } }
      do {
        let record = try self.runtime.registry.add(url: url)
        let vault: [String: Any] = ["id": record.id, "name": record.name]
        promise.resolve(vault)
      } catch {
        promise.reject(VaultException("The folder could not be saved for later access. (\(error))"))
      }
    }
    pickerDelegate = delegate
    picker.delegate = delegate
    picker.presentationController?.delegate = delegate
    picker.allowsMultipleSelection = false
    controller.present(picker, animated: true)
  }

  // MARK: - encoding

  static func encode(_ revision: FileRevision) -> [String: Any] {
    ["sha256": revision.sha256, "size": revision.size]
  }

  static func encode(_ state: FileState) -> [String: Any] {
    switch state {
    case .readable: return ["kind": "readable"]
    case .placeholder: return ["kind": "placeholder"]
    case .absent: return ["kind": "absent"]
    case let .unknown(reason): return ["kind": "unknown", "reason": reason]
    }
  }
}

/// reports the picked folder, or nil when the picker is cancelled or swiped away.
final class FolderPickerDelegate: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  private var completion: ((URL?) -> Void)?

  init(completion: @escaping (URL?) -> Void) {
    self.completion = completion
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    finish(urls.first)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finish(nil)
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    finish(nil)
  }

  private func finish(_ url: URL?) {
    let completion = self.completion
    self.completion = nil
    completion?(url)
  }
}
