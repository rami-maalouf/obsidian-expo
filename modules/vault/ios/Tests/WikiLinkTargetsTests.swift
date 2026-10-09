import Foundation
import Testing

@testable import VaultCore

@Suite struct WikiLinkTargetsTests {
  let targets = WikiLinkTargets(paths: [
    "Welcome.md",
    "Daily/2026-10-08.md",
    "Projects/Plan.md",
    "Work/Projects/Plan.md",
    "Archive/Plan.md",
    "Résumé.md",
    "Notes/Meeting notes.md",
    "image.png",
  ])

  @Test func namesIgnoreCaseSpacesAndExtension() {
    #expect(targets.resolve("Welcome", from: nil) == "Welcome.md")
    #expect(targets.resolve("welcome", from: nil) == "Welcome.md")
    #expect(targets.resolve("  Welcome  ", from: nil) == "Welcome.md")
    #expect(targets.resolve("Welcome.md", from: nil) == "Welcome.md")
    #expect(targets.resolve("meeting NOTES", from: "Daily/2026-10-08.md") == "Notes/Meeting notes.md")
  }

  @Test func namesIgnoreUnicodeNormalization() {
    // "e" followed by a combining acute accent, as some keyboards and file systems write it.
    #expect(targets.resolve("Re\u{301}sume\u{301}", from: nil) == "Résumé.md")
  }

  @Test func pathsAndPathEndings() {
    #expect(targets.resolve("Daily/2026-10-08", from: nil) == "Daily/2026-10-08.md")
    #expect(targets.resolve("Work/Projects/Plan", from: nil) == "Work/Projects/Plan.md")
    #expect(targets.resolve("Projects/Plan", from: nil) == "Projects/Plan.md")
    #expect(targets.resolve("/Archive/Plan.md", from: nil) == "Archive/Plan.md")
    #expect(targets.resolve("Other/Plan", from: nil) == nil)
  }

  @Test func sharedNamesPreferTheLinkingFolderThenTheShortestPath() {
    #expect(targets.resolve("Plan", from: "Archive/Index.md") == "Archive/Plan.md")
    #expect(targets.resolve("Plan", from: "Work/Projects/Today.md") == "Work/Projects/Plan.md")
    #expect(targets.resolve("Plan", from: "Welcome.md") == "Archive/Plan.md")
    #expect(targets.resolve("Plan", from: nil) == "Archive/Plan.md")
  }

  @Test func missingAndNonNoteTargets() {
    #expect(targets.resolve("Nowhere", from: nil) == nil)
    #expect(targets.resolve("image.png", from: nil) == nil)
    #expect(targets.resolve("", from: nil) == nil)
    #expect(targets.resolve("Daily/", from: nil) == nil)
  }
}
