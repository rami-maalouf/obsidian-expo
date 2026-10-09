import Foundation
import Testing

@testable import VaultCore

@Suite struct WikiLinkCompletionTests {
  func query(_ text: String, caret: Int? = nil) -> WikiLinkQuery? {
    let string = text as NSString
    return WikiLinkCompletion.query(in: string, caret: caret ?? string.length)
  }

  @Test func aNewLinkReplacesTheTypedTargetAndCloses() throws {
    let found = try #require(query("See [[Wel"))
    #expect(found.start == 6)
    #expect(found.text == "Wel")
    #expect(found.replaceRange == NSRange(location: 6, length: 3))
    let edit = found.edit(inserting: "Welcome")
    #expect(edit.text == "Welcome]]")
    #expect(edit.caret == 15)
  }

  @Test func anEmptyTargetRightAfterTheBrackets() throws {
    let found = try #require(query("[["))
    #expect(found.text == "")
    #expect(found.replaceRange == NSRange(location: 2, length: 0))
  }

  @Test func insideAClosedLinkTheRestAndItsBracketsAreReplaced() throws {
    let found = try #require(query("[[Wel come]] x", caret: 5))
    #expect(found.text == "Wel")
    #expect(found.replaceRange == NSRange(location: 2, length: 10))
    let edit = found.edit(inserting: "Welcome")
    #expect(edit.text == "Welcome]]")
    #expect(edit.caret == 11)
  }

  @Test func anAliasOrHeadingAfterTheCaretIsKept() throws {
    let alias = try #require(query("[[Wel|greeting]]", caret: 5))
    #expect(alias.replaceRange == NSRange(location: 2, length: 3))
    #expect(alias.edit(inserting: "Welcome").text == "Welcome")
    let heading = try #require(query("[[Wel#Start]]", caret: 5))
    #expect(heading.replaceRange == NSRange(location: 2, length: 3))
    #expect(heading.edit(inserting: "Welcome").caret == 9)
  }

  @Test func aLaterLinkOnTheLineIsNotPartOfTheTarget() throws {
    let found = try #require(query("[[Wel and [[b]]", caret: 5))
    #expect(found.replaceRange == NSRange(location: 2, length: 3))
    #expect(found.edit(inserting: "Welcome").text == "Welcome]]")
  }

  @Test func headingsOfTheOpenNote() throws {
    let found = try #require(query("[[#Intro"))
    #expect(found.isHeading)
    #expect(found.text == "#Intro")
  }

  @Test func noCompletionOutsideAnOpenLink() {
    #expect(query("[[a]] b") == nil)
    #expect(query("[a") == nil)
    #expect(query("plain text") == nil)
    #expect(query("[[one\nnext") == nil)
    #expect(query("[[Note#Hea") == nil)
    #expect(query("[[Note|ali") == nil)
    #expect(query("[") == nil)
  }
}

@Suite struct WikiLinkSuggestionTests {
  static func day(_ seconds: Double) -> Date {
    Date(timeIntervalSince1970: seconds)
  }

  let targets = WikiLinkTargets(notes: [
    .init(path: "Welcome.md", modified: day(100)),
    .init(path: "Daily/2026-10-08.md", modified: day(300)),
    .init(path: "Daily/2026-10-07.md", modified: day(200)),
    .init(path: "Projects/Plan.md", modified: day(50)),
    .init(path: "Archive/Plan.md", modified: day(10)),
    .init(path: "Résumé.md", modified: day(20)),
    .init(path: "Notes/Weekly review.md", modified: day(150)),
  ])

  func paths(_ query: String, from source: String? = nil, limit: Int = 6) -> [String] {
    targets.suggestions(for: query, from: source, limit: limit).map(\.path)
  }

  @Test func anEmptyQueryListsRecentNotesWithoutTheLinkingNote() {
    #expect(paths("", from: "Welcome.md", limit: 3) == ["Daily/2026-10-08.md", "Daily/2026-10-07.md", "Notes/Weekly review.md"])
    #expect(!paths("", from: "Welcome.md").contains("Welcome.md"))
  }

  @Test func prefixesBeforeWordsBeforeLooseMatches() {
    #expect(paths("we") == ["Welcome.md", "Notes/Weekly review.md"])
    #expect(paths("rev") == ["Notes/Weekly review.md"])
    #expect(paths("wr") == ["Notes/Weekly review.md"])
    #expect(paths("zzz") == [])
  }

  @Test func caseAndAccentsAreIgnored() {
    #expect(paths("RESUME") == ["Résumé.md"])
  }

  @Test func sharedNamesPreferTheLinkingFolderAndInsertAPathWhenNeeded() {
    let found = targets.suggestions(for: "plan", from: "Projects/Today.md")
    #expect(found.map(\.path) == ["Projects/Plan.md", "Archive/Plan.md"])
    #expect(found.map(\.linkText) == ["Plan", "Archive/Plan"])
    #expect(found.map(\.folder) == ["Projects", "Archive"])
  }

  @Test func aQueryWithASlashMatchesPaths() {
    #expect(paths("arch/pl") == ["Archive/Plan.md"])
  }

  @Test func headingsUseTheSameMatching() {
    #expect(WikiLinkTargets.score("int", in: "Introduction") != nil)
    #expect(WikiLinkTargets.score("xyz", in: "Introduction") == nil)
  }
}
