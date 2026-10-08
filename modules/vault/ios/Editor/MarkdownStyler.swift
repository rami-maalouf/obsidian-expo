import UIKit
import os

/// shows restrained markdown styling (u3) by giving TextKit 2 styled copies of the paragraphs
/// it displays. the text storage keeps plain text, so the saved bytes, the selection, keyboard
/// composition, and undo never see a style. used only on the main thread.
final class MarkdownStyler: NSObject, NSTextContentStorageDelegate, @unchecked Sendable {
  private static let log = Logger(subsystem: "com.ramimaalouf.obsidianexpo", category: "editor")

  private weak var contentStorage: NSTextContentStorage?
  private var blocks: [MarkdownStyle.Block] = []
  private var blocksLength = 0
  private var observer: NSObjectProtocol?
  private var loggedFirstParagraph = false
  /// where front matter or a code fence changed in the last edit; the paragraphs from there to
  /// the end keep their old styling until `refresh` rebuilds them.
  private(set) var staleFrom: Int?

  /// returns nil, leaving the editor unstyled, when TextKit 2 is not in use or the content
  /// storage already has a delegate.
  init?(contentStorage: NSTextContentStorage?) {
    guard let contentStorage, let textStorage = contentStorage.textStorage else {
      MarkdownStyler.log.error("source styling off: no TextKit 2 content storage is available")
      return nil
    }
    guard contentStorage.delegate == nil else {
      MarkdownStyler.log.error("source styling off: the content storage already has a delegate")
      return nil
    }
    super.init()
    self.contentStorage = contentStorage
    contentStorage.delegate = self
    // posted before the storage processes an edit; the text already holds the change.
    observer = NotificationCenter.default.addObserver(
      forName: NSTextStorage.willProcessEditingNotification, object: textStorage, queue: nil
    ) { [weak self] note in
      guard let storage = note.object as? NSTextStorage else { return }
      self?.textStorageWillProcessEditing(storage)
    }
  }

  deinit {
    if let observer {
      NotificationCenter.default.removeObserver(observer)
    }
  }

  // MARK: - NSTextContentStorageDelegate

  func textContentStorage(_ textContentStorage: NSTextContentStorage, textParagraphWith range: NSRange) -> NSTextParagraph? {
    guard let textStorage = textContentStorage.textStorage, range.length > 0, NSMaxRange(range) <= textStorage.length else {
      return nil
    }
    updateBlocks(textStorage)
    let paragraph = NSMutableAttributedString(attributedString: textStorage.attributedSubstring(from: range))
    let block = MarkdownStyle.block(containing: range.location, in: blocks)?.kind
    let spans = MarkdownStyle.spans(paragraph: paragraph.string as NSString, in: block)
    guard !spans.isEmpty else {
      return nil
    }
    // derive every font from the stored one, which follows Dynamic Type.
    let base = paragraph.attribute(.font, at: 0, effectiveRange: nil) as? UIFont ?? UIFont.preferredFont(forTextStyle: .body)
    for span in spans {
      apply(span, base: base, to: paragraph)
    }
    if !loggedFirstParagraph {
      loggedFirstParagraph = true
      MarkdownStyler.log.notice("source styling on: styled the first paragraph")
    }
    return NSTextParagraph(attributedString: paragraph)
  }

  private func apply(_ span: MarkdownStyle.Span, base: UIFont, to paragraph: NSMutableAttributedString) {
    switch span.kind {
    case let .heading(level):
      let scales: [CGFloat] = [1.4, 1.25, 1.15, 1.05, 1, 1]
      let descriptor = base.fontDescriptor.withSymbolicTraits(.traitBold) ?? base.fontDescriptor
      let font = UIFont(descriptor: descriptor, size: base.pointSize * scales[min(max(level, 1), 6) - 1])
      paragraph.addAttribute(.font, value: font, range: span.range)
    case .marker, .frontmatter:
      paragraph.addAttribute(.foregroundColor, value: UIColor.secondaryLabel, range: span.range)
    case .code:
      let font = UIFont.monospacedSystemFont(ofSize: base.pointSize * 0.94, weight: .regular)
      paragraph.addAttribute(.font, value: font, range: span.range)
    case .link:
      paragraph.addAttribute(.foregroundColor, value: UIColor.link, range: span.range)
    }
  }

  // MARK: - edits

  /// a safety net: every character edit already rescans the blocks before layout asks for a
  /// paragraph.
  private func updateBlocks(_ textStorage: NSTextStorage) {
    guard blocksLength != textStorage.length else {
      return
    }
    blocks = MarkdownStyle.blocks(in: textStorage.string as NSString)
    blocksLength = textStorage.length
  }

  private func textStorageWillProcessEditing(_ textStorage: NSTextStorage) {
    guard textStorage.editedMask.contains(.editedCharacters) else {
      return
    }
    let edited = textStorage.editedRange
    let delta = textStorage.changeInLength
    let previous = blocks
    blocks = MarkdownStyle.blocks(in: textStorage.string as NSString)
    blocksLength = textStorage.length
    if edited.location == 0, edited.length == textStorage.length {
      // the whole text was replaced, so every paragraph is rebuilt anyway.
      staleFrom = nil
      return
    }
    if let changed = MarkdownStyle.firstChange(from: previous, to: blocks, edited: edited, delta: delta) {
      staleFrom = min(staleFrom ?? changed, changed)
    }
  }

  /// rebuilds the paragraphs whose styling an edit made stale, without changing any text.
  func refresh() {
    guard let from = staleFrom, let contentStorage, let textStorage = contentStorage.textStorage else {
      return
    }
    staleFrom = nil
    let start = min(from, textStorage.length)
    let range = NSRange(location: start, length: textStorage.length - start)
    guard range.length > 0 else {
      return
    }
    contentStorage.performEditingTransaction {
      textStorage.edited(.editedAttributes, range: range, changeInLength: 0)
    }
  }
}
