package expo.modules.vault.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WikiLinkTargetsTest {
  private val targets = WikiLinkTargets(
    listOf(
      "Welcome.md", "Daily/2026-10-08.md", "Projects/Plan.md", "Work/Projects/Plan.md",
      "Archive/Plan.md", "Résumé.md", "Notes/Meeting notes.md", "image.png",
    ).map { WikiLinkTargets.Note(it) },
  )

  @Test
  fun namesIgnoreCaseSpacesAndExtension() {
    assertEquals("Welcome.md", targets.resolve("Welcome", null))
    assertEquals("Welcome.md", targets.resolve("welcome", null))
    assertEquals("Welcome.md", targets.resolve("  Welcome  ", null))
    assertEquals("Welcome.md", targets.resolve("Welcome.md", null))
    assertEquals("Notes/Meeting notes.md", targets.resolve("meeting NOTES", "Daily/2026-10-08.md"))
  }

  @Test
  fun namesIgnoreUnicodeNormalization() {
    assertEquals("Résumé.md", targets.resolve("Résumé", null))
  }

  @Test
  fun pathsAndPathEndings() {
    assertEquals("Daily/2026-10-08.md", targets.resolve("Daily/2026-10-08", null))
    assertEquals("Work/Projects/Plan.md", targets.resolve("Work/Projects/Plan", null))
    assertEquals("Projects/Plan.md", targets.resolve("Projects/Plan", null))
    assertEquals("Archive/Plan.md", targets.resolve("/Archive/Plan.md", null))
    assertNull(targets.resolve("Other/Plan", null))
  }

  @Test
  fun sharedNamesPreferTheLinkingFolderThenTheShortestPath() {
    assertEquals("Archive/Plan.md", targets.resolve("Plan", "Archive/Index.md"))
    assertEquals("Work/Projects/Plan.md", targets.resolve("Plan", "Work/Projects/Today.md"))
    assertEquals("Archive/Plan.md", targets.resolve("Plan", "Welcome.md"))
    assertEquals("Archive/Plan.md", targets.resolve("Plan", null))
  }

  @Test
  fun missingAndNonNoteTargets() {
    assertNull(targets.resolve("Nowhere", null))
    assertNull(targets.resolve("image.png", null))
    assertNull(targets.resolve("", null))
    assertNull(targets.resolve("Daily/", null))
  }
}

class WikiLinkSuggestionTest {
  private val targets = WikiLinkTargets(
    listOf(
      WikiLinkTargets.Note("Welcome.md", 100),
      WikiLinkTargets.Note("Daily/2026-10-08.md", 300),
      WikiLinkTargets.Note("Daily/2026-10-07.md", 200),
      WikiLinkTargets.Note("Projects/Plan.md", 50),
      WikiLinkTargets.Note("Archive/Plan.md", 10),
      WikiLinkTargets.Note("Résumé.md", 20),
      WikiLinkTargets.Note("Notes/Weekly review.md", 150),
    ),
  )

  private fun paths(query: String, source: String? = null, limit: Int = 6) = targets.suggestions(query, source, limit).map { it.path }

  @Test
  fun anEmptyQueryListsRecentNotesWithoutTheLinkingNote() {
    assertEquals(listOf("Daily/2026-10-08.md", "Daily/2026-10-07.md", "Notes/Weekly review.md"), paths("", "Welcome.md", 3))
    assertTrue("Welcome.md" !in paths("", "Welcome.md"))
  }

  @Test
  fun prefixesBeforeWordsBeforeLooseMatches() {
    assertEquals(listOf("Welcome.md", "Notes/Weekly review.md"), paths("we"))
    assertEquals(listOf("Notes/Weekly review.md"), paths("rev"))
    assertEquals(listOf("Notes/Weekly review.md"), paths("wr"))
    assertEquals(emptyList(), paths("zzz"))
  }

  @Test
  fun caseAndAccentsAreIgnored() {
    assertEquals(listOf("Résumé.md"), paths("RESUME"))
  }

  @Test
  fun sharedNamesPreferTheLinkingFolderAndInsertAPathWhenNeeded() {
    val found = targets.suggestions("plan", "Projects/Today.md")
    assertEquals(listOf("Projects/Plan.md", "Archive/Plan.md"), found.map { it.path })
    assertEquals(listOf("Plan", "Archive/Plan"), found.map { it.linkText })
    assertEquals(listOf("Projects", "Archive"), found.map { it.folder })
  }

  @Test
  fun aQueryWithASlashMatchesPaths() {
    assertEquals(listOf("Archive/Plan.md"), paths("arch/pl"))
  }

  @Test
  fun headingsUseTheSameMatching() {
    assertNotNull(WikiLinkTargets.score("int", "Introduction"))
    assertNull(WikiLinkTargets.score("xyz", "Introduction"))
  }
}

class WikiLinkCompletionTest {
  private fun query(text: String, caret: Int = text.length) = WikiLinkCompletion.query(text, caret)

  @Test
  fun aNewLinkReplacesTheTypedTargetAndCloses() {
    val found = assertNotNull(query("See [[Wel"))
    assertEquals(6, found.start)
    assertEquals("Wel", found.text)
    assertEquals(6 to 3, found.replaceStart to found.replaceLength)
    val edit = found.edit("Welcome")
    assertEquals("Welcome]]", edit.text)
    assertEquals(15, edit.caret)
  }

  @Test
  fun anEmptyTargetRightAfterTheBrackets() {
    val found = assertNotNull(query("[["))
    assertEquals("", found.text)
    assertEquals(2 to 0, found.replaceStart to found.replaceLength)
  }

  @Test
  fun insideAClosedLinkTheRestAndItsBracketsAreReplaced() {
    val found = assertNotNull(query("[[Wel come]] x", 5))
    assertEquals("Wel", found.text)
    assertEquals(2 to 10, found.replaceStart to found.replaceLength)
    val edit = found.edit("Welcome")
    assertEquals("Welcome]]", edit.text)
    assertEquals(11, edit.caret)
  }

  @Test
  fun anAliasOrHeadingAfterTheCaretIsKept() {
    val alias = assertNotNull(query("[[Wel|greeting]]", 5))
    assertEquals(2 to 3, alias.replaceStart to alias.replaceLength)
    assertEquals("Welcome", alias.edit("Welcome").text)
    val heading = assertNotNull(query("[[Wel#Start]]", 5))
    assertEquals(2 to 3, heading.replaceStart to heading.replaceLength)
    assertEquals(9, heading.edit("Welcome").caret)
  }

  @Test
  fun aLaterLinkOnTheLineIsNotPartOfTheTarget() {
    val found = assertNotNull(query("[[Wel and [[b]]", 5))
    assertEquals(2 to 3, found.replaceStart to found.replaceLength)
    assertEquals("Welcome]]", found.edit("Welcome").text)
  }

  @Test
  fun headingsOfTheOpenNote() {
    val found = assertNotNull(query("[[#Intro"))
    assertTrue(found.isHeading)
    assertEquals("#Intro", found.text)
  }

  @Test
  fun noCompletionOutsideAnOpenLink() {
    for (text in listOf("[[a]] b", "[a", "plain text", "[[one\nnext", "[[Note#Hea", "[[Note|ali", "[")) {
      assertNull(query(text), text)
    }
  }
}
