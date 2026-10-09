import Foundation

/// finds the note a `[[wikilink]]` points to among the vault's markdown notes, and suggests notes
/// while a link is typed.
///
/// a target without "/" names a note (`[[Meeting notes]]`); a target with "/" is a vault path or
/// the end of one (`[[Projects/Plan]]` matches `Work/Projects/Plan.md`). matching ignores case,
/// unicode normalization, surrounding spaces, and a trailing ".md". when several notes match, a
/// note in the linking note's folder wins, then the shortest path, then the first path in sorted
/// order, so the same link always opens the same note.
public struct WikiLinkTargets: Sendable {
  /// a note in the listing: its vault path and, when known, its modification time.
  public struct Note: Sendable {
    public let path: String
    public let modified: Date?

    public init(path: String, modified: Date? = nil) {
      self.path = path
      self.modified = modified
    }
  }

  private struct Entry: Sendable {
    let path: String
    let name: String
    let folder: String
    /// the name and the path without ".md", folded for suggestions (case, accents, width).
    let foldedName: [UInt16]
    let foldedStem: [UInt16]
    let modified: Double
  }

  /// note name key -> vault paths with that name.
  private let byName: [String: [String]]
  private let entries: [Entry]

  public init(paths: [String]) {
    self.init(notes: paths.map { Note(path: $0) })
  }

  public init(notes: [Note]) {
    var byName: [String: [String]] = [:]
    var entries: [Entry] = []
    for note in notes {
      guard let name = WikiLinkTargets.noteName(of: note.path) else { continue }
      byName[WikiLinkTargets.key(name), default: []].append(note.path)
      entries.append(Entry(
        path: note.path,
        name: name,
        folder: WikiLinkTargets.folder(of: note.path),
        foldedName: WikiLinkTargets.folded(name),
        foldedStem: WikiLinkTargets.folded(String(note.path.dropLast(3))),
        modified: note.modified?.timeIntervalSince1970 ?? 0
      ))
    }
    self.byName = byName
    self.entries = entries
  }

  /// the vault path of the note `target` names, or nil. `source` is the linking note's path.
  public func resolve(_ target: String, from source: String?) -> String? {
    var wanted = WikiLinkTargets.key(target.trimmingCharacters(in: .whitespaces))
    if wanted.hasSuffix(".md") {
      wanted.removeLast(3)
    }
    while wanted.hasPrefix("/") {
      wanted.removeFirst()
    }
    let name = wanted.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? ""
    guard !name.isEmpty, var candidates = byName[name] else {
      return nil
    }
    if wanted.contains("/") {
      candidates = candidates.filter { path in
        let stem = WikiLinkTargets.key(String(path.dropLast(3)))
        return stem == wanted || stem.hasSuffix("/" + wanted)
      }
    }
    let folder = source.map(WikiLinkTargets.folder(of:))
    return candidates.min { a, b in
      let aNear = WikiLinkTargets.folder(of: a) == folder
      let bNear = WikiLinkTargets.folder(of: b) == folder
      if aNear != bNear { return aNear }
      if a.utf16.count != b.utf16.count { return a.utf16.count < b.utf16.count }
      return a < b
    }
  }

  /// notes for a link being typed, best first; the linking note itself is left out.
  ///
  /// an empty query lists the most recently modified notes first. otherwise the query is matched
  /// against note names (or against vault paths when it contains "/"), ignoring case and
  /// accents: an exact name, then a name that starts with the query, then a word that starts
  /// with it, then any substring, then the query's characters in order. ties prefer the
  /// linking note's folder, then recent notes, then shorter names.
  public func suggestions(for query: String, from source: String?, limit: Int = 6) -> [WikiLinkSuggestion] {
    let trimmed = query.trimmingCharacters(in: .whitespaces)
    let needle = WikiLinkTargets.folded(trimmed)
    let byPath = trimmed.contains("/")
    let folder = source.map(WikiLinkTargets.folder(of:))
    var scored: [(entry: Entry, score: Int)] = []
    for entry in entries where entry.path != source {
      guard let score = WikiLinkTargets.score(needle, in: byPath ? entry.foldedStem : entry.foldedName) else { continue }
      scored.append((entry, score))
    }
    scored.sort { a, b in
      if a.score != b.score { return a.score > b.score }
      let aNear = !needle.isEmpty && a.entry.folder == folder
      let bNear = !needle.isEmpty && b.entry.folder == folder
      if aNear != bNear { return aNear }
      if a.entry.modified != b.entry.modified { return a.entry.modified > b.entry.modified }
      if a.entry.name.utf16.count != b.entry.name.utf16.count { return a.entry.name.utf16.count < b.entry.name.utf16.count }
      return a.entry.path < b.entry.path
    }
    return scored.prefix(limit).map { item in
      WikiLinkSuggestion(
        path: item.entry.path,
        name: item.entry.name,
        folder: item.entry.folder,
        linkText: linkText(for: item.entry, from: source)
      )
    }
  }

  /// the note's name when that name opens this note from `source`; otherwise its path.
  private func linkText(for entry: Entry, from source: String?) -> String {
    resolve(entry.name, from: source) == entry.path ? entry.name : String(entry.path.dropLast(3))
  }

  /// how well `query` matches `candidate` (both folded); higher is better, nil is no match.
  /// an empty query matches everything equally.
  static func score(_ query: [UInt16], in candidate: [UInt16]) -> Int? {
    if query.isEmpty {
      return 0
    }
    if candidate == query {
      return 4000
    }
    if candidate.starts(with: query) {
      return 3000 - min(candidate.count - query.count, 999)
    }
    if let at = firstIndex(of: query, in: candidate) {
      let wordStart = isSeparator(candidate[at - 1])
      return (wordStart ? 2000 : 1000) - min(at, 999)
    }
    // the query's characters in order, with fewer and shorter gaps scoring higher.
    var next = 0
    var first = -1
    var last = -1
    var gaps = 0
    for (index, unit) in candidate.enumerated() where next < query.count && unit == query[next] {
      if last >= 0 {
        gaps += index - last - 1
      } else {
        first = index
      }
      last = index
      next += 1
    }
    guard next == query.count else {
      return nil
    }
    return max(1, 500 - gaps * 10 - first)
  }

  /// a fuzzy match score for strings that are not notes, such as headings; nil is no match.
  public static func score(_ query: String, in candidate: String) -> Int? {
    score(folded(query.trimmingCharacters(in: .whitespaces)), in: folded(candidate))
  }

  private static func firstIndex(of needle: [UInt16], in haystack: [UInt16]) -> Int? {
    guard needle.count <= haystack.count else { return nil }
    for start in 0...(haystack.count - needle.count) where haystack[start] == needle[0] {
      if haystack[start..<(start + needle.count)].elementsEqual(needle) {
        return start
      }
    }
    return nil
  }

  private static func isSeparator(_ unit: UInt16) -> Bool {
    // space, "-", "_", ".", "/", "(", and "["
    [0x20, 0x2D, 0x5F, 0x2E, 0x2F, 0x28, 0x5B].contains(unit)
  }

  /// the file name without ".md", or nil for a path that is not a markdown note.
  static func noteName(of path: String) -> String? {
    let file = path.split(separator: "/").last.map(String.init) ?? path
    guard file.lowercased().hasSuffix(".md"), file.count > 3 else { return nil }
    return String(file.dropLast(3))
  }

  static func folder(of path: String) -> String {
    guard let slash = path.lastIndex(of: "/") else { return "" }
    return String(path[..<slash])
  }

  static func key(_ text: String) -> String {
    text.precomposedStringWithCanonicalMapping.lowercased()
  }

  static func folded(_ text: String) -> [UInt16] {
    Array(text.precomposedStringWithCanonicalMapping
      .folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil).utf16)
  }
}

/// a note offered while a link is typed.
public struct WikiLinkSuggestion: Equatable, Sendable {
  public let path: String
  /// the note's file name without ".md".
  public let name: String
  /// the note's folder, or "" for the vault root.
  public let folder: String
  /// the text that goes between `[[` and `]]`.
  public let linkText: String
}
