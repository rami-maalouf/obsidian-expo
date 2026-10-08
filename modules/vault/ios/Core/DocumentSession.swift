import Foundation

/// what the editor shows about its text (persistence protocol, r3).
public enum DocumentStatus: Equatable, Sendable {
  case loading
  /// the file is not editable utf-8; it is shown read-only and never saved.
  case readOnly(encoding: String)
  /// the file and the editor match: "saved locally".
  case clean
  /// edits not yet in the journal.
  case dirty
  /// edits durable in the journal, not yet in the file.
  case journaled
  case saving
  /// the last save could not finish; the draft is kept and a retry is possible.
  case recoverable(String)
  /// another writer changed the file; both versions are kept until the user resolves it.
  case conflict(disk: FileRevision?)
  /// the file was deleted or renamed; it is never recreated silently.
  case missing
  /// the journal could not record the edits; navigation must not claim they are safe.
  case checkpointFailed(String)
  case unavailable(FileState)
}

/// the text and newline facts the editor needs when a document opens.
public struct LoadedDocument: Equatable, Sendable {
  public let text: String
  public let bom: Bool
  /// the separator for newly typed line breaks, matching the file's first line break.
  public let newline: String
  /// nil for a restored draft of a note that does not exist on disk yet.
  public let revision: FileRevision?
  /// true when a journaled draft was restored instead of the file's text.
  public let restoredDraft: Bool
}

public enum LoadOutcome: Equatable, Sendable {
  case loaded(LoadedDocument)
  case readOnly(preview: String, encoding: String)
  case unavailable(FileState)
  /// a journaled draft exists but the file changed or disappeared since; the user decides.
  case recoveryNeeded(draft: DraftRecord, disk: FileRevision?)
}

/// owns one open note: the base revision, edit sequence numbers, checkpoints, and saves.
/// every method except `load` returns immediately and runs on a private serial queue, so the
/// main thread never waits for file i/o. `onStatus` is called on that queue.
public final class DocumentSession: @unchecked Sendable {
  public let vaultId: String
  public let path: String
  private let session: VaultSession
  private let journal: DraftJournal
  private let queue = DispatchQueue(label: "vault.document")
  private let onStatus: @Sendable (DocumentStatus) -> Void

  // all fields below are touched only on `queue`.
  private var base: FileRevision?
  private var bom = false
  private var editable = false
  private var editSequence = 0
  private var checkpointedSequence = 0
  private var savedSequence = 0
  private var latestText = ""
  private var current: DocumentStatus = .loading

  public init(
    vaultId: String,
    path: String,
    session: VaultSession,
    journal: DraftJournal,
    onStatus: @escaping @Sendable (DocumentStatus) -> Void
  ) {
    self.vaultId = vaultId
    self.path = path
    self.session = session
    self.journal = journal
    self.onStatus = onStatus
  }

  public var status: DocumentStatus {
    queue.sync { current }
  }

  /// blocks until queued work has finished. for tests and teardown.
  public func waitUntilIdle() {
    queue.sync {}
  }

  /// reads the file and any draft. call off the main thread. a draft whose base matches the
  /// file is restored; any other draft needs explicit recovery before editing.
  public func load() -> LoadOutcome {
    queue.sync {
      let read: ReadResult
      do {
        read = try session.perform { try $0.read(path) }
      } catch {
        set(.recoverable(String(describing: error)))
        return .unavailable(.unknown(String(describing: error)))
      }
      let draft = try? journal.load(vaultId: vaultId, path: path)
      switch read {
      case .unavailable(.absent):
        if let draft {
          return draft.base == nil ? restore(draft, revision: nil) : .recoveryNeeded(draft: draft, disk: nil)
        }
        set(.unavailable(.absent))
        return .unavailable(.absent)
      case let .unavailable(state):
        // a placeholder or unknown file keeps any draft in the journal until it can be read.
        set(.unavailable(state))
        return .unavailable(state)
      case let .contents(data, revision):
        if let draft {
          return draft.base == revision ? restore(draft, revision: revision) : .recoveryNeeded(draft: draft, disk: revision)
        }
        switch TextCodec.decode(data) {
        case let .readOnly(preview, encoding):
          set(.readOnly(encoding: encoding))
          return .readOnly(preview: preview, encoding: encoding)
        case let .editable(text, bom):
          return open(text: text, bom: bom, revision: revision, restored: false)
        }
      }
    }
  }

  /// records the editor's current text after edits settle, for example after a short debounce.
  public func update(text: String) {
    queue.async { [self] in
      guard editable else {
        return
      }
      editSequence += 1
      latestText = text
      set(.dirty)
    }
  }

  /// writes the latest text to the journal, then saves it against the base revision.
  public func persist() {
    queue.async { [self] in
      guard editable, editSequence > savedSequence else {
        return
      }
      if checkpointedSequence < editSequence {
        let sequence = editSequence
        do {
          try journal.checkpoint(DraftRecord(
            vaultId: vaultId,
            path: path,
            base: base,
            contents: TextCodec.encode(latestText, bom: bom),
            sequence: sequence,
            updatedAt: Date()
          ))
          checkpointedSequence = sequence
          set(.journaled)
        } catch {
          set(.checkpointFailed(String(describing: error)))
          return
        }
      }
      if case .conflict = current {
        // a conflict stays until the user resolves it; edits keep going to the journal only.
        return
      }
      save()
    }
  }

  /// compares the file with the base revision, for example when the app returns to the
  /// foreground. `completion` receives new text when a clean document followed an external edit.
  public func reconcile(_ completion: @escaping @Sendable (String?) -> Void) {
    queue.async { [self] in
      completion(reconcileOnQueue())
    }
  }

  // MARK: - helpers (on queue)

  private func reconcileOnQueue() -> String? {
    guard editable, let read = try? session.perform({ try $0.read(path) }) else {
      return nil
    }
    switch read {
    case .unavailable(.absent):
      set(.missing)
      return nil
    case let .unavailable(state):
      set(.unavailable(state))
      return nil
    case let .contents(data, revision):
      if revision == base {
        return nil
      }
      guard editSequence == savedSequence, case let .editable(text, bom) = TextCodec.decode(data) else {
        set(.conflict(disk: revision))
        return nil
      }
      self.bom = bom
      base = revision
      latestText = text
      set(.clean)
      return text
    }
  }

  private func open(text: String, bom: Bool, revision: FileRevision?, restored: Bool) -> LoadOutcome {
    self.bom = bom
    base = revision
    latestText = text
    editable = true
    set(restored ? .journaled : .clean)
    return .loaded(LoadedDocument(
      text: text,
      bom: bom,
      newline: DocumentSession.newline(of: text),
      revision: revision,
      restoredDraft: restored
    ))
  }

  private func restore(_ draft: DraftRecord, revision: FileRevision?) -> LoadOutcome {
    guard case let .editable(text, bom) = TextCodec.decode(draft.contents) else {
      return .recoveryNeeded(draft: draft, disk: revision)
    }
    editSequence = draft.sequence
    checkpointedSequence = draft.sequence
    savedSequence = 0
    return open(text: text, bom: bom, revision: revision, restored: true)
  }

  private func save() {
    let sequence = checkpointedSequence
    let data = TextCodec.encode(latestText, bom: bom)
    set(.saving)
    do {
      if let base {
        switch try session.perform({ try $0.save(path, data: data, base: base) }) {
        case let .saved(revision):
          saved(revision, through: sequence)
        case let .conflict(disk):
          set(.conflict(disk: disk))
        case .missing:
          set(.missing)
        case let .unavailable(state):
          set(.recoverable("the file is unavailable: \(state)"))
        }
      } else {
        // a restored draft of a note that does not exist yet is created, never overwritten.
        switch try session.perform({ try $0.createExclusive(path, data: data) }) {
        case let .created(revision):
          saved(revision, through: sequence)
        case .exists:
          set(.conflict(disk: nil))
        case let .unavailable(state):
          set(.recoverable("the file is unavailable: \(state)"))
        }
      }
    } catch {
      set(.recoverable(String(describing: error)))
    }
  }

  private func saved(_ revision: FileRevision, through sequence: Int) {
    base = revision
    savedSequence = sequence
    // a newer checkpoint written meanwhile is kept by the journal.
    _ = try? journal.discard(vaultId: vaultId, path: path, through: sequence)
    set(editSequence > savedSequence ? .dirty : .clean)
  }

  private func set(_ next: DocumentStatus) {
    current = next
    onStatus(next)
  }

  /// "\r\n" or "\r" when the file's first line break uses it, otherwise "\n".
  static func newline(of text: String) -> String {
    var previousWasReturn = false
    for scalar in text.unicodeScalars {
      if previousWasReturn {
        return scalar == "\n" ? "\r\n" : "\r"
      }
      if scalar == "\r" {
        previousWasReturn = true
      } else if scalar == "\n" {
        return "\n"
      }
    }
    return previousWasReturn ? "\r" : "\n"
  }
}
