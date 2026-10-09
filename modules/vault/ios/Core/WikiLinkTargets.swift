import Foundation

/// finds the note a `[[wikilink]]` points to among the vault's markdown notes.
///
/// a target without "/" names a note (`[[Meeting notes]]`); a target with "/" is a vault path or
/// the end of one (`[[Projects/Plan]]` matches `Work/Projects/Plan.md`). matching ignores case,
/// unicode normalization, surrounding spaces, and a trailing ".md". when several notes match, a
/// note in the linking note's folder wins, then the shortest path, then the first path in sorted
/// order, so the same link always opens the same note.
public struct WikiLinkTargets: Sendable {
  /// note name key -> vault paths with that name.
  private let byName: [String: [String]]

  public init(paths: [String]) {
    var byName: [String: [String]] = [:]
    for path in paths {
      guard let name = WikiLinkTargets.noteName(of: path) else { continue }
      byName[WikiLinkTargets.key(name), default: []].append(path)
    }
    self.byName = byName
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
}
