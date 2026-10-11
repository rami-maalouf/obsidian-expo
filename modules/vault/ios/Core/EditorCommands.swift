import Foundation

/// an edit from a toolbar command: the range to replace, its new text, and the selection after
/// the edit. ranges are UTF-16 offsets, as in `NSString`.
public struct TextEdit: Equatable, Sendable {
  public let range: NSRange
  public let text: String
  public let selection: NSRange

  public init(range: NSRange, text: String, selection: NSRange) {
    self.range = range
    self.text = text
    self.selection = selection
  }
}

/// the editing toolbar's task, link, and tag commands (t17). indent, outdent, bold, and italic
/// come from laperm. the rules and their cases are shared with the kotlin core
/// (`modules/vault/spec/editor-commands.txt`). each returns nil when it changes nothing.
public enum EditorCommands {
  /// on each line of the selection (or the caret's line): a plain line becomes `- [ ] line`, a
  /// list item gets a box after its marker, and a box is checked or cleared. blank lines in a
  /// selection of several lines are left alone. a leading `>` quote stays in front.
  public static func toggleTask(in text: NSString, selection: NSRange) -> TextEdit? {
    guard isValid(selection, in: text) else { return nil }
    let lines = lineStarts(in: text, selection: selection)
    let first = lines[0]
    let last = lineEnd(in: text, from: lines[lines.count - 1])
    var rebuilt = ""
    var insertions: [(at: Int, length: Int)] = []
    var changed = false
    var cursor = first
    for start in lines {
      let end = lineEnd(in: text, from: start)
      rebuilt += text.substring(with: NSRange(location: cursor, length: start - cursor))
      cursor = start
      if lines.count > 1, isBlank(text, from: start, to: end) {
        continue
      }
      let prefixEnd = quotePrefixEnd(in: text, from: start, to: end)
      rebuilt += text.substring(with: NSRange(location: cursor, length: prefixEnd - cursor))
      cursor = prefixEnd
      changed = true
      guard let content = listContentStart(in: text, at: prefixEnd, end: end) else {
        rebuilt += "- [ ] "
        insertions.append((prefixEnd, 6))
        continue
      }
      rebuilt += text.substring(with: NSRange(location: cursor, length: content - cursor))
      cursor = content
      if let box = checkboxState(in: text, at: content, end: end) {
        rebuilt += "["
        rebuilt += box == space ? "x" : " "
        cursor = content + 2
      } else {
        rebuilt += "[ ] "
        insertions.append((content, 4))
      }
    }
    guard changed else { return nil }
    rebuilt += text.substring(with: NSRange(location: cursor, length: last - cursor))
    func moved(_ offset: Int) -> Int {
      offset + insertions.filter { $0.at <= offset }.reduce(0) { $0 + $1.length }
    }
    let start = moved(selection.location)
    let end = moved(NSMaxRange(selection))
    return TextEdit(
      range: NSRange(location: first, length: last - first), text: rebuilt,
      selection: NSRange(location: start, length: end - start))
  }

  /// with no selection, inserts `[[]]` with the caret between the brackets, so the link
  /// suggestions open. a selection on one line becomes the link's target, with the caret before
  /// `]]`. spaces and tabs around the selection stay outside the link.
  public static func insertLink(in text: NSString, selection: NSRange) -> TextEdit? {
    guard isValid(selection, in: text) else { return nil }
    let target = trimmed(selection, in: text)
    guard target.length > 0 else {
      let at = selection.location
      return TextEdit(range: NSRange(location: at, length: 0), text: "[[]]", selection: NSRange(location: at + 2, length: 0))
    }
    let name = text.substring(with: target)
    guard name.rangeOfCharacter(from: CharacterSet(charactersIn: "\n\r[]")) == nil else { return nil }
    let caret = target.location + 2 + target.length
    return TextEdit(range: target, text: "[[" + name + "]]", selection: NSRange(location: caret, length: 0))
  }

  /// inserts `#` at the caret or before the selection, with a space before it when the
  /// character before is not a space, a tab, or a line break. the selection stays selected.
  public static func insertTag(in text: NSString, selection: NSRange) -> TextEdit? {
    guard isValid(selection, in: text) else { return nil }
    let at = selection.location
    let needsSpace = at > 0 && ![space, tab, lineFeed, carriageReturn].contains(text.character(at: at - 1))
    let inserted = needsSpace ? " #" : "#"
    let length = (inserted as NSString).length
    return TextEdit(
      range: NSRange(location: at, length: 0), text: inserted,
      selection: NSRange(location: at + length, length: selection.length))
  }

  // MARK: - lines

  private static let space = unichar(0x20)
  private static let tab = unichar(0x09)
  private static let lineFeed = unichar(0x0A)
  private static let carriageReturn = unichar(0x0D)

  private static func isValid(_ selection: NSRange, in text: NSString) -> Bool {
    selection.location != NSNotFound && selection.location >= 0 && selection.length >= 0
      && selection.location <= text.length && selection.length <= text.length - selection.location
  }

  private static func isLineBreak(_ unit: unichar) -> Bool {
    unit == lineFeed || unit == carriageReturn
  }

  private static func lineStart(in text: NSString, at offset: Int) -> Int {
    var index = offset
    while index > 0, !isLineBreak(text.character(at: index - 1)) {
      index -= 1
    }
    return index
  }

  private static func lineEnd(in text: NSString, from offset: Int) -> Int {
    var index = offset
    while index < text.length, !isLineBreak(text.character(at: index)) {
      index += 1
    }
    return index
  }

  /// the start of each line the selection touches. a selection that ends at the start of a
  /// line does not include that line.
  private static func lineStarts(in text: NSString, selection: NSRange) -> [Int] {
    var end = NSMaxRange(selection)
    if selection.length > 0, isLineBreak(text.character(at: end - 1)) {
      end -= 1
      // a "\r\n" pair is one line break.
      if end > selection.location, text.character(at: end) == lineFeed, text.character(at: end - 1) == carriageReturn {
        end -= 1
      }
    }
    var starts = [lineStart(in: text, at: selection.location)]
    var index = lineEnd(in: text, from: starts[0])
    while index < end {
      // a "\r\n" pair is one line break.
      if text.character(at: index) == carriageReturn, index + 1 < text.length, text.character(at: index + 1) == lineFeed {
        index += 1
      }
      index += 1
      starts.append(index)
      index = lineEnd(in: text, from: index)
    }
    return starts
  }

  private static func isBlank(_ text: NSString, from start: Int, to end: Int) -> Bool {
    (start..<end).allSatisfy { text.character(at: $0) == space || text.character(at: $0) == tab }
  }

  private static func skipSpaces(in text: NSString, from offset: Int, to end: Int, tabs: Bool) -> Int {
    var index = offset
    while index < end, text.character(at: index) == space || (tabs && text.character(at: index) == tab) {
      index += 1
    }
    return index
  }

  /// the end of the line's indentation and any `>` quote markers.
  private static func quotePrefixEnd(in text: NSString, from start: Int, to end: Int) -> Int {
    var index = skipSpaces(in: text, from: start, to: end, tabs: true)
    while index < end, text.character(at: index) == unichar(UnicodeScalar(">").value) {
      index = skipSpaces(in: text, from: index + 1, to: end, tabs: true)
    }
    return index
  }

  /// for a list marker (`-`, `*`, `+`, or one to nine digits and `.` or `)`) followed by a
  /// space, the offset after the marker and its spaces; nil when the line is not a list item.
  private static func listContentStart(in text: NSString, at offset: Int, end: Int) -> Int? {
    guard offset < end else { return nil }
    var index = offset
    let unit = text.character(at: index)
    if unit == unichar(UnicodeScalar("-").value) || unit == unichar(UnicodeScalar("*").value)
      || unit == unichar(UnicodeScalar("+").value)
    {
      index += 1
    } else {
      while index < end, index - offset < 10, (48...57).contains(text.character(at: index)) {
        index += 1
      }
      let digits = index - offset
      guard digits >= 1, digits <= 9, index < end else { return nil }
      let delimiter = text.character(at: index)
      guard delimiter == unichar(UnicodeScalar(".").value) || delimiter == unichar(UnicodeScalar(")").value) else {
        return nil
      }
      index += 1
    }
    guard index < end, text.character(at: index) == space else { return nil }
    return skipSpaces(in: text, from: index, to: end, tabs: false)
  }

  /// the state character of a `[ ]`, `[x]`, or `[X]` box at the offset, when a space or the end
  /// of the line follows it.
  private static func checkboxState(in text: NSString, at offset: Int, end: Int) -> unichar? {
    guard offset + 3 <= end, text.character(at: offset) == unichar(UnicodeScalar("[").value),
      text.character(at: offset + 2) == unichar(UnicodeScalar("]").value),
      offset + 3 == end || text.character(at: offset + 3) == space
    else {
      return nil
    }
    let state = text.character(at: offset + 1)
    guard state == space || state == unichar(UnicodeScalar("x").value) || state == unichar(UnicodeScalar("X").value) else {
      return nil
    }
    return state
  }

  /// the range without spaces and tabs at its ends.
  private static func trimmed(_ range: NSRange, in text: NSString) -> NSRange {
    var start = range.location
    var end = NSMaxRange(range)
    while start < end, text.character(at: start) == space || text.character(at: start) == tab {
      start += 1
    }
    while end > start, text.character(at: end - 1) == space || text.character(at: end - 1) == tab {
      end -= 1
    }
    return NSRange(location: start, length: end - start)
  }
}
