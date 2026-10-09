package expo.modules.vault.core

/** the target of a `[[wikilink]]` being typed at the caret. offsets are utf-16 units. */
data class WikiLinkQuery(
  /** the offset just after `[[`. */
  val start: Int,
  /** the text between `[[` and the caret. */
  val text: String,
  /**
   * the range a chosen suggestion replaces. it starts at [start] and, when the caret is inside
   * an existing link, also covers the rest of its target (and its `]]`, if it has one).
   */
  val replaceStart: Int,
  val replaceLength: Int,
  /** whether the replacement ends with `]]`: false when an alias or heading (`|`, `#`) follows. */
  val endsWithClose: Boolean,
) {
  /** a heading in the open note (`[[#heading`), rather than another note. */
  val isHeading: Boolean get() = text.startsWith("#")

  data class Edit(val start: Int, val length: Int, val text: String, val caret: Int)

  /** the edit for a chosen link text: the range to replace, its new text, and the caret after it. */
  fun edit(linkText: String): Edit {
    val inserted = if (endsWithClose) "$linkText]]" else linkText
    return Edit(replaceStart, replaceLength, inserted, replaceStart + inserted.length)
  }
}

object WikiLinkCompletion {
  /** how far from the caret `[[` and `]]` are looked for, in utf-16 units. */
  private const val REACH = 300

  /**
   * the link target being typed: the caret is after `[[` on the same line, and the characters
   * between them include no `[`, `]`, or `|`. a `#` after a note name (`[[note#`) ends
   * completion; a target that starts with `#` asks for a heading in the open note.
   */
  fun query(text: CharSequence, caret: Int): WikiLinkQuery? {
    if (caret < 2 || caret > text.length) return null
    val lower = maxOf(0, caret - REACH)
    var index = caret - 1
    var found: Int? = null
    while (index > lower) {
      val char = text[index]
      if (isLineBreak(char) || char == ']' || char == '|') return null
      if (char == '[') {
        if (text[index - 1] != '[') return null
        found = index + 1
        break
      }
      index -= 1
    }
    val start = found ?: return null
    val typed = text.subSequence(start, caret).toString()
    val hash = typed.indexOf('#')
    if (hash > 0) return null

    // after the caret: the rest of an existing link's target, if the caret is inside one.
    val upper = minOf(text.length, caret + REACH)
    var end = caret
    while (end < upper) {
      val char = text[end]
      if (char == ']') {
        if (end + 1 < text.length && text[end + 1] == ']') {
          return WikiLinkQuery(start, typed, start, end + 2 - start, endsWithClose = true)
        }
        break
      }
      if (char == '|' || (char == '#' && !typed.startsWith("#"))) {
        return WikiLinkQuery(start, typed, start, end - start, endsWithClose = false)
      }
      if (isLineBreak(char) || char == '[') break
      end += 1
    }
    // a new link: the text after the caret is not part of it.
    return WikiLinkQuery(start, typed, start, caret - start, endsWithClose = true)
  }

  private fun isLineBreak(char: Char) = char == '\n' || char == '\r' || char == ' ' || char == ' '
}
