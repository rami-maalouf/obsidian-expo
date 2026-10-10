package expo.modules.vault

import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView

/**
 * the `[[` link popup: up to six notes (or headings) with their folders. rows are not
 * focusable, so a tap chooses a row without taking focus or the keyboard from the text.
 */
internal class CompletionPanel(context: Context) : LinearLayout(context) {
  data class Item(val title: String, val detail: String?, val isHeading: Boolean)

  var onSelect: ((Int) -> Unit)? = null
  var items: List<Item> = emptyList()
    private set
  var highlighted = 0
    private set

  private var palette: EditorPalette? = null
  private var surface = 0

  init {
    orientation = VERTICAL
    elevation = dp(8f)
    setPadding(0, dp(4f).toInt(), 0, dp(4f).toInt())
    visibility = GONE
    isFocusable = false
  }

  fun setColors(palette: EditorPalette, surface: Int) {
    this.palette = palette
    this.surface = surface
    background = GradientDrawable().apply {
      cornerRadius = dp(12f)
      setColor(surface)
    }
    render()
  }

  fun show(items: List<Item>) {
    this.items = items
    highlighted = 0
    render()
  }

  fun moveHighlight(by: Int) {
    if (items.isEmpty()) return
    highlighted = (highlighted + by + items.size) % items.size
    render()
  }

  private fun render() {
    removeAllViews()
    val palette = palette ?: return
    items.forEachIndexed { index, item ->
      val row = LinearLayout(context).apply {
        orientation = VERTICAL
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = dp(ROW_HEIGHT_DP).toInt()
        setPadding(dp(14f).toInt(), dp(6f).toInt(), dp(14f).toInt(), dp(6f).toInt())
        isFocusable = false
        if (index == highlighted) {
          background = GradientDrawable().apply {
            cornerRadius = dp(8f)
            setColor((palette.accent and 0x00FFFFFF) or 0x33000000)
          }
        }
        contentDescription = if (item.detail != null) "${item.title}, in ${item.detail}" else item.title
        setOnClickListener { onSelect?.invoke(index) }
      }
      row.addView(label(if (item.isHeading) "# ${item.title}" else item.title, palette.text, 16f))
      item.detail?.let { row.addView(label(it, palette.secondary, 13f)) }
      addView(row, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
    }
  }

  private fun label(text: String, color: Int, size: Float) = TextView(context).apply {
    this.text = text
    setTextColor(color)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
    maxLines = 1
    ellipsize = TextUtils.TruncateAt.END
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
  }

  private fun dp(value: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, resources.displayMetrics)

  companion object {
    const val ROW_HEIGHT_DP = 48f
    const val WIDTH_DP = 320f
  }
}
