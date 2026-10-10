package expo.modules.vault

import android.graphics.Typeface
import android.text.Spannable
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.RelativeSizeSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.TypefaceSpan
import expo.modules.vault.core.MarkdownStyle
import expo.modules.vault.core.MarkdownStyles

/** spans this editor adds; only these are removed when lines are styled again. */
internal interface EditorSpan

internal class BoldSpan : StyleSpan(Typeface.BOLD), EditorSpan
internal class ItalicSpan : StyleSpan(Typeface.ITALIC), EditorSpan
internal class HeadingSizeSpan(scale: Float) : RelativeSizeSpan(scale), EditorSpan
internal class StrikeSpan : StrikethroughSpan(), EditorSpan
internal class MonoSpan : TypefaceSpan("monospace"), EditorSpan
internal class ColorSpan(color: Int) : ForegroundColorSpan(color), EditorSpan

/** a wikilink's text; its color says whether a note matches [target]. */
internal class WikiLinkSpan(color: Int, val target: String) : ForegroundColorSpan(color), EditorSpan

/** the colors of the restrained source styling, from the editor's light or dark palette. */
internal data class EditorPalette(val text: Int, val secondary: Int, val accent: Int, val unresolved: Int, val code: Int)

/**
 * applies [MarkdownStyles] to the text as spans (ktd3). styling never changes characters, so the
 * saved file is exactly what was typed.
 */
internal class EditorStyler(var palette: EditorPalette) {
  /** whether a wikilink target names a note; null before the vault's first listing. */
  var resolves: ((String) -> Boolean?)? = null

  /** styles every line that intersects [from, to), replacing this editor's earlier spans there. */
  fun style(text: Spannable, from: Int, to: Int) {
    if (text.isEmpty()) return
    val start = MarkdownStyles.lineStart(text, from.coerceIn(0, text.length))
    val end = MarkdownStyles.lineEnd(text, to.coerceIn(start, text.length))
    for (span in text.getSpans(start, end, EditorSpan::class.java)) {
      val spanStart = text.getSpanStart(span)
      val spanEnd = text.getSpanEnd(span)
      if (spanStart >= start && spanEnd <= end) text.removeSpan(span)
    }
    for (range in MarkdownStyles.style(text, start, end)) {
      if (range.end <= range.start || range.end > text.length) continue
      for (span in spans(range.style, range.level, range.target)) {
        text.setSpan(span, range.start, range.end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      }
    }
  }

  /** recolors wikilinks after the vault's notes change. */
  fun recolorLinks(text: Spannable) {
    for (span in text.getSpans(0, text.length, WikiLinkSpan::class.java)) {
      val start = text.getSpanStart(span)
      val end = text.getSpanEnd(span)
      text.removeSpan(span)
      text.setSpan(WikiLinkSpan(linkColor(span.target), span.target), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
  }

  private fun linkColor(target: String): Int =
    if (target.isEmpty() || resolves?.invoke(target) != false) palette.accent else palette.unresolved

  private fun spans(style: MarkdownStyle, level: Int, target: String?): List<Any> = when (style) {
    MarkdownStyle.HEADING -> listOf(BoldSpan(), HeadingSizeSpan(HEADING_SCALES.getOrElse(level - 1) { 1f }))
    MarkdownStyle.MARKER -> listOf(ColorSpan(palette.secondary))
    MarkdownStyle.STRONG -> listOf(BoldSpan())
    MarkdownStyle.EMPHASIS -> listOf(ItalicSpan())
    MarkdownStyle.STRIKE -> listOf(StrikeSpan())
    MarkdownStyle.CODE -> listOf(MonoSpan(), ColorSpan(palette.code))
    MarkdownStyle.CODE_BLOCK -> listOf(MonoSpan())
    MarkdownStyle.WIKILINK -> listOf(WikiLinkSpan(linkColor(target ?: ""), target ?: ""))
    MarkdownStyle.LINK, MarkdownStyle.TAG -> listOf(ColorSpan(palette.accent))
    MarkdownStyle.URL, MarkdownStyle.FRONT_MATTER -> listOf(ColorSpan(palette.secondary))
  }

  private companion object {
    /** the same ratios as the ios editor's headings. */
    val HEADING_SCALES = floatArrayOf(1.6f, 1.4f, 1.25f, 1.1f, 1f, 1f)
  }
}
