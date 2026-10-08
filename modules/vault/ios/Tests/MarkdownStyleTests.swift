import Foundation
import Testing

@testable import VaultCore

@Suite struct MarkdownStyleTests {
  typealias Span = MarkdownStyle.Span
  typealias Block = MarkdownStyle.Block

  func spans(_ line: String, in block: MarkdownStyle.BlockKind? = nil) -> [Span] {
    MarkdownStyle.spans(paragraph: line as NSString, in: block)
  }

  @Test func headings() {
    #expect(spans("## Plan\n") == [Span(.heading(2), 0, 7), Span(.marker, 0, 2)])
    #expect(spans("## Plan\r\n") == [Span(.heading(2), 0, 7), Span(.marker, 0, 2)])
    #expect(spans("###### Six") == [Span(.heading(6), 0, 10), Span(.marker, 0, 6)])
    #expect(spans("   # Indented") == [Span(.heading(1), 0, 13), Span(.marker, 3, 1)])
    #expect(spans("#") == [Span(.heading(1), 0, 1), Span(.marker, 0, 1)])
    #expect(spans("# Title with `code`") == [Span(.heading(1), 0, 19), Span(.marker, 0, 1), Span(.code, 13, 6)])
  }

  @Test(arguments: ["#tag", "####### Seven", "    # four spaces", "#\u{00A0}no-break space", "---", "", "\n"])
  func plainLines(line: String) {
    #expect(spans(line) == [])
  }

  @Test func quotesListsAndTasks() {
    #expect(spans("> Quote") == [Span(.marker, 0, 2)])
    #expect(spans("> > Nested") == [Span(.marker, 0, 2), Span(.marker, 2, 2)])
    #expect(spans("- Item") == [Span(.marker, 0, 1)])
    #expect(spans("  * Nested item") == [Span(.marker, 2, 1)])
    #expect(spans("\t+ Tabbed") == [Span(.marker, 1, 1)])
    #expect(spans("12. Ordered") == [Span(.marker, 0, 3)])
    #expect(spans("3) Ordered") == [Span(.marker, 0, 2)])
    #expect(spans("- [ ] Task") == [Span(.marker, 0, 1), Span(.marker, 2, 3)])
    #expect(spans("- [x] Done") == [Span(.marker, 0, 1), Span(.marker, 2, 3)])
    #expect(spans("> - Quoted item") == [Span(.marker, 0, 2), Span(.marker, 2, 1)])
    #expect(spans("-not a list") == [])
    #expect(spans("**bold**") == [])
    #expect(spans("1234567890. ten digits") == [])
  }

  @Test func inlineCodeAndLinks() {
    #expect(spans("Use `code` here") == [Span(.code, 4, 6)])
    #expect(spans("``a ` b``") == [Span(.code, 0, 9)])
    #expect(spans("Unmatched ` tick") == [])
    #expect(spans("`one` and ``two``") == [Span(.code, 0, 5), Span(.code, 10, 7)])
    #expect(spans("See [[Note]] and ![[Image.png]]") == [Span(.link, 4, 8), Span(.link, 17, 14)])
    #expect(spans("`[[not a link]]`") == [Span(.code, 0, 16)])
    #expect(spans("[[unclosed and [[Closed]]") == [Span(.link, 15, 10)])
    #expect(spans("[[a]] `[[b]]` [[c]]") == [Span(.code, 6, 7), Span(.link, 0, 5), Span(.link, 14, 5)])
    // offsets are utf-16 units: the emoji takes two.
    #expect(spans("😀 [[Link]]") == [Span(.link, 3, 8)])
  }

  @Test func linesInsideBlocks() {
    #expect(spans("```swift\n", in: .code) == [Span(.code, 0, 8), Span(.marker, 0, 8)])
    #expect(spans("# comment\n", in: .code) == [Span(.code, 0, 9)])
    #expect(spans("tags: [a]\n", in: .frontmatter) == [Span(.frontmatter, 0, 9)])
    #expect(spans("\n", in: .code) == [])
  }

  @Test func frontmatterAndFences() {
    let text = "---\ntags: a\n---\n# Title\n```swift\n# comment\n```\nafter\n" as NSString
    let blocks = MarkdownStyle.blocks(in: text)
    #expect(blocks == [Block(.frontmatter, 0, 16), Block(.code, 24, 23)])
    #expect(MarkdownStyle.block(containing: 0, in: blocks)?.kind == .frontmatter)
    #expect(MarkdownStyle.block(containing: 16, in: blocks) == nil)
    #expect(MarkdownStyle.block(containing: 33, in: blocks)?.kind == .code)
    #expect(MarkdownStyle.block(containing: 43, in: blocks)?.kind == .code)
    #expect(MarkdownStyle.block(containing: 47, in: blocks) == nil)
  }

  static let blockCases: [(String, [Block])] = [
    ("a\n~~~\nb\n", [Block(.code, 2, 6)]),
    ("````\n```\n````\n", [Block(.code, 0, 14)]),
    ("~~~\n```\n~~~\n", [Block(.code, 0, 12)]),
    ("```\r\nx\r\n```\r\n", [Block(.code, 0, 13)]),
    ("```\n# one\n```\n```\n# two\n```\n", [Block(.code, 0, 14), Block(.code, 14, 14)]),
    ("``` a`b\nx\n", []),
    ("    ```\ncode\n", []),
    ("---\ntitle: open\n", []),
    ("\n---\na: 1\n---\n", []),
    ("---", []),
  ]

  @Test(arguments: MarkdownStyleTests.blockCases)
  func blockEdges(text: String, expected: [Block]) {
    #expect(MarkdownStyle.blocks(in: text as NSString) == expected)
  }

  @Test func editsThatKeepTheBlockStructure() {
    // typing inside a code block, and inserting or deleting text before it.
    #expect(MarkdownStyle.firstChange(
      from: [Block(.code, 24, 23)], to: [Block(.code, 24, 24)], edited: NSRange(location: 35, length: 1), delta: 1) == nil)
    #expect(MarkdownStyle.firstChange(
      from: [Block(.code, 10, 8)], to: [Block(.code, 13, 8)], edited: NSRange(location: 2, length: 3), delta: 3) == nil)
    #expect(MarkdownStyle.firstChange(
      from: [Block(.code, 10, 8)], to: [Block(.code, 7, 8)], edited: NSRange(location: 2, length: 0), delta: -3) == nil)
    // typing at the start of the paragraph after a block.
    #expect(MarkdownStyle.firstChange(
      from: [Block(.code, 0, 10)], to: [Block(.code, 0, 10)], edited: NSRange(location: 10, length: 1), delta: 1) == nil)
  }

  @Test func editsThatChangeTheBlockStructure() {
    // opening a fence restyles from its line to the end.
    #expect(MarkdownStyle.firstChange(
      from: [], to: [Block(.code, 20, 30)], edited: NSRange(location: 22, length: 1), delta: 1) == 20)
    // closing an open fence restyles the lines after the new closing fence.
    #expect(MarkdownStyle.firstChange(
      from: [Block(.code, 0, 50)], to: [Block(.code, 0, 34)], edited: NSRange(location: 30, length: 3), delta: 3) == 34)
    // removing a closing fence.
    #expect(MarkdownStyle.firstChange(
      from: [Block(.code, 0, 34)], to: [Block(.code, 0, 49)], edited: NSRange(location: 30, length: 0), delta: -1) == 33)
    // removing the only fence of a block.
    #expect(MarkdownStyle.firstChange(
      from: [Block(.code, 40, 10)], to: [], edited: NSRange(location: 40, length: 0), delta: -1) == 40)
    // a new block before an existing one.
    #expect(MarkdownStyle.firstChange(
      from: [Block(.code, 40, 10)], to: [Block(.code, 5, 49)], edited: NSRange(location: 5, length: 3), delta: 3) == 5)
  }

  @Test func largeNotesStayLinear() {
    // 20,000 paragraphs with a fence every 100, and one long line of mismatched backtick runs.
    var lines: [String] = []
    for index in 0..<20_000 {
      lines.append(index % 100 == 0 ? "```" : "line \(index) with [[link]] and `code`")
    }
    let text = lines.joined(separator: "\n") as NSString
    #expect(MarkdownStyle.blocks(in: text).count == 100)
    let runs = (1...100).map { String(repeating: "`", count: $0) }.joined(separator: " x ")
    let line = runs as NSString
    #expect(line.length < MarkdownStyle.inlineLimit)
    #expect(spans(runs).isEmpty)
  }
}
