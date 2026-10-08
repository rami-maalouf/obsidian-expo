import Foundation

/// restrained markdown source styling for the editor (u3). styling never changes the text: the
/// editor applies these spans only to the paragraphs it displays, so the saved bytes, the
/// selection, keyboard composition, and undo never see a style. offsets are utf-16 units, like
/// NSString and UITextView.
public enum MarkdownStyle {
  public enum Kind: Equatable, Sendable {
    /// a whole heading line, level 1 to 6.
    case heading(Int)
    /// syntax characters: heading hashes, quote markers, list bullets, task boxes, and fences.
    case marker
    /// inline code, or a line of a fenced code block.
    case code
    /// a wikilink or an embed, with its brackets.
    case link
    /// a line of the front matter, with its delimiters.
    case frontmatter
  }

  public struct Span: Equatable, Sendable {
    public let kind: Kind
    public let range: NSRange

    public init(_ kind: Kind, _ location: Int, _ length: Int) {
      self.kind = kind
      self.range = NSRange(location: location, length: length)
    }
  }

  public enum BlockKind: Equatable, Sendable {
    case code
    case frontmatter
  }

  /// whole paragraphs, from the opening delimiter through the closing one, or to the end of the
  /// text when a code fence is not closed.
  public struct Block: Equatable, Sendable {
    public let kind: BlockKind
    public let range: NSRange

    public init(_ kind: BlockKind, _ location: Int, _ length: Int) {
      self.kind = kind
      self.range = NSRange(location: location, length: length)
    }
  }

  /// longer paragraphs get only line-start styling, so one very long line cannot slow layout.
  static let inlineLimit = 10_000

  // MARK: - blocks

  /// front matter and fenced code blocks, found in one pass over the paragraphs.
  public static func blocks(in text: NSString) -> [Block] {
    var blocks: [Block] = []
    let length = text.length
    var location = 0
    if let end = frontmatterEnd(in: text) {
      blocks.append(Block(.frontmatter, 0, end))
      location = end
    }
    var open: (start: Int, fence: Fence)?
    while location < length {
      let line = paragraph(in: text, at: location)
      if let current = open {
        if closes(text, line.start, line.contentsEnd, current.fence) {
          blocks.append(Block(.code, current.start, line.end - current.start))
          open = nil
        }
      } else if let opening = fence(in: text, line.start, line.contentsEnd) {
        open = (start: line.start, fence: opening)
      }
      location = line.end
    }
    if let current = open {
      blocks.append(Block(.code, current.start, length - current.start))
    }
    return blocks
  }

  /// the block that holds the paragraph starting at `location`, if any.
  public static func block(containing location: Int, in blocks: [Block]) -> Block? {
    var low = 0
    var high = blocks.count
    while low < high {
      let middle = (low + high) / 2
      if blocks[middle].range.location <= location {
        low = middle + 1
      } else {
        high = middle
      }
    }
    guard low > 0 else {
      return nil
    }
    let candidate = blocks[low - 1]
    return location < NSMaxRange(candidate.range) ? candidate : nil
  }

  /// the first position where the block structure differs after an edit, with the old blocks
  /// moved through the edit; nil when no paragraph outside the edit changes block. `edited` and
  /// `delta` are NSTextStorage's editedRange and changeInLength.
  public static func firstChange(from previous: [Block], to current: [Block], edited: NSRange, delta: Int) -> Int? {
    let editStart = edited.location
    let oldEditEnd = NSMaxRange(edited) - delta
    func move(_ position: Int) -> Int? {
      if position <= editStart { return position }
      if position >= oldEditEnd { return position + delta }
      return nil
    }
    let count = max(previous.count, current.count)
    for index in 0..<count {
      guard index < previous.count else {
        return current[index].range.location
      }
      guard index < current.count else {
        return move(previous[index].range.location) ?? editStart
      }
      let old = previous[index]
      let new = current[index]
      let start = move(old.range.location)
      let end = move(NSMaxRange(old.range))
      guard old.kind == new.kind, start == new.range.location else {
        return min(new.range.location, start ?? editStart)
      }
      if end != NSMaxRange(new.range) {
        // the block now closes earlier or later; the paragraphs between the two ends changed.
        return min(NSMaxRange(new.range), end ?? editStart)
      }
    }
    return nil
  }

  struct Fence: Equatable {
    let character: unichar
    let count: Int
  }

  static func paragraph(in text: NSString, at location: Int) -> (start: Int, end: Int, contentsEnd: Int) {
    var start = 0
    var end = 0
    var contentsEnd = 0
    text.getParagraphStart(&start, end: &end, contentsEnd: &contentsEnd, for: NSRange(location: location, length: 0))
    return (start, end, contentsEnd)
  }

  /// up to three spaces, then three or more backticks or tildes. the info string after a
  /// backtick fence cannot contain a backtick.
  static func fence(in text: NSString, _ start: Int, _ contentsEnd: Int) -> Fence? {
    var index = start
    while index < contentsEnd, index - start < 3, text.character(at: index) == space {
      index += 1
    }
    guard index < contentsEnd else {
      return nil
    }
    let character = text.character(at: index)
    guard character == backtick || character == tilde else {
      return nil
    }
    var count = 0
    while index < contentsEnd, text.character(at: index) == character {
      index += 1
      count += 1
    }
    guard count >= 3 else {
      return nil
    }
    if character == backtick {
      while index < contentsEnd {
        if text.character(at: index) == backtick {
          return nil
        }
        index += 1
      }
    }
    return Fence(character: character, count: count)
  }

  /// a closing fence uses the same character, at least as many times, and nothing else.
  static func closes(_ text: NSString, _ start: Int, _ contentsEnd: Int, _ fence: Fence) -> Bool {
    var index = start
    while index < contentsEnd, index - start < 3, text.character(at: index) == space {
      index += 1
    }
    var count = 0
    while index < contentsEnd, text.character(at: index) == fence.character {
      index += 1
      count += 1
    }
    guard count >= fence.count else {
      return false
    }
    while index < contentsEnd {
      guard isBlank(text.character(at: index)) else {
        return false
      }
      index += 1
    }
    return true
  }

  /// obsidian front matter: the text starts with a `---` line, and a later `---` line closes it.
  static func frontmatterEnd(in text: NSString) -> Int? {
    guard text.length > 0 else {
      return nil
    }
    let first = paragraph(in: text, at: 0)
    guard first.end > first.contentsEnd, isDelimiter(text, first.start, first.contentsEnd) else {
      return nil
    }
    var location = first.end
    while location < text.length {
      let line = paragraph(in: text, at: location)
      if isDelimiter(text, line.start, line.contentsEnd) {
        return line.end
      }
      location = line.end
    }
    return nil
  }

  static func isDelimiter(_ text: NSString, _ start: Int, _ contentsEnd: Int) -> Bool {
    guard contentsEnd - start >= 3 else {
      return false
    }
    for index in start..<start + 3 where text.character(at: index) != hyphen {
      return false
    }
    for index in start + 3..<contentsEnd where !isBlank(text.character(at: index)) {
      return false
    }
    return true
  }

  // MARK: - spans

  /// spans for one paragraph, relative to its start. `block` is the block that holds it.
  public static func spans(paragraph: NSString, in block: BlockKind?) -> [Span] {
    let contents = paragraph.length == 0 ? 0 : MarkdownStyle.paragraph(in: paragraph, at: 0).contentsEnd
    guard contents > 0 else {
      return []
    }
    switch block {
    case .frontmatter:
      return [Span(.frontmatter, 0, contents)]
    case .code:
      var spans = [Span(.code, 0, contents)]
      if fence(in: paragraph, 0, contents) != nil {
        spans.append(Span(.marker, 0, contents))
      }
      return spans
    case nil:
      return lineSpans(paragraph, contents)
    }
  }

  static func lineSpans(_ line: NSString, _ contents: Int) -> [Span] {
    var spans: [Span] = []
    let inlineStart: Int
    // a heading: up to three spaces, one to six hashes, then a space, a tab, or the line end.
    var indent = 0
    while indent < contents, indent < 3, line.character(at: indent) == space {
      indent += 1
    }
    var hashes = 0
    while indent + hashes < contents, line.character(at: indent + hashes) == hash {
      hashes += 1
    }
    if (1...6).contains(hashes), indent + hashes == contents || isBlank(line.character(at: indent + hashes)) {
      spans.append(Span(.heading(hashes), 0, contents))
      spans.append(Span(.marker, indent, hashes))
      inlineStart = indent + hashes
    } else {
      inlineStart = quoteAndListMarkers(line, contents, &spans)
    }
    if contents <= inlineLimit {
      inlineSpans(line, from: inlineStart, to: contents, into: &spans)
    }
    return spans
  }

  /// block quote markers (possibly nested), then a list bullet or number and a task box.
  /// returns where the paragraph's text starts.
  static func quoteAndListMarkers(_ line: NSString, _ contents: Int, _ spans: inout [Span]) -> Int {
    var index = 0
    while true {
      var probe = index
      while probe < contents, probe - index < 3, line.character(at: probe) == space {
        probe += 1
      }
      guard probe < contents, line.character(at: probe) == greater else {
        break
      }
      var end = probe + 1
      if end < contents, isBlank(line.character(at: end)) {
        end += 1
      }
      spans.append(Span(.marker, probe, end - probe))
      index = end
    }

    var probe = index
    while probe < contents, isBlank(line.character(at: probe)) {
      probe += 1
    }
    guard probe < contents else {
      return index
    }
    var markerEnd: Int?
    let first = line.character(at: probe)
    if first == hyphen || first == asterisk || first == plus {
      markerEnd = probe + 1
    } else if isDigit(first) {
      var digitsEnd = probe
      while digitsEnd < contents, digitsEnd - probe < 9, isDigit(line.character(at: digitsEnd)) {
        digitsEnd += 1
      }
      if digitsEnd < contents, line.character(at: digitsEnd) == period || line.character(at: digitsEnd) == closeParen {
        markerEnd = digitsEnd + 1
      }
    }
    guard let end = markerEnd, end < contents, isBlank(line.character(at: end)) else {
      return index
    }
    spans.append(Span(.marker, probe, end - probe))
    var next = end + 1
    // a task box: "[ ]", "[x]", or another single character, then a space or the line end.
    if next + 3 <= contents, line.character(at: next) == openBracket, line.character(at: next + 2) == closeBracket,
       next + 3 == contents || isBlank(line.character(at: next + 3)) {
      spans.append(Span(.marker, next, 3))
      next += 3
    }
    return next
  }

  /// inline code first, then wikilinks and embeds outside code. both passes are linear.
  static func inlineSpans(_ line: NSString, from start: Int, to end: Int, into spans: inout [Span]) {
    // every run of backticks; a code span closes at the next run of the same length.
    var runs: [(location: Int, length: Int)] = []
    var index = start
    while index < end {
      if line.character(at: index) == backtick {
        var length = 0
        while index + length < end, line.character(at: index + length) == backtick {
          length += 1
        }
        runs.append((location: index, length: length))
        index += length
      } else {
        index += 1
      }
    }
    var runsByLength: [Int: [Int]] = [:]
    for (offset, run) in runs.enumerated() {
      runsByLength[run.length, default: []].append(offset)
    }
    var cursors: [Int: Int] = [:]
    var code: [NSRange] = []
    var current = 0
    while current < runs.count {
      let opener = runs[current]
      let candidates = runsByLength[opener.length] ?? []
      var cursor = cursors[opener.length] ?? 0
      while cursor < candidates.count, candidates[cursor] <= current {
        cursor += 1
      }
      cursors[opener.length] = cursor
      if cursor < candidates.count {
        let closer = runs[candidates[cursor]]
        let range = NSRange(location: opener.location, length: closer.location + closer.length - opener.location)
        code.append(range)
        spans.append(Span(.code, range.location, range.length))
        current = candidates[cursor] + 1
      } else {
        current += 1
      }
    }

    index = start
    var nextCode = 0
    while index + 1 < end {
      if nextCode < code.count, index >= code[nextCode].location {
        index = max(index, NSMaxRange(code[nextCode]))
        nextCode += 1
        continue
      }
      let limit = nextCode < code.count ? code[nextCode].location : end
      if line.character(at: index) == openBracket, line.character(at: index + 1) == openBracket {
        let close = index + 2 < limit
          ? line.range(of: "]]", options: .literal, range: NSRange(location: index + 2, length: limit - index - 2))
          : NSRange(location: NSNotFound, length: 0)
        guard close.location != NSNotFound else {
          // no later "[[" before the limit can close either.
          index = limit
          continue
        }
        // "[[a [[b]]" links only "b", as a link target cannot contain "[[".
        let inner = line.range(of: "[[", options: [.literal, .backwards], range: NSRange(location: index, length: close.location - index))
        let opening = inner.location == NSNotFound ? index : inner.location
        let begin = opening > start && line.character(at: opening - 1) == bang ? opening - 1 : opening
        spans.append(Span(.link, begin, NSMaxRange(close) - begin))
        index = NSMaxRange(close)
        continue
      }
      index += 1
    }
  }

  // MARK: - characters

  static let tab: unichar = 0x09
  static let space: unichar = 0x20
  static let bang: unichar = 0x21
  static let hash: unichar = 0x23
  static let closeParen: unichar = 0x29
  static let asterisk: unichar = 0x2A
  static let plus: unichar = 0x2B
  static let hyphen: unichar = 0x2D
  static let period: unichar = 0x2E
  static let greater: unichar = 0x3E
  static let openBracket: unichar = 0x5B
  static let closeBracket: unichar = 0x5D
  static let backtick: unichar = 0x60
  static let tilde: unichar = 0x7E

  static func isBlank(_ character: unichar) -> Bool {
    character == space || character == tab
  }

  static func isDigit(_ character: unichar) -> Bool {
    character >= 0x30 && character <= 0x39
  }
}
