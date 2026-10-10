import ExpoModulesCore
import LapermEditor
import UIKit

/// native markdown source editor (ktd3). native code owns the text, selection, composition,
/// and undo; javascript receives status events, never the full text on each keystroke.
///
/// the text view is laperm's TextKit 2 editor (t05). its live preview hides markdown markers on
/// every line except the ones the caret or selection touches, and on every line while the
/// keyboard is down. it styles the text storage's attributes only, so the saved text is the
/// typed markdown. this view keeps the document session, drafts, saves, and newlines. the note's
/// name is above the text, in the same scroll view (NoteTitleView.swift).
public final class VaultEditorView: ExpoView, UITextViewDelegate {
  let onStatus = EventDispatcher()
  let onLoad = EventDispatcher()
  /// a tap on a wikilink to another note: `target` as written, and `path` when a note matches.
  let onOpenLink = EventDispatcher()
  /// editing the name above the text ended with a new `title`; javascript renames the note.
  let onTitleSubmit = EventDispatcher()

  var vaultId: String?
  var path: String?

  private let textView = MarkdownTextView(theme: VaultEditorView.theme(for: nil))
  private let title = NoteTitleView()
  private var document: DocumentSession?
  private var openedTarget: String?
  private var newline = "\n"
  private var debounce: DispatchWorkItem?
  private var hasPendingEdits = false
  private var applyingNewline = false
  private var lastStatus: String?
  /// "saved locally" is shown only after a save of this document completed (integrity gate).
  private var savedSinceOpen = false
  /// a `[[note#heading]]` heading in this note to put the caret on once the note is parsed.
  private var pendingHeading: String?
  /// `[[` link completion: the popup, the link being typed, and what each row inserts.
  private let completion = WikiLinkCompletionView()
  private var completionQuery: WikiLinkQuery?
  private var completionInserts: [String] = []
  /// the start of a link whose popup was dismissed with escape; it stays closed for that link.
  private var dismissedCompletionStart: Int?
  private var observers: [NSObjectProtocol] = []
  /// renames that are moving this note's file. typed edits wait meanwhile, so none is saved to
  /// the old path; the document that follows the file takes them (endRename).
  private var pendingRenames = 0
  /// the text that the last rename saved before the file moved.
  private var renamedText = ""
  /// true while the view leaves its window; the name's editing then ends without a rename.
  private var leaving = false
  private static let settleDelay: TimeInterval = 0.2

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    textView.delegate = self
    // top and bottom only: `margins` sets the sides and keeps long lines readable on ipad. the
    // name above the text replaces the top inset with its own height (`headerHeight`).
    textView.textContainerInset = UIEdgeInsets(top: 16, left: 0, bottom: 32, right: 0)
    textView.margins = .readable
    textView.showsLineNumbers = false
    textView.isLivePreviewEnabled = true
    // pair completion would add characters the user did not type, such as a closing backtick.
    textView.editingOptions.completesPairs = false
    textView.keyboardDismissMode = .interactive
    // the note scrolls under the see-through navigation bar; the soft edge blurs the text under
    // the bar and fades out below it. react-native-screens applies its `scrollEdgeEffects`
    // option before the editor mounts, so the style is set here.
    textView.topEdgeEffect.style = .soft
    // smart punctuation would rewrite markdown source such as quotes, dashes, and spacing.
    textView.smartQuotesType = .no
    textView.smartDashesType = .no
    textView.smartInsertDeleteType = .no
    textView.isEditable = false
    textView.accessibilityLabel = "Note text"
    textView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    // the name scrolls with the text, so the navigation bar keeps only its buttons.
    title.font = VaultEditorView.titleFont(for: nil)
    title.onHeightChange = { [weak self] height in
      self?.textView.headerHeight = height
    }
    title.onReturn = { [weak self] in
      self?.beginEditingText()
    }
    title.onEndEditing = { [weak self] typed in
      self?.titleEdited(typed)
    }
    textView.headerHeight = title.height(for: 0)
    textView.headerView = title
    addSubview(textView)
    completion.onSelect = { [weak self] index in
      self?.acceptCompletion(at: index)
    }
    addSubview(completion)
    // the theme's fonts are fixed sizes, so a dynamic type change builds a new theme.
    registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) { (view: VaultEditorView, _: UITraitCollection) in
      view.textView.theme = VaultEditorView.theme(for: view.traitCollection)
      view.title.font = VaultEditorView.titleFont(for: view.traitCollection)
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

    // wikilinks resolve against the vault's last note listing (VaultRuntime). a link shown as
    // rendered text opens on a tap; a missing note's link takes laperm's unresolved color.
    textView.wikiLinkResolver = { [weak self] reference in
      self?.resolution(of: reference) ?? .unknown
    }
    textView.onOpenWikiLink = { [weak self] reference in
      self?.follow(reference) ?? false
    }
    textView.onOutlineChange = { [weak self] outline in
      self?.showPendingHeading(in: outline)
    }
    observers.append(center.addObserver(forName: VaultRuntime.linkTargetsChanged, object: nil, queue: .main) { [weak self] note in
      let vaultId = note.userInfo?["vaultId"] as? String
      MainActor.assumeIsolated {
        guard let self, vaultId == self.vaultId else { return }
        self.textView.refreshWikiLinkResolution()
      }
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

  /// the name above the text: bold, at the size of a first-level heading.
  static func titleFont(for traits: UITraitCollection?) -> UIFont {
    let body = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 17), compatibleWith: traits)
    return .systemFont(ofSize: (body.pointSize * 1.6).rounded(), weight: .bold)
  }

  /// the note's name: its file name without the folder or ".md".
  static func name(of path: String) -> String {
    let file = path.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? path
    return file.lowercased().hasSuffix(".md") ? String(file.dropLast(3)) : file
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
    leaving = newSuperview == nil
    if newSuperview == nil {
      flush()
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    textView.frame = bounds
    if !completion.isHidden {
      positionCompletion()
    }
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
    // another note replaces this one while a rename runs: waiting edits go to the document
    // now, which keeps them as a draft if its file has moved.
    pendingRenames = 0
    flush()
    openedTarget = target
    hideCompletion()
    pendingHeading = VaultRuntime.shared.takePendingHeading(vaultId: vaultId, path: path)
    savedSinceOpen = false
    document = nil
    textView.isEditable = false
    textView.text = ""
    title.isEditable = false
    title.text = VaultEditorView.name(of: path)
    emit(["status": "loading"])
    LaunchTiming.mark("first note load started")

    guard let document = documentSession(vaultId: vaultId, path: path, target: target) else {
      onLoad(["kind": "unavailable", "reason": "The vault is not open."])
      return
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

  /// a session for the note at `path` whose status reaches the view while it shows `target`.
  private func documentSession(vaultId: String, path: String, target: String) -> DocumentSession? {
    guard let session = VaultRuntime.shared.session(vaultId), let journal = VaultRuntime.shared.journal else {
      return nil
    }
    return DocumentSession(vaultId: vaultId, path: path, session: session, journal: journal) { [weak self] status in
      DispatchQueue.main.async {
        guard let self, self.openedTarget == target else { return }
        if status == .saving {
          self.savedSinceOpen = true
        }
        self.emit(VaultEditorView.payload(status, savedSinceOpen: self.savedSinceOpen))
      }
    }
  }

  private func apply(_ outcome: LoadOutcome, document: DocumentSession) {
    switch outcome {
    case let .loaded(loaded):
      self.document = document
      newline = loaded.newline
      let followingHeading = pendingHeading != nil
      textView.text = loaded.text
      textView.isEditable = true
      title.isEditable = true
      // a `[[note#heading]]` link that already moved to its heading keeps that place.
      if !(followingHeading && pendingHeading == nil) {
        showStartOfNote()
      }
      onLoad(["kind": "loaded", "restoredDraft": loaded.restoredDraft])
      if loaded.restoredDraft {
        document.persist()
      }
    case let .readOnly(preview, encoding):
      textView.text = preview
      // a read-only note can still be renamed.
      title.isEditable = true
      showStartOfNote()
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

  /// a note opens at its top, without the keyboard. the caret waits on the line after the front
  /// matter (or at the start), so focusing without a tap starts there rather than at the end,
  /// where UIKit puts it after the text is set.
  private func showStartOfNote() {
    let text = textView.textStorage.mutableString
    let start = FrontMatterParser.parse(text)?.endIncludingNewline(in: text) ?? 0
    let caret = NSRange(location: min(start, text.length), length: 0)
    textView.selectedRange = caret
    scrollToTop()
    // TextKit 2 lays out lazily, so a later pass can move the offset; settle it once more unless
    // the user or a heading link has moved the caret or the text since.
    let target = openedTarget
    DispatchQueue.main.async { [weak self] in
      guard let self, self.openedTarget == target, !self.textView.isTracking, !self.textView.isDecelerating,
        self.textView.selectedRange == caret
      else {
        return
      }
      self.scrollToTop()
    }
  }

  private func scrollToTop() {
    textView.setContentOffset(CGPoint(x: textView.contentOffset.x, y: -textView.adjustedContentInset.top), animated: false)
  }

  // MARK: - editing

  public func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
    // return chooses the highlighted link suggestion instead of starting a new line.
    if !completion.isHidden, textView.markedTextRange == nil, text.hasPrefix("\n") || text.hasPrefix("\r") {
      acceptCompletion(at: completion.highlighted)
      return false
    }
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
    noteEdited()
    updateCompletion()
  }

  public func textViewDidChangeSelection(_ textView: UITextView) {
    updateCompletion()
  }

  public func textViewDidEndEditing(_ textView: UITextView) {
    hideCompletion()
  }

  public func scrollViewDidScroll(_ scrollView: UIScrollView) {
    if !completion.isHidden {
      positionCompletion()
    }
  }

  private func noteEdited() {
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
  /// save that failed earlier; persisting is a no-op when everything is saved. while a rename
  /// moves the file, edits wait for it (endRename).
  func flush() {
    debounce?.cancel()
    debounce = nil
    guard pendingRenames == 0, let document else {
      return
    }
    if hasPendingEdits {
      hasPendingEdits = false
      document.update(text: textView.text)
    }
    document.persist()
  }

  /// writes pending edits and returns the open document, so a rename can wait for its save.
  /// edits typed after this wait until `endRename`.
  func beginRename() -> DocumentSession? {
    flush()
    pendingRenames += 1
    renamedText = textView.text
    return document
  }

  /// a rename of `oldPath` ended. when the file moved to `newPath` and this view still shows it,
  /// the view follows the file: a new document session takes over, and the text, caret, undo,
  /// and keyboard stay. otherwise waiting edits go to the same document.
  func endRename(from oldPath: String, movedTo newPath: String?) {
    pendingRenames = max(0, pendingRenames - 1)
    if let newPath, let vaultId, path == oldPath {
      follow(vaultId: vaultId, to: newPath)
    } else if pendingRenames == 0, hasPendingEdits {
      scheduleFlush()
    }
  }

  private func follow(vaultId: String, to newPath: String) {
    let previous = document
    let target = "\(vaultId)\u{0}\(newPath)"
    path = newPath
    openedTarget = target
    if !title.field.isFirstResponder {
      title.text = VaultEditorView.name(of: newPath)
    }
    guard let next = documentSession(vaultId: vaultId, path: newPath, target: target) else {
      document = nil
      textView.isEditable = false
      title.isEditable = false
      onLoad(["kind": "unavailable", "reason": "The vault is not open."])
      return
    }
    // edits keep waiting until the document at the new path has read its file.
    pendingRenames += 1
    let expected = renamedText
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let outcome = next.load()
      DispatchQueue.main.async {
        guard let self, self.openedTarget == target else { return }
        self.pendingRenames = max(0, self.pendingRenames - 1)
        if case let .loaded(loaded) = outcome, !loaded.restoredDraft, previous != nil, loaded.text == expected {
          self.document = next
          self.newline = loaded.newline
          if self.pendingRenames == 0, self.hasPendingEdits {
            self.flush()
          }
          return
        }
        // the file changed meanwhile, a draft waits for the new path, or the note is read-only:
        // it opens as any note does. edits typed during the rename go to the old document, which
        // keeps them as a draft for the old path.
        if self.hasPendingEdits, let previous {
          self.hasPendingEdits = false
          previous.update(text: self.textView.text)
          previous.persist()
        }
        self.document = nil
        self.textView.isEditable = false
        self.title.isEditable = false
        self.apply(outcome, document: next)
      }
    }
  }

  func focus() {
    // laperm's override of this method does not mark its result as discardable.
    _ = textView.becomeFirstResponder()
  }

  /// puts the caret in the name above the text, with the whole name selected.
  func focusTitle() {
    scrollToTop()
    title.beginEditingWithNameSelected()
  }

  /// shows the open note's name again, for example after a rename was refused.
  func resetTitle() {
    guard let path, !title.field.isFirstResponder else { return }
    title.text = VaultEditorView.name(of: path)
  }

  /// return in the name: the caret moves to the start of the text, after any front matter.
  private func beginEditingText() {
    guard textView.isEditable else {
      title.field.resignFirstResponder()
      return
    }
    let text = textView.textStorage.mutableString
    let start = FrontMatterParser.parse(text)?.endIncludingNewline(in: text) ?? 0
    textView.selectedRange = NSRange(location: min(start, text.length), length: 0)
    focus()
  }

  /// editing the name ended. a changed name goes to javascript, which renames the note; a note
  /// that is leaving the screen is not renamed.
  private func titleEdited(_ typed: String) {
    guard !leaving, let path, typed != VaultEditorView.name(of: path) else {
      return
    }
    onTitleSubmit(["title": typed])
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

  // MARK: - link completion

  /// shows, updates, or hides the `[[` popup for the caret. it runs on every edit and caret
  /// move; the vault's note names are ranked natively, so no keystroke waits for javascript.
  private func updateCompletion() {
    let selection = textView.selectedRange
    guard textView.isFirstResponder, document != nil, textView.markedTextRange == nil, selection.length == 0,
      let query = WikiLinkCompletion.query(in: textView.textStorage.mutableString, caret: selection.location)
    else {
      dismissedCompletionStart = nil
      hideCompletion()
      return
    }
    guard query.start != dismissedCompletionStart else {
      hideCompletion()
      return
    }
    var items: [WikiLinkCompletionView.Item] = []
    var inserts: [String] = []
    if query.isHeading {
      // `[[#`: headings of this note, best match first, in document order for ties.
      // a plain loop with explicit types: the chained version was too slow to type-check.
      let wanted = String(query.text.dropFirst())
      var ranked: [(offset: Int, title: String, score: Int)] = []
      for (offset, item) in textView.outline.enumerated() where !item.title.isEmpty {
        if let score = WikiLinkTargets.score(wanted, in: item.title) {
          ranked.append((offset: offset, title: item.title, score: score))
        }
      }
      ranked.sort { a, b in
        a.score != b.score ? a.score > b.score : a.offset < b.offset
      }
      for heading in ranked.prefix(6) {
        items.append(.init(title: heading.title, detail: nil, isHeading: true))
        inserts.append("#" + heading.title)
      }
    } else if let targets = targets() {
      for suggestion in targets.suggestions(for: query.text, from: path) {
        items.append(.init(title: suggestion.name, detail: suggestion.folder.isEmpty ? nil : suggestion.folder, isHeading: false))
        inserts.append(suggestion.linkText)
      }
    }
    // nothing to offer when the only suggestion is what is already typed.
    let typedAlready = inserts.count == 1 && inserts[0].caseInsensitiveCompare(query.text) == .orderedSame
    guard !items.isEmpty, !typedAlready, let layout = completionLayout(rows: items.count) else {
      hideCompletion()
      return
    }
    let appearing = completion.isHidden
    completionQuery = query
    completionInserts = Array(inserts.prefix(layout.rows))
    completion.show(Array(items.prefix(layout.rows)))
    completion.frame = layout.frame
    completion.isHidden = false
    if appearing {
      UIAccessibility.post(notification: .announcement, argument: "\(layout.rows) link suggestions")
    }
  }

  /// below the caret's line, or above it when the keyboard leaves more room there. fewer rows
  /// are shown when the visible text is short; nil when none fit or the caret is off screen.
  private func completionLayout(rows wanted: Int) -> (frame: CGRect, rows: Int)? {
    guard wanted > 0, let range = textView.selectedTextRange else { return nil }
    let caret = textView.convert(textView.caretRect(for: range.end), to: self)
    let top = textView.frame.minY + textView.adjustedContentInset.top + 4
    let bottom = textView.frame.maxY - textView.adjustedContentInset.bottom - 4
    guard caret.maxY > top, caret.minY < bottom else { return nil }
    let gap: CGFloat = 6
    func fit(_ space: CGFloat) -> Int {
      max(0, min(wanted, Int((space - WikiLinkCompletionView.height(rows: 0)) / WikiLinkCompletionView.rowHeight)))
    }
    let rowsBelow = fit(bottom - caret.maxY - gap)
    let rowsAbove = fit(caret.minY - gap - top)
    let rows = max(rowsBelow, rowsAbove)
    guard rows > 0 else { return nil }
    let height = WikiLinkCompletionView.height(rows: rows)
    let y = rowsBelow >= rows ? caret.maxY + gap : caret.minY - gap - height
    let width = min(WikiLinkCompletionView.width, bounds.width - 16)
    let x = min(max(8, caret.minX - 16), bounds.width - width - 8)
    return (CGRect(x: x, y: y, width: width, height: height), rows)
  }

  /// follows the caret while the text scrolls; hides the popup when its rows no longer fit.
  private func positionCompletion() {
    guard let layout = completionLayout(rows: completion.items.count), layout.rows == completion.items.count else {
      hideCompletion()
      return
    }
    completion.frame = layout.frame
  }

  private func hideCompletion() {
    completion.isHidden = true
    completion.show([])
    completionQuery = nil
    completionInserts = []
  }

  /// replaces the typed target with the chosen link and puts the caret after it. the edit goes
  /// through UITextInput, so it is one undo step.
  private func acceptCompletion(at index: Int) {
    guard let query = completionQuery, index < completionInserts.count else { return }
    let edit = query.edit(inserting: completionInserts[index])
    // the finished link stays without a popup until the caret leaves it.
    dismissedCompletionStart = query.start
    hideCompletion()
    guard
      let start = textView.position(from: textView.beginningOfDocument, offset: edit.range.location),
      let end = textView.position(from: start, offset: edit.range.length),
      let range = textView.textRange(from: start, to: end)
    else {
      return
    }
    textView.replace(range, withText: edit.text)
    textView.selectedRange = NSRange(location: edit.caret, length: 0)
    noteEdited()
  }

  /// with the popup open, a hardware keyboard's arrows move the highlight, tab chooses it, and
  /// escape closes the popup. return is handled with the other text changes.
  public override var keyCommands: [UIKeyCommand]? {
    guard !completion.isHidden else {
      return super.keyCommands
    }
    let commands = [
      UIKeyCommand(input: UIKeyCommand.inputUpArrow, modifierFlags: [], action: #selector(highlightPreviousSuggestion)),
      UIKeyCommand(input: UIKeyCommand.inputDownArrow, modifierFlags: [], action: #selector(highlightNextSuggestion)),
      UIKeyCommand(input: "\t", modifierFlags: [], action: #selector(chooseHighlightedSuggestion)),
      UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(dismissSuggestions)),
    ]
    for command in commands {
      command.wantsPriorityOverSystemBehavior = true
    }
    return commands
  }

  @objc private func highlightPreviousSuggestion() {
    completion.moveHighlight(by: -1)
  }

  @objc private func highlightNextSuggestion() {
    completion.moveHighlight(by: 1)
  }

  @objc private func chooseHighlightedSuggestion() {
    acceptCompletion(at: completion.highlighted)
  }

  @objc private func dismissSuggestions() {
    dismissedCompletionStart = completionQuery?.start
    hideCompletion()
  }

  // MARK: - wikilinks

  private func targets() -> WikiLinkTargets? {
    vaultId.flatMap { VaultRuntime.shared.linkTargets($0) }
  }

  private func resolution(of reference: WikiLinkReference) -> WikiLinkResolution {
    if reference.target.isEmpty {
      return .resolved
    }
    guard let targets = targets() else {
      // before the first listing, links keep the normal link color.
      return .unknown
    }
    return targets.resolve(reference.target, from: path) == nil ? .unresolved : .resolved
  }

  /// a link to this note only moves to its heading. any other link goes to javascript, which
  /// opens the note, or creates it when no note matches. returns true: the tap is handled.
  private func follow(_ reference: WikiLinkReference) -> Bool {
    let resolved = reference.target.isEmpty ? path : targets()?.resolve(reference.target, from: path)
    if let resolved, resolved == path {
      if let heading = reference.heading {
        pendingHeading = heading
        showPendingHeading(in: textView.outline)
      }
      return true
    }
    if let resolved, let vaultId {
      // the note opens in a new editor view, which takes the heading.
      VaultRuntime.shared.setPendingHeading(reference.heading, vaultId: vaultId, path: resolved)
    }
    var payload: [String: Any] = ["target": reference.target]
    if let resolved {
      payload["path"] = resolved
    }
    onOpenLink(payload)
    return true
  }

  /// puts the caret on the pending heading once the note it belongs to is open and parsed.
  /// `[[note#a#b]]` names heading "b" under "a"; the last part is matched, ignoring case.
  private func showPendingHeading(in outline: [OutlineItem]) {
    guard let heading = pendingHeading, document != nil else {
      return
    }
    let wanted = (heading.split(separator: "#").last.map(String.init) ?? heading)
      .trimmingCharacters(in: .whitespaces)
    guard let item = outline.first(where: { $0.title.trimmingCharacters(in: .whitespaces).caseInsensitiveCompare(wanted) == .orderedSame }) else {
      return
    }
    pendingHeading = nil
    textView.select(NSRange(location: item.headingLocation, length: 0))
  }

  // MARK: - status

  private func emit(_ payload: [String: Any]) {
    let status = payload["status"] as? String
    // no on-screen text names the routine save states, so ui tests read them from this
    // identifier, for example "note-status:saved". voiceover does not speak identifiers.
    textView.accessibilityIdentifier = status.map { "note-status:\($0)" }
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
