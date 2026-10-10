package expo.modules.vault.core

/**
 * an edit from a toolbar command: replace [start, end) with [text], then select
 * [selectionStart, selectionEnd). offsets are UTF-16 indexes, as in a kotlin string.
 */
data class TextEdit(val start: Int, val end: Int, val text: String, val selectionStart: Int, val selectionEnd: Int)

/**
 * the editing toolbar's commands (t17). on ios, indent, outdent, bold, and italic come from
 * laperm; these follow the same rules, which the shared cases in
 * `modules/vault/spec/editor-commands.txt` describe. each returns null when it changes nothing.
 */
object EditorCommands {
  private const val INDENT = "    "

  /** adds four spaces in front of each list line in the selection, or the caret's line. */
  fun indent(text: CharSequence, start: Int, end: Int): TextEdit? = changeIndent(text, start, end, removing = false)

  /** removes up to four leading spaces from each list line in the selection, or the caret's line. */
  fun outdent(text: CharSequence, start: Int, end: Int): TextEdit? = changeIndent(text, start, end, removing = true)

  private fun changeIndent(text: CharSequence, start: Int, end: Int, removing: Boolean): TextEdit? {
    if (!isValid(text, start, end)) return null
    val lines = lineStarts(text, start, end)
    val first = lines.first()
    val last = lineEnd(text, lines.last())
    val rebuilt = StringBuilder()
    var cursor = first
    var firstDelta: Int? = null
    var totalDelta = 0
    var foundListLine = false
    for (lineStart in lines) {
      rebuilt.append(text, cursor, lineStart)
      cursor = lineStart
      val lineEnd = lineEnd(text, lineStart)
      var delta = 0
      if (listContentStart(text, skipSpaces(text, lineStart, lineEnd, tabs = true), lineEnd) != null) {
        foundListLine = true
        if (removing) {
          var spaces = 0
          while (spaces < INDENT.length && lineStart + spaces < lineEnd && text[lineStart + spaces] == ' ') spaces++
          cursor += spaces
          delta = -spaces
        } else {
          rebuilt.append(INDENT)
          delta = INDENT.length
        }
      }
      if (firstDelta == null) firstDelta = delta
      totalDelta += delta
    }
    if (!foundListLine || totalDelta == 0) return null
    rebuilt.append(text, cursor, last)
    // the start moves with the first line; the end moves with every line before it.
    val selectionStart = maxOf(first, start + (firstDelta ?: 0))
    val selectionEnd = maxOf(selectionStart, end + totalDelta)
    return TextEdit(first, last, rebuilt.toString(), selectionStart, selectionEnd)
  }

  /**
   * adds or removes `**` (strong) or `*` around the selection, or around the word at the caret.
   * with no word, inserts an empty pair with the caret between, and a second call removes it.
   * `_` markers are removed too. does nothing in a code span, across a blank line, or when the
   * text holds markers of separate spans.
   */
  fun toggleEmphasis(text: CharSequence, start: Int, end: Int, strong: Boolean): TextEdit? {
    if (!isValid(text, start, end)) return null
    val marker = if (strong) "**" else "*"
    val size = marker.length
    // whole characters only: never between the two halves of a surrogate pair.
    val from = if (start in 1 until text.length && text[start].isLowSurrogate() && text[start - 1].isHighSurrogate()) start - 1 else start
    var to = if (end == start) from else maxOf(from, end)
    if (to > from && to < text.length && text[to].isLowSurrogate() && text[to - 1].isHighSurrogate()) to++
    var trimmedStart = from
    var trimmedEnd = to
    while (trimmedStart < trimmedEnd && text[trimmedStart].isWhitespace()) trimmedStart++
    while (trimmedEnd > trimmedStart && text[trimmedEnd - 1].isWhitespace()) trimmedEnd--
    val hadSelection = trimmedEnd > trimmedStart
    val (targetStart, targetEnd) = when {
      hadSelection -> trimmedStart to trimmedEnd
      to > from -> from to from
      else -> wordRange(text, from)
    }
    val caret = from
    val content = text.substring(targetStart, targetEnd)
    if (isInsideCodeSpan(text, targetStart) || BLANK_LINE.containsMatchIn(content)) return null

    // the markers are inside the target, as when "**hello**" is selected.
    if (targetEnd - targetStart >= 2 * size) {
      val inner = innerRange(text, targetStart, targetEnd, strong)
      if (inner != null) {
        val innerText = text.substring(inner.first, inner.second)
        if (hasAmbiguousMarkers(innerText, strong)) return null
        if (hadSelection) return TextEdit(targetStart, targetEnd, innerText, targetStart, targetStart + innerText.length)
        val moved = targetStart + caret.coerceIn(inner.first, inner.second) - inner.first
        return TextEdit(targetStart, targetEnd, innerText, moved, moved)
      }
    }
    if (hasAmbiguousMarkers(content, strong)) return null
    // the markers are around the target, as with the caret in a bold word.
    val outer = outerRange(text, targetStart, targetEnd, strong)
    if (outer != null) {
      if (hadSelection) return TextEdit(outer.first, outer.second, content, outer.first, outer.first + content.length)
      val moved = maxOf(outer.first, caret - size)
      return TextEdit(outer.first, outer.second, content, moved, moved)
    }
    if (hadSelection) return TextEdit(targetStart, targetEnd, marker + content + marker, targetStart + size, targetStart + size + content.length)
    return TextEdit(targetStart, targetEnd, marker + content + marker, caret + size, caret + size)
  }

  /**
   * on each line of the selection (or the caret's line): a plain line becomes `- [ ] line`, a
   * list item gets a box after its marker, and a box is checked or cleared. blank lines in a
   * selection of several lines are left alone. a leading `>` quote stays in front.
   */
  fun toggleTask(text: CharSequence, start: Int, end: Int): TextEdit? {
    if (!isValid(text, start, end)) return null
    val lines = lineStarts(text, start, end)
    val first = lines.first()
    val last = lineEnd(text, lines.last())
    val rebuilt = StringBuilder()
    val insertions = ArrayList<Pair<Int, Int>>()
    var changed = false
    var cursor = first
    for (lineStart in lines) {
      val lineEnd = lineEnd(text, lineStart)
      rebuilt.append(text, cursor, lineStart)
      cursor = lineStart
      if (lines.size > 1 && (lineStart until lineEnd).all { text[it] == ' ' || text[it] == '\t' }) continue
      val prefixEnd = quotePrefixEnd(text, lineStart, lineEnd)
      rebuilt.append(text, cursor, prefixEnd)
      cursor = prefixEnd
      changed = true
      val content = listContentStart(text, prefixEnd, lineEnd)
      if (content == null) {
        rebuilt.append("- [ ] ")
        insertions.add(prefixEnd to 6)
        continue
      }
      rebuilt.append(text, cursor, content)
      cursor = content
      val state = checkboxState(text, content, lineEnd)
      if (state != null) {
        rebuilt.append('[').append(if (state == ' ') 'x' else ' ')
        cursor = content + 2
      } else {
        rebuilt.append("[ ] ")
        insertions.add(content to 4)
      }
    }
    if (!changed) return null
    rebuilt.append(text, cursor, last)
    fun moved(offset: Int) = offset + insertions.filter { it.first <= offset }.sumOf { it.second }
    return TextEdit(first, last, rebuilt.toString(), moved(start), moved(end))
  }

  /**
   * with no selection, inserts `[[]]` with the caret between the brackets, so the link
   * suggestions open. a selection on one line becomes the link's target, with the caret before
   * `]]`. spaces and tabs around the selection stay outside the link.
   */
  fun insertLink(text: CharSequence, start: Int, end: Int): TextEdit? {
    if (!isValid(text, start, end)) return null
    var targetStart = start
    var targetEnd = end
    while (targetStart < targetEnd && (text[targetStart] == ' ' || text[targetStart] == '\t')) targetStart++
    while (targetEnd > targetStart && (text[targetEnd - 1] == ' ' || text[targetEnd - 1] == '\t')) targetEnd--
    if (targetStart == targetEnd) return TextEdit(start, start, "[[]]", start + 2, start + 2)
    val name = text.substring(targetStart, targetEnd)
    if (name.any { it == '\n' || it == '\r' || it == '[' || it == ']' }) return null
    val caret = targetStart + 2 + name.length
    return TextEdit(targetStart, targetEnd, "[[$name]]", caret, caret)
  }

  /**
   * inserts `#` at the caret or before the selection, with a space before it when the
   * character before is not a space, a tab, or a line break. the selection stays selected.
   */
  fun insertTag(text: CharSequence, start: Int, end: Int): TextEdit? {
    if (!isValid(text, start, end)) return null
    val needsSpace = start > 0 && text[start - 1] !in " \t\n\r"
    val inserted = if (needsSpace) " #" else "#"
    return TextEdit(start, start, inserted, start + inserted.length, end + inserted.length)
  }

  // MARK: - lines

  private fun isValid(text: CharSequence, start: Int, end: Int) = start in 0..end && end <= text.length

  private fun isLineBreak(char: Char) = char == '\n' || char == '\r'

  private fun lineStart(text: CharSequence, offset: Int): Int {
    var index = offset
    while (index > 0 && !isLineBreak(text[index - 1])) index--
    return index
  }

  private fun lineEnd(text: CharSequence, offset: Int): Int {
    var index = offset
    while (index < text.length && !isLineBreak(text[index])) index++
    return index
  }

  /** the start of each line the selection touches; a selection ending at a line's start leaves it out. */
  private fun lineStarts(text: CharSequence, start: Int, end: Int): List<Int> {
    var last = end
    if (end > start && isLineBreak(text[end - 1])) {
      last--
      // a "\r\n" pair is one line break.
      if (last > start && text[last] == '\n' && text[last - 1] == '\r') last--
    }
    val starts = arrayListOf(lineStart(text, start))
    var index = lineEnd(text, starts[0])
    while (index < last) {
      if (text[index] == '\r' && index + 1 < text.length && text[index + 1] == '\n') index++
      index++
      starts.add(index)
      index = lineEnd(text, index)
    }
    return starts
  }

  private fun skipSpaces(text: CharSequence, offset: Int, end: Int, tabs: Boolean): Int {
    var index = offset
    while (index < end && (text[index] == ' ' || (tabs && text[index] == '\t'))) index++
    return index
  }

  /** the end of the line's indentation and any `>` quote markers. */
  private fun quotePrefixEnd(text: CharSequence, start: Int, end: Int): Int {
    var index = skipSpaces(text, start, end, tabs = true)
    while (index < end && text[index] == '>') index = skipSpaces(text, index + 1, end, tabs = true)
    return index
  }

  /**
   * for a list marker (`-`, `*`, `+`, or one to nine digits and `.` or `)`) followed by a
   * space, the offset after the marker and its spaces; null when the line is not a list item.
   */
  private fun listContentStart(text: CharSequence, offset: Int, end: Int): Int? {
    if (offset >= end) return null
    var index = offset
    if (text[index] == '-' || text[index] == '*' || text[index] == '+') {
      index++
    } else {
      while (index < end && index - offset < 10 && text[index] in '0'..'9') index++
      val digits = index - offset
      if (digits !in 1..9 || index >= end || (text[index] != '.' && text[index] != ')')) return null
      index++
    }
    if (index >= end || text[index] != ' ') return null
    return skipSpaces(text, index, end, tabs = false)
  }

  /** the state of a `[ ]`, `[x]`, or `[X]` box at the offset, when a space or the line's end follows it. */
  private fun checkboxState(text: CharSequence, offset: Int, end: Int): Char? {
    if (offset + 3 > end || text[offset] != '[' || text[offset + 2] != ']') return null
    if (offset + 3 != end && text[offset + 3] != ' ') return null
    return text[offset + 1].takeIf { it == ' ' || it == 'x' || it == 'X' }
  }

  // MARK: - emphasis

  private val BLANK_LINE = Regex("\\r?\\n[ \\t]*\\r?\\n")

  /** letters, marks, numbers, and `_`, as in laperm's word motions. */
  private fun isWordCodePoint(codePoint: Int): Boolean {
    if (codePoint == '_'.code || Character.isLetter(codePoint)) return true
    return when (Character.getType(codePoint).toByte()) {
      Character.NON_SPACING_MARK, Character.ENCLOSING_MARK, Character.COMBINING_SPACING_MARK,
      Character.DECIMAL_DIGIT_NUMBER, Character.LETTER_NUMBER, Character.OTHER_NUMBER -> true
      else -> false
    }
  }

  private fun isWordAt(text: CharSequence, offset: Int): Boolean =
    offset in 0 until text.length && isWordCodePoint(Character.codePointAt(text, offset))

  private fun isWordBefore(text: CharSequence, offset: Int): Boolean =
    offset in 1..text.length && isWordCodePoint(Character.codePointBefore(text, offset))

  /** the word at or next to the offset; empty at the offset when there is none. */
  private fun wordRange(text: CharSequence, offset: Int): Pair<Int, Int> {
    var start = offset
    while (start > 0 && isWordBefore(text, start)) start -= Character.charCount(Character.codePointBefore(text, start))
    var end = offset
    while (end < text.length && isWordAt(text, end)) end += Character.charCount(Character.codePointAt(text, end))
    return start to end
  }

  /** an odd number of backticks between the line's start and the offset (a line-by-line guess). */
  private fun isInsideCodeSpan(text: CharSequence, offset: Int): Boolean =
    (lineStart(text, offset) until offset).count { text[it] == '`' } % 2 == 1

  /** whether a run of this many marker characters applies the style: `**` is bold, odd runs are italic. */
  private fun matches(runLength: Int, strong: Boolean) = if (strong) runLength >= 2 else runLength % 2 == 1

  /** a run of the style's markers away from both ends of the content, as in `**a** and **b**`. */
  private fun hasAmbiguousMarkers(content: String, strong: Boolean): Boolean {
    var index = 0
    while (index < content.length) {
      val char = content[index]
      if (char != '*' && char != '_') {
        index++
        continue
      }
      var runEnd = index
      while (runEnd < content.length && content[runEnd] == char) runEnd++
      if (index != 0 && runEnd != content.length && matches(runEnd - index, strong)) return true
      index = runEnd
    }
    return false
  }

  /** the marker character and the length of its run ending at the offset. */
  private fun runBefore(text: CharSequence, offset: Int): Pair<Char, Int>? {
    if (offset <= 0) return null
    val char = text[offset - 1]
    if (char != '*' && char != '_') return null
    var length = 0
    while (offset - length > 0 && text[offset - length - 1] == char) length++
    return char to length
  }

  /** the marker character and the length of its run starting at the offset. */
  private fun runAfter(text: CharSequence, offset: Int): Pair<Char, Int>? {
    if (offset >= text.length) return null
    val char = text[offset]
    if (char != '*' && char != '_') return null
    var length = 0
    while (offset + length < text.length && text[offset + length] == char) length++
    return char to length
  }

  /** `_` delimits only when no word character is just outside it (not `foo_bar_baz`). */
  private fun underscoreDelimits(text: CharSequence, openingStart: Int, closingEnd: Int) =
    !isWordBefore(text, openingStart) && !isWordAt(text, closingEnd)

  /** the range inside the style's markers when the target starts and ends with them. */
  private fun innerRange(text: CharSequence, start: Int, end: Int, strong: Boolean): Pair<Int, Int>? {
    val leading = runAfter(text, start) ?: return null
    val trailing = runBefore(text, end) ?: return null
    if (leading.first != trailing.first) return null
    val length = end - start
    val available = minOf(minOf(leading.second, length), minOf(trailing.second, length), length / 2)
    if (!matches(available, strong)) return null
    if (leading.first == '_' && !underscoreDelimits(text, start, end)) return null
    val size = if (strong) 2 else 1
    return start + size to end - size
  }

  /** the target with the style's markers around it, when they are there. */
  private fun outerRange(text: CharSequence, start: Int, end: Int, strong: Boolean): Pair<Int, Int>? {
    val before = runBefore(text, start) ?: return null
    val after = runAfter(text, end) ?: return null
    if (before.first != after.first || !matches(minOf(before.second, after.second), strong)) return null
    if (before.first == '_' && !underscoreDelimits(text, start - before.second, end + after.second)) return null
    val size = if (strong) 2 else 1
    return start - size to end + size
  }
}
