package expo.modules.vault.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** runs every shared toolbar case (`modules/vault/spec/editor-commands.txt`). */
class EditorCommandsTest {
  private data class Case(val line: Int, val command: String, val before: String, val after: String?)

  private data class Marked(val text: String, val start: Int, val end: Int)

  private val spec = File(System.getProperty("user.dir"), "../../spec/editor-commands.txt")

  private val pattern = Regex("""^(\S+)\s+"((?:[^"\\]|\\.)*)"\s+(?:"((?:[^"\\]|\\.)*)"|-)\s*$""")

  private fun cases(): List<Case> = spec.readLines().mapIndexedNotNull { index, raw ->
    val line = raw.trim()
    if (line.isEmpty() || line.startsWith("#")) return@mapIndexedNotNull null
    val match = pattern.matchEntire(line) ?: fail("editor-commands.txt line ${index + 1} is not a case: $line")
    val after = match.groups[3]?.value?.let(::unescape)
    Case(index + 1, match.groupValues[1], unescape(match.groupValues[2]), after)
  }

  private fun unescape(value: String): String {
    val result = StringBuilder()
    var escaping = false
    for (char in value) {
      if (escaping) {
        result.append(
          when (char) {
            'n' -> '\n'
            'r' -> '\r'
            't' -> '\t'
            else -> char
          },
        )
        escaping = false
      } else if (char == '\\') {
        escaping = true
      } else {
        result.append(char)
      }
    }
    return result.toString()
  }

  /** the text without its markers, and the selection they mark: ‸ is the caret, « and » a range. */
  private fun marked(value: String): Marked {
    val text = StringBuilder()
    var caret = 0
    var start = -1
    var end = -1
    for (char in value) {
      when (char) {
        '‸' -> caret = text.length
        '«' -> start = text.length
        '»' -> end = text.length
        else -> text.append(char)
      }
    }
    return if (start >= 0 && end >= 0) Marked(text.toString(), start, end) else Marked(text.toString(), caret, caret)
  }

  private fun run(command: String, text: String, start: Int, end: Int): TextEdit? = when (command) {
    "indent" -> EditorCommands.indent(text, start, end)
    "outdent" -> EditorCommands.outdent(text, start, end)
    "bold" -> EditorCommands.toggleEmphasis(text, start, end, strong = true)
    "italic" -> EditorCommands.toggleEmphasis(text, start, end, strong = false)
    "task" -> EditorCommands.toggleTask(text, start, end)
    "link" -> EditorCommands.insertLink(text, start, end)
    "tag" -> EditorCommands.insertTag(text, start, end)
    else -> fail("unknown command: $command")
  }

  @Test
  fun sharedCases() {
    val all = cases()
    val failures = ArrayList<String>()
    for (case in all) {
      val before = marked(case.before)
      val edit = run(case.command, before.text, before.start, before.end)
      val where = "line ${case.line}: ${case.command} \"${case.before}\""
      if (case.after == null) {
        if (edit != null) failures.add("$where: expected no change, got $edit")
        continue
      }
      if (edit == null) {
        failures.add("$where: no edit")
        continue
      }
      val expected = marked(case.after)
      val applied = before.text.substring(0, edit.start) + edit.text + before.text.substring(edit.end)
      if (applied != expected.text || edit.selectionStart != expected.start || edit.selectionEnd != expected.end) {
        failures.add("$where: got \"$applied\" (${edit.selectionStart}, ${edit.selectionEnd}), expected \"${expected.text}\" (${expected.start}, ${expected.end})")
      }
    }
    assertTrue(failures.isEmpty(), failures.joinToString("\n"))
    assertEquals(setOf("indent", "outdent", "bold", "italic", "task", "link", "tag"), all.map { it.command }.toSet())
  }

  @Test
  fun rangesOutsideTheTextChangeNothing() {
    assertNull(EditorCommands.indent("- a", 4, 4))
    assertNull(EditorCommands.toggleTask("ab", 2, 1))
    assertNull(EditorCommands.toggleEmphasis("ab", -1, 0, strong = true))
    assertNull(EditorCommands.insertLink("ab", 1, 5))
  }

  @Test
  fun aCaretInsideASurrogatePairIsMovedToTheCharacterStart() {
    // an emoji is not a word, so the empty markers go in front of it.
    val edit = EditorCommands.toggleEmphasis("😀", 1, 1, strong = true)
    assertEquals(TextEdit(0, 0, "****", 2, 2), edit)
  }

  @Test
  fun aCombiningAccentStaysInsideTheWord() {
    val edit = EditorCommands.toggleEmphasis("café au lait", 2, 2, strong = false)
    assertEquals("*café*", edit?.text)
  }
}
