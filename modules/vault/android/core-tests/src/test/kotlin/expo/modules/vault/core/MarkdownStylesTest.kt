package expo.modules.vault.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MarkdownStylesTest {
  /** the styled text of each range, as "STYLE:text". */
  private fun styled(text: String, from: Int = 0, to: Int = text.length): List<String> =
    MarkdownStyles.style(text, from, to).map { "${it.style}:${text.substring(it.start, it.end)}" }

  @Test
  fun headingsMarkTheirLevelAndMarker() {
    val ranges = MarkdownStyles.style("## Plan\nbody", 0, 12)
    assertEquals(StyledRange(0, 7, MarkdownStyle.HEADING, level = 2), ranges[0])
    assertEquals("MARKER:## ", "${ranges[1].style}:${"## Plan\nbody".substring(ranges[1].start, ranges[1].end)}")
    assertTrue(styled("#tag not a heading").none { it.startsWith("HEADING") })
  }

  @Test
  fun inlineStyles() {
    val found = styled("a **bold** and *it* and _it_ and ~~gone~~ and `co*de*` #tag")
    for (expected in listOf("STRONG:bold", "EMPHASIS:it", "STRIKE:gone", "CODE:co*de*", "TAG:#tag", "MARKER:**", "MARKER:`")) {
      assertTrue(expected in found, "$expected in $found")
    }
    // emphasis is not found inside code spans.
    assertTrue("EMPHASIS:de" !in found)
    // underscores inside words are not emphasis.
    assertTrue(styled("snake_case_name").none { it.startsWith("EMPHASIS") })
  }

  @Test
  fun wikiLinksKeepTheirTargetAndAreNotOtherwiseStyled() {
    val text = "see [[Meeting notes#Agenda|the *agenda*]] and ![[pixel.png]]"
    val links = MarkdownStyles.style(text, 0, text.length).filter { it.style == MarkdownStyle.WIKILINK }
    assertEquals(listOf("Meeting notes", "pixel.png"), links.map { it.target })
    assertTrue(styled(text).none { it.startsWith("EMPHASIS") })
    val reference = assertNotNull(MarkdownStyles.wikiLinkAt(text, 8))
    assertEquals("Meeting notes", reference.target)
    assertEquals("Agenda", reference.heading)
    assertEquals(4, reference.start)
    assertTrue(MarkdownStyles.wikiLinkAt(text, 50)!!.embed)
    assertNull(MarkdownStyles.wikiLinkAt(text, 1))
    assertEquals("", MarkdownStyles.wikiLinks("[[#Heading]]", 0).single().target)
  }

  @Test
  fun markdownLinksStyleTheirTextAndAddress() {
    val found = styled("[Expo](https://expo.dev) end")
    assertTrue("LINK:Expo" in found)
    assertTrue("URL:(https://expo.dev)" in found)
  }

  @Test
  fun blockMarkers() {
    val found = styled("> quoted\n- item\n- [ ] task\n1. first\n---\n")
    for (expected in listOf("MARKER:> ", "MARKER:- ", "MARKER:- [ ] ", "MARKER:1. ", "MARKER:---")) {
      assertTrue(expected in found, "$expected in $found")
    }
  }

  @Test
  fun frontMatterAndFencesSpanLines() {
    val text = "---\ntitle: x\n---\n# Heading\n```js\nlet a = **b**\n```\nafter **bold**\n"
    val found = styled(text)
    assertTrue("FRONT_MATTER:title: x" in found)
    assertTrue("CODE_BLOCK:let a = **b**" in found)
    assertTrue("STRONG:b" !in found)
    assertTrue("STRONG:bold" in found)
    // a region in the middle knows it is inside the fence.
    val inside = text.indexOf("let")
    assertEquals(listOf("CODE_BLOCK:let a = **b**"), styled(text, inside, inside + 3))
    assertTrue(MarkdownStyles.touchesBlockSyntax(text, text.indexOf("```"), text.indexOf("```") + 1))
    assertTrue(!MarkdownStyles.touchesBlockSyntax(text, inside, inside + 1))
  }

  @Test
  fun anUnclosedFrontMatterIsNotFrontMatter() {
    assertEquals(0, MarkdownStyles.frontMatterEnd("---\ntitle: x\n"))
    assertEquals(16, MarkdownStyles.frontMatterEnd("---\ntitle: x\n---"))
  }

  @Test
  fun everyLineEndingEndsALine() {
    val text = "# One\r\n## Two\r### Three\n"
    val headings = MarkdownStyles.style(text, 0, text.length).filter { it.style == MarkdownStyle.HEADING }
    assertEquals(listOf("# One", "## Two", "### Three"), headings.map { text.substring(it.start, it.end) })
  }

  @Test
  fun aLongNoteStylesAnEditedLineQuickly() {
    val text = buildString { repeat(20_000) { append("line $it with **bold** and [[link $it]]\n") } }
    val middle = text.length / 2
    val started = System.nanoTime()
    repeat(20) { MarkdownStyles.style(text, middle, middle + 1) }
    val perEdit = (System.nanoTime() - started) / 20 / 1_000_000.0
    assertTrue(perEdit < 50, "styling one line of a ${text.length}-character note took $perEdit ms")
  }
}
