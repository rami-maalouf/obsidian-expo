package expo.modules.vault

import android.content.Context
import android.content.res.ColorStateList
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import androidx.core.view.ViewCompat

/** the editing toolbar's buttons, in order (t17), with their material symbols and labels. */
enum class ToolbarAction(val icon: Int, val label: String) {
  UNDO(R.drawable.vault_toolbar_undo, "Undo"),
  REDO(R.drawable.vault_toolbar_redo, "Redo"),
  OUTDENT(R.drawable.vault_toolbar_outdent, "Outdent"),
  INDENT(R.drawable.vault_toolbar_indent, "Indent"),
  TASK(R.drawable.vault_toolbar_task, "Task"),
  LINK(R.drawable.vault_toolbar_link, "Link"),
  TAG(R.drawable.vault_toolbar_tag, "Tag"),
  BOLD(R.drawable.vault_toolbar_bold, "Bold"),
  ITALIC(R.drawable.vault_toolbar_italic, "Italic"),
  HIDE_KEYBOARD(R.drawable.vault_toolbar_hide_keyboard, "Hide keyboard"),
}

/**
 * the row of buttons that sits on the keyboard while the note's text has focus. android has no
 * keyboard accessory view like ios's, so the editor places this row above the keyboard's insets.
 * the buttons never take focus, so the text keeps its caret and the keyboard stays up.
 */
class EditorToolbar(context: Context) : FrameLayout(context) {
  var onAction: ((ToolbarAction) -> Unit)? = null

  private val divider = View(context)
  private val buttons: List<ImageButton>

  init {
    val ripple = TypedValue().also {
      context.theme.resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, it, true)
    }.resourceId
    val row = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(4), 0, dp(4), 0)
    }
    buttons = ToolbarAction.entries.map { action ->
      ImageButton(context).apply {
        setImageResource(action.icon)
        scaleType = ImageView.ScaleType.CENTER
        if (ripple != 0) setBackgroundResource(ripple) else background = null
        contentDescription = action.label
        ViewCompat.setTooltipText(this, action.label)
        isFocusable = false
        setOnClickListener { onAction?.invoke(action) }
        row.addView(this, LinearLayout.LayoutParams(dp(48), dp(48)))
      }
    }
    val scroll = HorizontalScrollView(context).apply {
      isHorizontalScrollBarEnabled = false
      addView(row, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.MATCH_PARENT))
    }
    addView(scroll, LayoutParams(LayoutParams.MATCH_PARENT, dp(HEIGHT_DP)))
    addView(divider, LayoutParams(LayoutParams.MATCH_PARENT, dp(1), Gravity.TOP))
  }

  fun setColors(icon: Int, surface: Int, line: Int) {
    setBackgroundColor(surface)
    divider.setBackgroundColor(line)
    val tint = ColorStateList.valueOf(icon)
    for (button in buttons) button.imageTintList = tint
  }

  private fun dp(value: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

  companion object {
    const val HEIGHT_DP = 48
  }
}
