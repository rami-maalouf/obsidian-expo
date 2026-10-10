import Foundation
import Testing

@testable import VaultCore

/// runs the shared toolbar cases (`modules/vault/spec/editor-commands.txt`) that the swift core
/// implements. indent, outdent, bold, and italic come from laperm on ios; the kotlin tests run
/// those cases.
@Suite struct EditorCommandsTests {
  struct Case: CustomStringConvertible {
    let line: Int
    let command: String
    let before: String
    let after: String?

    var description: String {
      "editor-commands.txt line \(line): \(command)"
    }
  }

  static let specURL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("spec/editor-commands.txt")

  static func cases() throws -> [Case] {
    let content = try String(contentsOf: specURL, encoding: .utf8)
    let pattern = try NSRegularExpression(pattern: #"^(\S+)\s+"((?:[^"\\]|\\.)*)"\s+(?:"((?:[^"\\]|\\.)*)"|-)\s*$"#)
    var cases: [Case] = []
    for (index, raw) in content.components(separatedBy: "\n").enumerated() {
      let line = raw.trimmingCharacters(in: .whitespaces)
      if line.isEmpty || line.hasPrefix("#") {
        continue
      }
      let string = line as NSString
      guard let match = pattern.firstMatch(in: line, range: NSRange(location: 0, length: string.length)) else {
        Issue.record("editor-commands.txt line \(index + 1) is not a case: \(line)")
        continue
      }
      let after = match.range(at: 3).location == NSNotFound ? nil : unescape(string.substring(with: match.range(at: 3)))
      cases.append(
        Case(
          line: index + 1, command: string.substring(with: match.range(at: 1)),
          before: unescape(string.substring(with: match.range(at: 2))), after: after))
    }
    return cases
  }

  static func unescape(_ value: String) -> String {
    var result = ""
    var escaping = false
    for character in value {
      if escaping {
        switch character {
        case "n": result.append("\n")
        case "r": result.append("\r")
        case "t": result.append("\t")
        default: result.append(character)
        }
        escaping = false
      } else if character == "\\" {
        escaping = true
      } else {
        result.append(character)
      }
    }
    return result
  }

  /// the text without its markers, and the selection they mark: ‸ is the caret, « and » a range.
  static func marked(_ value: String) -> (text: String, selection: NSRange) {
    var units: [UInt16] = []
    var caret = 0
    var start: Int?
    var end: Int?
    for unit in value.utf16 {
      switch unit {
      case 0x2038: caret = units.count
      case 0x00AB: start = units.count
      case 0x00BB: end = units.count
      default: units.append(unit)
      }
    }
    let text = String(decoding: units, as: UTF16.self)
    if let start, let end {
      return (text, NSRange(location: start, length: end - start))
    }
    return (text, NSRange(location: caret, length: 0))
  }

  static func run(_ command: String, _ text: NSString, _ selection: NSRange) -> TextEdit?? {
    switch command {
    case "task": return .some(EditorCommands.toggleTask(in: text, selection: selection))
    case "link": return .some(EditorCommands.insertLink(in: text, selection: selection))
    case "tag": return .some(EditorCommands.insertTag(in: text, selection: selection))
    default: return nil
    }
  }

  @Test func sharedCases() throws {
    let all = try Self.cases()
    var ran: Set<String> = []
    for item in all {
      let (text, selection) = Self.marked(item.before)
      guard let result = Self.run(item.command, text as NSString, selection) else {
        continue
      }
      ran.insert(item.command)
      guard let after = item.after else {
        #expect(result == nil, "\(item)")
        continue
      }
      guard let edit = result else {
        Issue.record("\(item): no edit")
        continue
      }
      let expected = Self.marked(after)
      let applied = (text as NSString).replacingCharacters(in: edit.range, with: edit.text)
      #expect(applied == expected.text, "\(item)")
      #expect(edit.selection == expected.selection, "\(item)")
    }
    #expect(ran == ["task", "link", "tag"])
  }

  @Test func rangesOutsideTheTextChangeNothing() {
    let text = "ab" as NSString
    #expect(EditorCommands.toggleTask(in: text, selection: NSRange(location: 3, length: 0)) == nil)
    #expect(EditorCommands.insertLink(in: text, selection: NSRange(location: 1, length: 5)) == nil)
    #expect(EditorCommands.insertTag(in: text, selection: NSRange(location: NSNotFound, length: 0)) == nil)
  }

  @Test func aTaskOnEveryLineOfALongSelectionIsOneEdit() throws {
    let text = "a\nb\nc" as NSString
    let edit = try #require(EditorCommands.toggleTask(in: text, selection: NSRange(location: 0, length: 5)))
    #expect(edit.range == NSRange(location: 0, length: 5))
    #expect(edit.text == "- [ ] a\n- [ ] b\n- [ ] c")
  }
}
