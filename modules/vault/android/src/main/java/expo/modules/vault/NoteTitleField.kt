package expo.modules.vault

import android.annotation.SuppressLint
import android.content.Context
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.EditText

/**
 * the note's name above its text, as obsidian's inline title. it is in the editor's scroll view,
 * so it scrolls with the text, and a long name wraps. return moves to the text; when the field
 * loses focus, the editor offers the typed name for a rename (VaultEditorView.kt).
 */
@SuppressLint("AppCompatCustomView")
class NoteTitleField(context: Context) : EditText(context) {
  /** moves focus away from the name, to the editor's own container. */
  var onRelease: (() -> Unit)? = null

  fun release() {
    onRelease?.invoke() ?: clearFocus()
  }

  /** ui tests find the name by this resource id; talkback does not read resource ids. */
  override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
    super.onInitializeAccessibilityNodeInfo(info)
    info.viewIdResourceName = "note-title"
  }
}
