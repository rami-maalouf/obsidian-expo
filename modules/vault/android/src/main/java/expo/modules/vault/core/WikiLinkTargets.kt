package expo.modules.vault.core

import java.text.Normalizer
import java.util.Locale

/** a note offered while a link is typed. */
data class WikiLinkSuggestion(
  val path: String,
  /** the note's file name without ".md". */
  val name: String,
  /** the note's folder, or "" for the vault root. */
  val folder: String,
  /** the text that goes between `[[` and `]]`. */
  val linkText: String,
)

/**
 * finds the note a `[[wikilink]]` points to among the vault's markdown notes, and suggests
 * notes while a link is typed. the rules match the ios editor (WikiLinkTargets.swift).
 *
 * a target without "/" names a note (`[[Meeting notes]]`); a target with "/" is a vault path or
 * the end of one (`[[Projects/Plan]]` matches `Work/Projects/Plan.md`). matching ignores case,
 * unicode normalization, surrounding spaces, and a trailing ".md". when several notes match, a
 * note in the linking note's folder wins, then the shortest path, then the first path in sorted
 * order, so the same link always opens the same note.
 */
class WikiLinkTargets(notes: List<Note>) {
  /** a note in the listing: its vault path and, when known, its modification time in ms. */
  data class Note(val path: String, val modified: Long? = null)

  private class Entry(
    val path: String,
    val name: String,
    val folder: String,
    val foldedName: String,
    val foldedStem: String,
    val modified: Long,
  )

  private val byName = HashMap<String, MutableList<String>>()
  private val entries = ArrayList<Entry>()

  init {
    for (note in notes) {
      val name = noteName(note.path) ?: continue
      byName.getOrPut(key(name)) { ArrayList() }.add(note.path)
      entries.add(Entry(note.path, name, folder(note.path), folded(name), folded(note.path.dropLast(3)), note.modified ?: 0))
    }
  }

  /** the vault path of the note [target] names, or null. [source] is the linking note's path. */
  fun resolve(target: String, source: String?): String? {
    var wanted = key(target.trim(' ', '\t'))
    if (wanted.endsWith(".md")) {
      wanted = wanted.dropLast(3)
    }
    wanted = wanted.trimStart('/')
    val name = wanted.substringAfterLast('/')
    if (name.isEmpty()) {
      return null
    }
    var candidates: List<String> = byName[name] ?: return null
    if (wanted.contains('/')) {
      candidates = candidates.filter { path ->
        val stem = key(path.dropLast(3))
        stem == wanted || stem.endsWith("/$wanted")
      }
    }
    val sourceFolder = source?.let(::folder)
    return candidates.minWithOrNull(
      compareBy<String>({ folder(it) != sourceFolder }, { utf16Length(it) }, { it }),
    )
  }

  /**
   * notes for a link being typed, best first; the linking note itself is left out. an empty
   * query lists the most recently modified notes first. otherwise the query is matched against
   * note names (or vault paths when it contains "/"), ignoring case and accents.
   */
  fun suggestions(query: String, source: String?, limit: Int = 6): List<WikiLinkSuggestion> {
    val trimmed = query.trim(' ', '\t')
    val needle = folded(trimmed)
    val byPath = trimmed.contains('/')
    val sourceFolder = source?.let(::folder)
    val scored = entries.filter { it.path != source }.mapNotNull { entry ->
      scoreFolded(needle, if (byPath) entry.foldedStem else entry.foldedName)?.let { entry to it }
    }
    val ordered = scored.sortedWith(
      compareByDescending<Pair<Entry, Int>> { it.second }
        .thenBy { !(needle.isNotEmpty() && it.first.folder == sourceFolder) }
        .thenByDescending { it.first.modified }
        .thenBy { utf16Length(it.first.name) }
        .thenBy { it.first.path },
    )
    return ordered.take(limit).map { (entry, _) ->
      WikiLinkSuggestion(entry.path, entry.name, entry.folder, linkText(entry, source))
    }
  }

  /** the note's name when that name opens this note from [source]; otherwise its path. */
  private fun linkText(entry: Entry, source: String?): String =
    if (resolve(entry.name, source) == entry.path) entry.name else entry.path.dropLast(3)

  companion object {
    /** a fuzzy match score for strings that are not notes, such as headings; null is no match. */
    fun score(query: String, candidate: String): Int? = scoreFolded(folded(query.trim(' ', '\t')), folded(candidate))

    /**
     * how well [query] matches [candidate] (both folded); higher is better, null is no match.
     * an exact name, then a prefix, then a word start, then a substring, then the query's
     * characters in order. an empty query matches everything equally.
     */
    internal fun scoreFolded(query: String, candidate: String): Int? {
      if (query.isEmpty()) {
        return 0
      }
      if (candidate == query) {
        return 4000
      }
      if (candidate.startsWith(query)) {
        return 3000 - minOf(candidate.length - query.length, 999)
      }
      val at = candidate.indexOf(query)
      if (at > 0) {
        val wordStart = isSeparator(candidate[at - 1])
        return (if (wordStart) 2000 else 1000) - minOf(at, 999)
      }
      // the query's characters in order, with fewer and shorter gaps scoring higher.
      var next = 0
      var first = -1
      var last = -1
      var gaps = 0
      for ((index, char) in candidate.withIndex()) {
        if (next >= query.length) break
        if (char != query[next]) continue
        if (last >= 0) gaps += index - last - 1 else first = index
        last = index
        next += 1
      }
      if (next != query.length) {
        return null
      }
      return maxOf(1, 500 - gaps * 10 - first)
    }

    private fun isSeparator(char: Char): Boolean = char in " -_./(["

    /** the file name without ".md", or null for a path that is not a markdown note. */
    internal fun noteName(path: String): String? {
      val file = path.substringAfterLast('/')
      if (!file.lowercase(Locale.ROOT).endsWith(".md") || file.length <= 3) return null
      return file.dropLast(3)
    }

    internal fun folder(path: String): String = path.substringBeforeLast('/', "")

    internal fun key(text: String): String = Normalizer.normalize(text, Normalizer.Form.NFC).lowercase(Locale.ROOT)

    /** case, accents, and width folded, for suggestions. */
    internal fun folded(text: String): String =
      Normalizer.normalize(text, Normalizer.Form.NFKD).replace(marks, "").lowercase(Locale.ROOT)

    private val marks = Regex("\\p{M}+")

    private fun utf16Length(text: String): Int = text.length
  }
}
