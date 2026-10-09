package expo.modules.vault

import android.annotation.SuppressLint
import android.content.Context
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.widget.EditText
import kotlin.math.abs

/**
 * the note's text field. a tap on a wikilink while the field does not have focus (the keyboard
 * is down, as when a note opens) follows the link instead of placing the caret, like a rendered
 * link on ios; with the keyboard up, a tap edits as usual.
 */
@SuppressLint("AppCompatCustomView")
class VaultEditText(context: Context) : EditText(context) {
  /** the wikilink under a touch, or null; the editor resolves and follows it. */
  var linkAt: ((offset: Int) -> Boolean)? = null
  var onFollowLink: ((offset: Int) -> Unit)? = null
  var onSelectionChange: (() -> Unit)? = null

  /** keys the link popup takes while it is open; returns true when it handled the key. */
  var onPopupKey: ((keyCode: Int) -> Boolean)? = null

  /** moves focus away from the text, to the editor's own container. */
  var onRelease: (() -> Unit)? = null

  private val slop = ViewConfiguration.get(context).scaledTouchSlop
  private var downX = 0f
  private var downY = 0f
  private var linkOffset = -1

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (!isFocused) {
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = event.x
          downY = event.y
          linkOffset = offsetAt(event).takeIf { it >= 0 && linkAt?.invoke(it) == true } ?: -1
        }
        MotionEvent.ACTION_MOVE -> if (abs(event.x - downX) > slop || abs(event.y - downY) > slop) linkOffset = -1
        MotionEvent.ACTION_UP -> if (linkOffset >= 0 && event.eventTime - event.downTime < ViewConfiguration.getLongPressTimeout()) {
          val offset = linkOffset
          linkOffset = -1
          // cancel the touch in the text view, so it neither focuses nor shows the keyboard.
          val cancel = MotionEvent.obtain(event).apply { action = MotionEvent.ACTION_CANCEL }
          super.onTouchEvent(cancel)
          cancel.recycle()
          onFollowLink?.invoke(offset)
          return true
        }
        MotionEvent.ACTION_CANCEL -> linkOffset = -1
      }
    }
    return super.onTouchEvent(event)
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    if (onPopupKey?.invoke(keyCode) == true) return true
    return super.onKeyDown(keyCode, event)
  }

  override fun onSelectionChanged(selStart: Int, selEnd: Int) {
    super.onSelectionChanged(selStart, selEnd)
    onSelectionChange?.invoke()
  }

  fun release() {
    onRelease?.invoke() ?: clearFocus()
  }

  private fun offsetAt(event: MotionEvent): Int {
    val layout = layout ?: return -1
    val x = event.x - totalPaddingLeft + scrollX
    val y = event.y - totalPaddingTop + scrollY
    val line = layout.getLineForVertical(y.toInt())
    if (x < layout.getLineLeft(line) || x > layout.getLineRight(line)) return -1
    return layout.getOffsetForHorizontal(line, x)
  }
}
