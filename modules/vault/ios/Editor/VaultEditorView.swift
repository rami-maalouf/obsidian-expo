import ExpoModulesCore
import LapermEditor
import UIKit

/// native markdown source editor (ktd3). native code owns the text, selection, composition,
/// and undo; javascript receives status events, never the full text on each keystroke.
///
/// the text view is laperm's TextKit 2 editor (t05). its live preview hides markdown markers on
/// every line except the ones the caret or selection touches, and on every line while the
/// keyboard is down. it styles the text storage's attributes only, so the saved text is the
/// typed markdown. this view keeps the document session, drafts, saves, and newlines.
public final class VaultEditorView: ExpoView, UITextViewDelegate {
  let onStatus = EventDispatcher()
  let onLoad = EventDispatcher()

  var vaultId: String?
  var path: String?

  private let textView = MarkdownTextView(theme: VaultEditorView.theme(for: nil))
  private var document: DocumentSession?
  private var openedTarget: String?
  private var newline = "\n"
  private var debounce: DispatchWorkItem?
  private var hasPendingEdits = false
  private var applyingNewline = false
  private var lastStatus: String?
  /// "saved locally" is shown only after a save of this document completed (integrity gate).
  private var savedSinceOpen = false
  private var observers: [NSObjectProtocol] = []
  private static let settleDelay: TimeInterval = 0.2

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    textView.delegate = self
    // top and bottom only: `margins` sets the sides and keeps long lines readable on ipad.
    textView.textContainerInset = UIEdgeInsets(top: 16, left: 0, bottom: 32, right: 0)
    textView.margins = .readable
    textView.showsLineNumbers = false
    textView.isLivePreviewEnabled = true
    // pair completion would add characters the user did not type, such as a closing backtick.
    textView.editingOptions.completesPairs = false
    textView.keyboardDismissMode = .interactive
    // smart punctuation would rewrite markdown source such as quotes, dashes, and spacing.
    textView.smartQuotesType = .no
    textView.smartDashesType = .no
    textView.smartInsertDeleteType = .no
    textView.isEditable = false
    textView.accessibilityLabel = "Note text"
    textView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(textView)
    // the theme's fonts are fixed sizes, so a dynamic type change builds a new theme.
    registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) { (view: VaultEditorView, _: UITraitCollection) in
      view.textView.theme = VaultEditorView.theme(for: view.traitCollection)
    }

    let center = NotificationCenter.default
    // these observers are delivered on the main queue. the text view moves its own content
    // above the keyboard.
    observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
      MainActor.assumeIsolated { self?.flushForBackground() }
    })
    observers.append(center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
      MainActor.assumeIsolated { self?.reconcile() }
    })
  }

  /// a reading theme: the system body font at the user's text size, bold headings at fixed
  /// ratios, and monospaced code. laperm's default theme gives the colors and spacing.
  static func theme(for traits: UITraitCollection?) -> MarkdownTheme {
    let body = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 17), compatibleWith: traits)
    let size = body.pointSize
    let bold = UIFont.systemFont(ofSize: size, weight: .bold)
    let mono = UIFont.monospacedSystemFont(ofSize: (size * 0.9).rounded(), weight: .regular)
    var theme = MarkdownTheme.default
    theme.bodyFont = body
    let headingScales: [CGFloat] = [1.6, 1.4, 1.25, 1.1, 1, 1]
    for (index, scale) in headingScales.enumerated() {
      theme.styles[.heading(level: index + 1)] = .init(font: .systemFont(ofSize: (size * scale).rounded(), weight: .bold))
    }
    theme.styles[.strong] = .init(font: bold)
    theme.styles[.emphasis] = .init(font: .italicSystemFont(ofSize: size))
    theme.styles[.tableHeader] = .init(font: bold)
    theme.styles[.inlineCode] = .init(font: mono, foregroundColor: .systemPink)
    theme.styles[.codeBlock] = .init(font: mono, foregroundColor: .label)
    theme.styles[.listMarker] = .init(foregroundColor: .secondaryLabel)
    theme.lineSpacing = 3
    return theme
  }

  deinit {
    for observer in observers {
      NotificationCenter.default.removeObserver(observer)
    }
  }

  /// saves edits made in the last moments before the view is removed, for example when the
  /// user opens search or another note.
  public override func willMove(toSuperview newSuperview: UIView?) {
    super.willMove(toSuperview: newSuperview)
    if newSuperview == nil {
      flush()
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    textView.frame = bounds
  }

  // MARK: - opening

  func openIfNeeded() {
    guard let vaultId, let path else {
      return
    }
    let target = "\(vaultId)\u{0}\(path)"
    guard target != openedTarget else {
      return
    }
    flush()
    openedTarget = target
    savedSinceOpen = false
    document = nil
    textView.isEditable = false
    textView.text = ""
    emit(["status": "loading"])
    LaunchTiming.mark("first note load started")

    guard let session = VaultRuntime.shared.session(vaultId), let journal = VaultRuntime.shared.journal else {
      onLoad(["kind": "unavailable", "reason": "The vault is not open."])
      return
    }
    let document = DocumentSession(vaultId: vaultId, path: path, session: session, journal: journal) { [weak self] status in
      DispatchQueue.main.async {
        guard let self, self.openedTarget == target else { return }
        if status == .saving {
          self.savedSinceOpen = true
        }
        self.emit(VaultEditorView.payload(status, savedSinceOpen: self.savedSinceOpen))
      }
    }
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let outcome = document.load()
      DispatchQueue.main.async {
        // a later navigation replaced this request; its result must not take over the editor.
        guard let self, self.openedTarget == target else {
          return
        }
        self.apply(outcome, document: document)
      }
    }
  }

  private func apply(_ outcome: LoadOutcome, document: DocumentSession) {
    switch outcome {
    case let .loaded(loaded):
      self.document = document
      newline = loaded.newline
      textView.text = loaded.text
      textView.isEditable = true
      onLoad(["kind": "loaded", "restoredDraft": loaded.restoredDraft])
      if loaded.restoredDraft {
        document.persist()
      }
    case let .readOnly(preview, encoding):
      textView.text = preview
      onLoad(["kind": "read-only", "encoding": encoding])
    case let .unavailable(state):
      onLoad(["kind": "unavailable", "reason": "\(state)"])
    case let .recoveryNeeded(draft, disk):
      var payload: [String: Any] = ["kind": "recovery-needed", "draftSequence": draft.sequence]
      payload["diskChanged"] = disk != nil
      onLoad(payload)
    }
    switch outcome {
    case .loaded: LaunchTiming.firstNoteShown("editable")
    case .readOnly: LaunchTiming.firstNoteShown("read-only")
    case .unavailable: LaunchTiming.firstNoteShown("unavailable")
    case .recoveryNeeded: LaunchTiming.firstNoteShown("recovery-needed")
    }
  }

  // MARK: - editing

  public func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
    // new line breaks follow the file's convention; untouched text is never rewritten.
    guard newline != "\n", !applyingNewline, textView.markedTextRange == nil, text.contains("\n") else {
      return true
    }
    let converted = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\n", with: newline)
    guard
      let start = textView.position(from: textView.beginningOfDocument, offset: range.location),
      let end = textView.position(from: start, offset: range.length),
      let textRange = textView.textRange(from: start, to: end)
    else {
      return true
    }
    applyingNewline = true
    textView.replace(textRange, withText: converted)
    applyingNewline = false
    return false
  }

  /// laperm adds "open link" to the edit menu for a link; it never sets the delegate itself.
  public func textView(_ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
    self.textView.editMenu(forTextIn: range, suggestedActions: suggestedActions)
  }

  public func textViewDidChange(_ textView: UITextView) {
    guard document != nil else {
      return
    }
    hasPendingEdits = true
    emit(["status": "unsaved"])
    scheduleFlush()
  }

  private func scheduleFlush() {
    debounce?.cancel()
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      // wait for composition (for example, a keyboard's marked text) to finish.
      if self.textView.markedTextRange != nil {
        self.scheduleFlush()
      } else {
        self.flush()
      }
    }
    debounce = work
    DispatchQueue.main.asyncAfter(deadline: .now() + VaultEditorView.settleDelay, execute: work)
  }

  /// hands the current text to the document, which journals and then saves it. also retries a
  /// save that failed earlier; persisting is a no-op when everything is saved.
  func flush() {
    debounce?.cancel()
    debounce = nil
    guard let document else {
      return
    }
    if hasPendingEdits {
      hasPendingEdits = false
      document.update(text: textView.text)
    }
    document.persist()
  }

  func focus() {
    textView.becomeFirstResponder()
  }

  // MARK: - lifecycle

  private func flushForBackground() {
    guard document != nil else {
      return
    }
    let task = BackgroundTask(name: "vault.flush")
    flush()
    let document = self.document
    DispatchQueue.global(qos: .userInitiated).async {
      document?.waitUntilIdle()
      DispatchQueue.main.async { task.end() }
    }
  }

  private func reconcile() {
    guard let document else {
      return
    }
    if hasPendingEdits {
      // local edits win the race to the journal; a changed file then becomes a conflict.
      flush()
      return
    }
    let target = openedTarget
    document.reconcile { [weak self] text in
      guard let text else { return }
      DispatchQueue.main.async {
        guard let self, self.openedTarget == target, !self.hasPendingEdits else { return }
        let selection = self.textView.selectedRange
        self.textView.text = text
        let length = (text as NSString).length
        let location = min(selection.location, length)
        self.textView.selectedRange = NSRange(location: location, length: min(selection.length, length - location))
        self.newline = DocumentSession.newline(of: text)
      }
    }
  }

  // MARK: - status

  private func emit(_ payload: [String: Any]) {
    let status = payload["status"] as? String
    if status == "unsaved", lastStatus == "unsaved" {
      return
    }
    lastStatus = status
    onStatus(payload)
  }

  static func payload(_ status: DocumentStatus, savedSinceOpen: Bool) -> [String: Any] {
    switch status {
    case .loading: return ["status": "loading"]
    case let .readOnly(encoding): return ["status": "read-only", "detail": encoding]
    case .clean: return ["status": savedSinceOpen ? "saved" : "opened"]
    case .dirty: return ["status": "unsaved"]
    case .journaled: return ["status": "unsaved", "detail": "journaled"]
    case .saving: return ["status": "saving"]
    case let .recoverable(reason): return ["status": "error", "detail": reason]
    case .conflict: return ["status": "conflict"]
    case .missing: return ["status": "missing"]
    case let .checkpointFailed(reason): return ["status": "checkpoint-failed", "detail": reason]
    case let .unavailable(state): return ["status": "unavailable", "detail": "\(state)"]
    }
  }
}

/// keeps the app running briefly after it moves to the background so pending edits are saved.
/// `end` is safe to call more than once and from the expiration handler.
final class BackgroundTask: @unchecked Sendable {
  private let lock = NSLock()
  private var identifier = UIBackgroundTaskIdentifier.invalid

  @MainActor
  init(name: String) {
    identifier = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
      self?.end()
    }
  }

  func end() {
    lock.lock()
    let current = identifier
    identifier = .invalid
    lock.unlock()
    if current != .invalid {
      DispatchQueue.main.async {
        UIApplication.shared.endBackgroundTask(current)
      }
    }
  }
}
