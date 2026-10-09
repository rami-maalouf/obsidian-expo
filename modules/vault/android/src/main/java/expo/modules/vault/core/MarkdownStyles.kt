package expo.modules.vault.core

/** the kinds of restrained source styling the android editor draws (ktd3). */
enum class MarkdownStyle {
  HEADING,

  /** syntax characters such as `#`, `>`, list bullets, and emphasis delimiters, drawn dimmed. */
  MARKER,
  STRONG,
  EMPHASIS,
  STRIKE,
  CODE,
  CODE_BLOCK,
  WIKILINK,
  LINK,
  URL,
  TAG,
  FRONT_MATTER,
}

/** a styled range of the text. [level] is a heading's level; [target] is a wikilink's target. */
data class StyledRange(
  val start: Int,
  val end: Int,
  val style: MarkdownStyle,
  val level: Int = 0,
  val target: String? = null,
)

/** a `[[wikilink]]` or `![[embed]]`: its offsets, the note it names, and the heading after `#`. */
data class WikiLinkReference(val start: Int, val end: Int, val target: String, val heading: String?, val embed: Boolean)

/**
 * finds what to style in markdown source, one line at a time. styling only adds spans; the text
 * is never changed, so the saved file is exactly what was typed. block state that spans lines
 * (front matter and code fences) is found by scanning from the top of the note.
 */
object MarkdownStyles {
  private val heading = Regex("^ {0,3}(#{1,6})(?:[ \\t]+|$)")
  private val quote = Regex("^ {0,3}(?:> ?)+")
  private val listItem = Regex("^[ \\t]*(?:[-*+]|\\d{1,9}[.)])[ \\t]+(?:\\[[ xX]\\][ \\t])?")
  private val rule = Regex("^ {0,3}([-*_])(?:[ \\t]*\\1){2,}[ \\t]*$")
  private val wikiLink = Regex("(!?)\\[\\[([^\\[\\]\\n\\r]+?)\\]\\]")
  private val link = Regex("(!?)\\[([^\\[\\]\\n\\r]+)\\]\\(([^()\\s]+)(?:[ \\t]+\"[^\"\\n\\r]*\")?\\)")
  private val strong = Regex("(\\*\\*|__)(?=\\S)(.+?)(?<=\\S)\\1")
  private val starEmphasis = Regex("(?<![*\\w])\\*(?=[^\\s*])(.+?)(?<=[^\\s*])\\*(?![*\\w])")
  private val underscoreEmphasis = Regex("(?<![_\\p{L}\\p{N}])_(?=[^\\s_])(.+?)(?<=[^\\s_])_(?![_\\p{L}\\p{N}])")
  private val strike = Regex("~~(?=\\S)(.+?)(?<=\\S)~~")
  private val tag = Regex("(?<![\\p{L}\\p{N}_#/&])#[\\p{L}\\p{N}_/-]*[\\p{L}_/-][\\p{L}\\p{N}_/-]*")

  /** the offset just past the front matter's closing line, or 0 when the note has none. */
  fun frontMatterEnd(text: CharSequence): Int {
    var lineEnd = lineEnd(text, 0)
    if (text.subSequence(0, lineEnd).toString().trimEnd() != "---") {
      return 0
    }
    var start = nextLine(text, lineEnd)
    while (start < text.length) {
      lineEnd = lineEnd(text, start)
      val line = text.subSequence(start, lineEnd).toString().trimEnd()
      if (line == "---" || line == "...") {
        return minOf(nextLine(text, lineEnd), text.length)
      }
      start = nextLine(text, lineEnd)
    }
    // an unclosed block is not front matter.
    return 0
  }

  /** styles for every line that intersects [from, to). offsets are into [text]. */
  fun style(text: CharSequence, from: Int, to: Int): List<StyledRange> {
    val ranges = ArrayList<StyledRange>()
    val frontMatter = frontMatterEnd(text)
    var start = lineStart(text, minOf(from, text.length))
    var fence = fenceBefore(text, start, frontMatter)
    val stop = minOf(maxOf(to, from), text.length)
    while (true) {
      val end = lineEnd(text, start)
      val line = text.subSequence(start, end)
      when {
        start < frontMatter -> if (end > start) ranges.add(StyledRange(start, end, MarkdownStyle.FRONT_MATTER))
        fence != null -> {
          if (end > start) ranges.add(StyledRange(start, end, MarkdownStyle.CODE_BLOCK))
          if (closesFence(line, fence)) {
            if (end > start) ranges.add(StyledRange(start, end, MarkdownStyle.MARKER))
            fence = null
          }
        }
        else -> {
          val opened = opensFence(line)
          if (opened != null) {
            ranges.add(StyledRange(start, end, MarkdownStyle.CODE_BLOCK))
            ranges.add(StyledRange(start, end, MarkdownStyle.MARKER))
            fence = opened
          } else {
            styleLine(line, start, ranges)
          }
        }
      }
      if (end >= stop) break
      val next = nextLine(text, end)
      if (next <= start || next > text.length) break
      start = next
    }
    return ranges
  }

  /** whether the text in [start, end) could open or close a block: a fence or a front matter line. */
  fun touchesBlockSyntax(text: CharSequence, start: Int, end: Int): Boolean {
    val from = lineStart(text, minOf(start, text.length))
    val to = lineEnd(text, minOf(maxOf(end, start), text.length))
    val region = text.subSequence(from, to).toString()
    return region.contains("```") || region.contains("~~~") || region.contains("---") || region.contains("...")
  }

  /** the note's headings outside front matter and code: each line's offset and its text. */
  fun headings(text: CharSequence): List<Pair<Int, String>> {
    val found = ArrayList<Pair<Int, String>>()
    var fence: Fence? = null
    var start = frontMatterEnd(text)
    while (start <= text.length) {
      val end = lineEnd(text, start)
      val line = text.subSequence(start, end)
      if (fence != null) {
        if (closesFence(line, fence)) fence = null
      } else {
        val opened = opensFence(line)
        if (opened != null) {
          fence = opened
        } else {
          heading.find(line)?.let { match ->
            // a closing run of "#" after a space is not part of the title.
            val title = line.substring(match.range.last + 1).replace(closingHashes, "").trim()
            found.add(start to title)
          }
        }
      }
      val next = nextLine(text, end)
      if (next <= start) break
      start = next
    }
    return found
  }

  private val closingHashes = Regex("[ \\t]+#+[ \\t]*$|^#+[ \\t]*$")

  /** the wikilink at [offset], if the offset is inside one. */
  fun wikiLinkAt(text: CharSequence, offset: Int): WikiLinkReference? {
    if (offset < 0 || offset > text.length) return null
    val start = lineStart(text, offset)
    val line = text.subSequence(start, lineEnd(text, offset))
    return wikiLinks(line, start).firstOrNull { offset >= it.start && offset < it.end }
  }

  /** the wikilinks on one line; [offset] is the line's position in the note. */
  fun wikiLinks(line: CharSequence, offset: Int): List<WikiLinkReference> = wikiLink.findAll(line).map { match ->
    val inner = match.groupValues[2]
    val beforeAlias = inner.substringBefore('|')
    val target = beforeAlias.substringBefore('#').trim()
    val heading = if (beforeAlias.contains('#')) beforeAlias.substringAfter('#').trim() else null
    WikiLinkReference(offset + match.range.first, offset + match.range.last + 1, target, heading, match.groupValues[1] == "!")
  }.toList()

  // MARK: - lines

  private fun styleLine(line: CharSequence, offset: Int, out: MutableList<StyledRange>) {
    var inlineFrom = 0
    heading.find(line)?.let { match ->
      val level = match.groupValues[1].length
      out.add(StyledRange(offset, offset + line.length, MarkdownStyle.HEADING, level = level))
      out.add(StyledRange(offset + match.range.first, offset + match.range.last + 1, MarkdownStyle.MARKER))
      inlineFrom = match.range.last + 1
    }
    if (inlineFrom == 0) {
      if (rule.matches(line)) {
        out.add(StyledRange(offset, offset + line.length, MarkdownStyle.MARKER))
        return
      }
      quote.find(line)?.let { match ->
        out.add(StyledRange(offset, offset + match.range.last + 1, MarkdownStyle.MARKER))
        inlineFrom = match.range.last + 1
      }
      listItem.find(line, inlineFrom)?.takeIf { it.range.first == inlineFrom }?.let { match ->
        out.add(StyledRange(offset + match.range.first, offset + match.range.last + 1, MarkdownStyle.MARKER))
        inlineFrom = match.range.last + 1
      }
    }
    styleInline(line, inlineFrom, offset, out)
  }

  /**
   * inline styles. code spans, wikilinks, and link addresses are found first and masked, so
   * emphasis and tags are never found inside them.
   */
  private fun styleInline(line: CharSequence, from: Int, offset: Int, out: MutableList<StyledRange>) {
    if (from >= line.length) return
    val masked = StringBuilder(line)
    fun mask(start: Int, end: Int) {
      for (index in start until end) masked.setCharAt(index, '\u0001')
    }
    for (index in 0 until from) masked.setCharAt(index, '\u0001')

    // code spans: a run of backticks closed by a run of the same length.
    var index = from
    while (index < line.length) {
      if (line[index] != '`') {
        index += 1
        continue
      }
      val runEnd = runEnd(line, index, '`')
      val run = runEnd - index
      var search = runEnd
      var close = -1
      while (search < line.length) {
        if (line[search] == '`') {
          val end = runEnd(line, search, '`')
          if (end - search == run) {
            close = search
            break
          }
          search = end
        } else {
          search += 1
        }
      }
      if (close < 0) {
        index = runEnd
        continue
      }
      out.add(StyledRange(offset + index, offset + runEnd, MarkdownStyle.MARKER))
      out.add(StyledRange(offset + runEnd, offset + close, MarkdownStyle.CODE))
      out.add(StyledRange(offset + close, offset + close + run, MarkdownStyle.MARKER))
      mask(index, close + run)
      index = close + run
    }

    for (match in wikiLink.findAll(masked)) {
      val first = match.range.first
      val last = match.range.last + 1
      val inner = match.groups[2]!!.range
      val target = match.groupValues[2].substringBefore('|').substringBefore('#').trim()
      out.add(StyledRange(offset + first, offset + inner.first, MarkdownStyle.MARKER))
      out.add(StyledRange(offset + inner.first, offset + inner.last + 1, MarkdownStyle.WIKILINK, target = target))
      out.add(StyledRange(offset + inner.last + 1, offset + last, MarkdownStyle.MARKER))
      mask(first, last)
    }

    for (match in link.findAll(masked)) {
      val text = match.groups[2]!!.range
      val first = match.range.first
      val last = match.range.last + 1
      out.add(StyledRange(offset + first, offset + text.first, MarkdownStyle.MARKER))
      out.add(StyledRange(offset + text.first, offset + text.last + 1, MarkdownStyle.LINK))
      out.add(StyledRange(offset + text.last + 1, offset + text.last + 2, MarkdownStyle.MARKER))
      out.add(StyledRange(offset + text.last + 2, offset + last, MarkdownStyle.URL))
      mask(text.last + 1, last)
    }

    fun delimited(regex: Regex, style: MarkdownStyle, delimiter: (MatchResult) -> Int) {
      for (match in regex.findAll(masked)) {
        val size = delimiter(match)
        val first = match.range.first
        val last = match.range.last + 1
        out.add(StyledRange(offset + first, offset + first + size, MarkdownStyle.MARKER))
        out.add(StyledRange(offset + first + size, offset + last - size, style))
        out.add(StyledRange(offset + last - size, offset + last, MarkdownStyle.MARKER))
      }
    }
    delimited(strong, MarkdownStyle.STRONG) { 2 }
    delimited(starEmphasis, MarkdownStyle.EMPHASIS) { 1 }
    delimited(underscoreEmphasis, MarkdownStyle.EMPHASIS) { 1 }
    delimited(strike, MarkdownStyle.STRIKE) { 2 }

    for (match in tag.findAll(masked)) {
      out.add(StyledRange(offset + match.range.first, offset + match.range.last + 1, MarkdownStyle.TAG))
    }
  }

  // MARK: - fences

  private data class Fence(val char: Char, val length: Int)

  private fun opensFence(line: CharSequence): Fence? {
    val indent = line.indexOfFirst { it != ' ' }.let { if (it < 0) line.length else it }
    if (indent > 3 || indent >= line.length) return null
    val char = line[indent]
    if (char != '`' && char != '~') return null
    val end = runEnd(line, indent, char)
    if (end - indent < 3) return null
    // a backtick fence's info string cannot contain a backtick.
    if (char == '`' && line.subSequence(end, line.length).contains('`')) return null
    return Fence(char, end - indent)
  }

  private fun closesFence(line: CharSequence, fence: Fence): Boolean {
    val indent = line.indexOfFirst { it != ' ' }.let { if (it < 0) line.length else it }
    if (indent > 3 || indent >= line.length || line[indent] != fence.char) return false
    val end = runEnd(line, indent, fence.char)
    return end - indent >= fence.length && line.subSequence(end, line.length).isBlank()
  }

  /** the fence open at [lineStart], found by scanning the lines after the front matter. */
  private fun fenceBefore(text: CharSequence, lineStart: Int, frontMatter: Int): Fence? {
    var fence: Fence? = null
    var start = frontMatter
    while (start < lineStart) {
      val end = lineEnd(text, start)
      val line = text.subSequence(start, end)
      fence = if (fence == null) opensFence(line) else if (closesFence(line, fence)) null else fence
      val next = nextLine(text, end)
      if (next <= start) break
      start = next
    }
    return fence
  }

  // MARK: - line boundaries ("\n", "\r\n", and "\r" all end a line)

  private fun runEnd(text: CharSequence, from: Int, char: Char): Int {
    var end = from
    while (end < text.length && text[end] == char) end += 1
    return end
  }

  internal fun lineStart(text: CharSequence, offset: Int): Int {
    var index = minOf(offset, text.length)
    while (index > 0 && text[index - 1] != '\n' && text[index - 1] != '\r') index -= 1
    return index
  }

  internal fun lineEnd(text: CharSequence, offset: Int): Int {
    var index = maxOf(0, offset)
    while (index < text.length && text[index] != '\n' && text[index] != '\r') index += 1
    return index
  }

  /** the start of the line after the line break at [lineEnd]; the text's length at the end. */
  private fun nextLine(text: CharSequence, lineEnd: Int): Int = when {
    lineEnd >= text.length -> text.length + 1
    text[lineEnd] == '\r' && lineEnd + 1 < text.length && text[lineEnd + 1] == '\n' -> lineEnd + 2
    else -> lineEnd + 1
  }
}
