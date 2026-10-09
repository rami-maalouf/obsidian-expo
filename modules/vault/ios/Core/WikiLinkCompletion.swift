import Foundation

/// the target of a `[[wikilink]]` being typed at the caret.
public struct WikiLinkQuery: Equatable, Sendable {
  /// the UTF-16 offset just after `[[`.
  public let start: Int
  /// the text between `[[` and the caret.
  public let text: String
  /// the range a chosen suggestion replaces. it starts at `start` and, when the caret is inside
  /// an existing link, also covers the rest of its target (and its `]]`, if it has one).
  public let replaceRange: NSRange
  /// whether the replacement ends with `]]`: false when an alias or heading (`|`, `#`) follows.
  public let endsWithClose: Bool

  /// a heading in the open note (`[[#heading`), rather than another note.
  public var isHeading: Bool {
    text.hasPrefix("#")
  }

  /// the edit for a chosen link text: the range to replace, its new text, and the caret after it.
  public func edit(inserting linkText: String) -> (range: NSRange, text: String, caret: Int) {
    let text = endsWithClose ? linkText + "]]" : linkText
    return (replaceRange, text, replaceRange.location + (text as NSString).length)
  }
}

public enum WikiLinkCompletion {
  /// how far from the caret `[[` and `]]` are looked for, in UTF-16 units.
  static let reach = 300

  /// the link target being typed: the caret is after `[[` on the same line, and the characters
  /// between them include no `[`, `]`, or `|`. a `#` after a note name (`[[note#`) ends
  /// completion; a target that starts with `#` asks for a heading in the open note.
  public static func query(in text: NSString, caret: Int) -> WikiLinkQuery? {
    guard caret >= 2, caret <= text.length else { return nil }
    let lower = max(0, caret - reach)
    var index = caret - 1
    var found: Int?
    while index > lower {
      let unit = text.character(at: index)
      if isLineBreak(unit) || unit == close || unit == bar {
        return nil
      }
      if unit == open {
        guard text.character(at: index - 1) == open else { return nil }
        found = index + 1
        break
      }
      index -= 1
    }
    guard let start = found else { return nil }
    let typed = text.substring(with: NSRange(location: start, length: caret - start))
    if let hash = typed.firstIndex(of: "#"), hash != typed.startIndex {
      return nil
    }

    // after the caret: the rest of an existing link's target, if the caret is inside one.
    let upper = min(text.length, caret + reach)
    var end = caret
    while end < upper {
      let unit = text.character(at: end)
      if unit == close {
        if end + 1 < text.length, text.character(at: end + 1) == close {
          return WikiLinkQuery(start: start, text: typed, replaceRange: NSRange(location: start, length: end + 2 - start), endsWithClose: true)
        }
        break
      }
      if unit == bar || (unit == hashMark && !typed.hasPrefix("#")) {
        return WikiLinkQuery(start: start, text: typed, replaceRange: NSRange(location: start, length: end - start), endsWithClose: false)
      }
      if isLineBreak(unit) || unit == open {
        break
      }
      end += 1
    }
    // a new link: the text after the caret is not part of it.
    return WikiLinkQuery(start: start, text: typed, replaceRange: NSRange(location: start, length: caret - start), endsWithClose: true)
  }

  private static let open: unichar = 0x5B // [
  private static let close: unichar = 0x5D // ]
  private static let bar: unichar = 0x7C // |
  private static let hashMark: unichar = 0x23 // #

  private static func isLineBreak(_ unit: unichar) -> Bool {
    unit == 0x0A || unit == 0x0D || unit == 0x2028 || unit == 0x2029
  }
}
