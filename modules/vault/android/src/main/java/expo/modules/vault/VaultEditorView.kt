package expo.modules.vault

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Rect
import android.graphics.Typeface
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.Spanned
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.vault.core.DocumentSession
import expo.modules.vault.core.DocumentStatus
import expo.modules.vault.core.EditorCommands
import expo.modules.vault.core.FileState
import expo.modules.vault.core.LoadOutcome
import expo.modules.vault.core.MarkdownStyles
import expo.modules.vault.core.TextEdit
import expo.modules.vault.core.WikiLinkCompletion
import expo.modules.vault.core.WikiLinkQuery
import expo.modules.vault.core.WikiLinkReference
import expo.modules.vault.core.WikiLinkTargets
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

/**
 * the editor's scroll view. when the text takes focus, ScrollView scrolls a field taller than the
 * screen until the field's top is at the top of the screen, which would hide the name above the
 * text. a rectangle that tall is left where it is; the caret's own, smaller rectangle still keeps
 * the caret on screen.
 */
private class NoteScrollView(context: Context) : ScrollView(context) {
  override fun computeScrollDeltaToGetChildRectOnScreen(rect: Rect): Int =
    if (rect.height() > height) 0 else super.computeScrollDeltaToGetChildRectOnScreen(rect)
}

/**
 * native markdown source editor for android (ktd3). native code owns the text, selection,
 * composition, and undo; javascript receives status events, never the full text on each
 * keystroke. the document session, drafts, saves, and newline rules are the same as on ios
 * (VaultEditorView.swift). the source is shown with restrained styling: spans only, never
 * changed characters. live preview, which hides markers on ios, is not part of the android
 * editor yet. the note's name is above the text, in the same scroll view (NoteTitleField.kt).
 */
class VaultEditorView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onStatus by EventDispatcher()
  private val onLoad by EventDispatcher()

  /** a tap on a wikilink to another note: `target` as written, and `path` when a note matches. */
  private val onOpenLink by EventDispatcher()

  /** the text left its top or returned to it; the app bar takes a surface color while scrolled. */
  private val onScrolledChange by EventDispatcher()

  /** editing the name above the text ended with a new `title`; javascript renames the note. */
  private val onTitleSubmit by EventDispatcher()
  private var scrolled = false

  /**
   * the screen's bottom toolbar follows the user's scrolling, as safari's does: it slides away
   * while the text moves toward its end and comes back when it moves toward its start or reaches
   * the top. javascript moves the toolbar.
   */
  private val onToolbarHiddenChange by EventDispatcher()
  private var toolbarHidden = false

  /** how far the text has moved in its current direction, in pixels: positive toward the end. */
  private var scrollTravel = 0

  /** true while a finger is on the editor. */
  private var touching = false

  var vaultId: String? = null
  var path: String? = null

  /** the height in dp of a bar over the bottom of the editor; the end of the text scrolls above it. */
  var bottomInset = 0f
    set(value) {
      if (field == value) return
      field = value
      updatePadding()
    }

  override val shouldUseAndroidLayout = true

  private val main = Handler(Looper.getMainLooper())
  private val container = FrameLayout(context)
  private val scroll = NoteScrollView(context)
  private val column = LinearLayout(context)
  private val title = NoteTitleField(context)
  private val editText = VaultEditText(context)
  private val completion = CompletionPanel(context)
  private val toolbar = EditorToolbar(context)
  private val styler: EditorStyler
  private var palette: EditorPalette

  private var document: DocumentSession? = null
  private var openedTarget: String? = null
  private var newline = "\n"
  private var hasPendingEdits = false
  private var lastStatus: String? = null
  private var editable = false
  private var titleEditable = false

  /**
   * renames that are moving this note's file. typed edits wait meanwhile, so none is saved to
   * the old path; the document that follows the file takes them (endRename).
   */
  private var pendingRenames = 0

  /** the text that the last rename saved before the file moved. */
  private var renamedText = ""

  /** true while the text is set by the editor itself, not typed. */
  private var applying = false

  /** "saved locally" is shown only after a save of this document completed (integrity gate). */
  private var savedSinceOpen = false

  /** a `[[note#heading]]` heading in this note to put the caret on once the note is open. */
  private var pendingHeading: String? = null

  /** the lines an edit touched, styled again after the edit. */
  private var dirtyStart = -1
  private var dirtyEnd = -1
  private var dirtyBlocks = false
  private var styleGeneration = 0

  private var completionQuery: WikiLinkQuery? = null
  private var completionInserts: List<String> = emptyList()

  /** the start of a link whose popup was dismissed; it stays closed for that link. */
  private var dismissedCompletionStart: Int? = null
  private var keyboardOverlap = 0
  private var keyboardShown = false

  /** the navigation bar's part of this view; the toolbar stays above it when no keyboard is shown. */
  private var navigationOverlap = 0
  private val flushTask = Runnable { flush() }

  private val layoutListener = ViewTreeObserver.OnGlobalLayoutListener { updateKeyboardOverlap() }

  private val watcher = object : TextWatcher {
    override fun beforeTextChanged(s: CharSequence, start: Int, count: Int, after: Int) {
      if (applying) return
      if (MarkdownStyles.touchesBlockSyntax(s, start, start + count)) dirtyBlocks = true
    }

    override fun onTextChanged(s: CharSequence, start: Int, before: Int, count: Int) {
      if (applying) return
      dirtyStart = if (dirtyStart < 0) start else min(dirtyStart, start)
      dirtyEnd = max(dirtyEnd, start + count)
    }

    override fun afterTextChanged(s: Editable) {
      if (applying) return
      val start = dirtyStart.coerceIn(0, s.length)
      val end = dirtyEnd.coerceIn(start, s.length)
      val blocks = dirtyBlocks || MarkdownStyles.touchesBlockSyntax(s, start, end)
      dirtyStart = -1
      dirtyEnd = -1
      dirtyBlocks = false
      if (blocks) {
        // a fence or front matter line can change every line after it.
        styleStep(MarkdownStyles.lineStart(s, start), ++styleGeneration)
      } else {
        styler.style(s, start, end)
      }
      noteEdited()
      updateCompletion()
    }
  }

  init {
    palette = palette(isNight())
    styler = EditorStyler(palette)
    styler.resolves = { target -> targets()?.resolve(target, path)?.let { true } ?: if (targets() == null) null else false }

    // the container takes focus when the text gives it up, so focus never jumps to another field.
    container.isFocusableInTouchMode = true
    container.descendantFocusability = ViewGroup.FOCUS_BEFORE_DESCENDANTS
    addView(container, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))

    scroll.isFillViewport = true
    scroll.clipToPadding = false
    scroll.isVerticalScrollBarEnabled = true
    container.addView(scroll, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

    editText.apply {
      background = null
      gravity = Gravity.TOP or Gravity.START
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
      imeOptions = EditorInfo.IME_FLAG_NO_FULLSCREEN
      isSingleLine = false
      setHorizontallyScrolling(false)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
      setLineSpacing(dp(3f), 1f)
      // the system's spell checker underlines; it never changes the text unless a suggestion is chosen.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
      }
      contentDescription = null
      filters = arrayOf(InputFilter { source, start, end, dest, dstart, dend -> filter(source, start, end, dest, dstart, dend) })
      addTextChangedListener(watcher)
      linkAt = { offset -> MarkdownStyles.wikiLinkAt(text, offset) != null }
      onFollowLink = { offset -> MarkdownStyles.wikiLinkAt(text, offset)?.let { follow(it) } }
      onSelectionChange = { updateCompletion() }
      onPopupKey = { keyCode -> popupKey(keyCode) }
      onRelease = { container.requestFocus() }
      setOnFocusChangeListener { _, focused ->
        if (!focused) hideCompletion()
        layoutBottom()
      }
    }
    title.apply {
      background = null
      gravity = Gravity.TOP or Gravity.START
      // one line of input that wraps on screen: return is an action, never a line break.
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
      setHorizontallyScrolling(false)
      maxLines = Int.MAX_VALUE
      imeOptions = EditorInfo.IME_ACTION_NEXT or EditorInfo.IME_FLAG_NO_FULLSCREEN
      // bold, at the size of a first-level heading: 1.6 times the text (EditorSpans.kt).
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f * 1.6f)
      setTypeface(typeface, Typeface.BOLD)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
      }
      // a pasted name stays on one line: its line breaks become spaces.
      filters = arrayOf(
        InputFilter { source, start, end, _, _, _ ->
          val inserted = source.subSequence(start, end)
          if (inserted.any { it == '\n' || it == '\r' }) inserted.toString().replace("\r\n", " ").replace('\n', ' ').replace('\r', ' ') else null
        },
      )
      setOnEditorActionListener { _, _, _ ->
        beginEditingText()
        true
      }
      setOnFocusChangeListener { _, focused -> if (!focused) titleEdited() }
      onRelease = { container.requestFocus() }
    }
    setTitleEditable(false)
    // the text takes the rest of the screen below the name, so a tap under a short note edits it.
    column.orientation = LinearLayout.VERTICAL
    column.addView(title, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    column.addView(editText, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    scroll.addView(column, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
    scroll.setOnScrollChangeListener { _, _, scrollY, _, oldScrollY ->
      if (completion.visibility == View.VISIBLE) positionCompletion()
      if ((scrollY > 0) != scrolled) {
        scrolled = scrollY > 0
        onScrolledChange(mapOf("scrolled" to scrolled))
      }
      followScroll(scrollY, oldScrollY)
    }

    completion.onSelect = { index -> acceptCompletion(index) }
    container.addView(completion, FrameLayout.LayoutParams(dp(CompletionPanel.WIDTH_DP).toInt(), FrameLayout.LayoutParams.WRAP_CONTENT))
    toolbar.onAction = { action -> runToolbar(action) }
    toolbar.visibility = View.GONE
    container.addView(toolbar, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
    applyPalette()
    setEditable(false)
  }

  // MARK: - lifecycle

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    VaultRuntime.editors.add(this)
    viewTreeObserver.addOnGlobalLayoutListener(layoutListener)
  }

  /** saves edits made in the last moments before the view leaves the screen. */
  override fun onDetachedFromWindow() {
    flush()
    viewTreeObserver.removeOnGlobalLayoutListener(layoutListener)
    VaultRuntime.editors.remove(this)
    super.onDetachedFromWindow()
  }

  /** the view is gone for good: write what is pending, then let the document's thread end. */
  fun destroy() {
    // edits that wait for a rename go to the document now, which keeps them as a draft if its
    // file has moved; the view no longer follows the file.
    pendingRenames = 0
    flush()
    document?.close()
    document = null
    openedTarget = null
  }

  fun enteredBackground() {
    flush()
  }

  fun enteredForeground() {
    reconcile()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    updatePadding()
  }

  private fun updatePadding() {
    // keep long lines readable on a tablet: at most about 70 characters wide.
    val side = max(dp(16f), (width - dp(720f)) / 2f).toInt()
    title.setPadding(side, dp(16f).toInt(), side, dp(4f).toInt())
    editText.setPadding(side, dp(8f).toInt(), side, dp(32f + bottomInset).toInt())
  }

  override fun onConfigurationChanged(newConfig: Configuration?) {
    super.onConfigurationChanged(newConfig)
    val next = palette(isNight())
    if (next != palette) {
      palette = next
      styler.palette = next
      applyPalette()
      restyleAll()
    }
  }

  // MARK: - opening

  fun openIfNeeded() {
    val vaultId = vaultId ?: return
    val path = path ?: return
    val target = "$vaultId\u0000$path"
    if (target == openedTarget) return
    // another note replaces this one while a rename runs: waiting edits go to the document now,
    // which keeps them as a draft if its file has moved.
    pendingRenames = 0
    flush()
    document?.close()
    openedTarget = target
    hideCompletion()
    pendingHeading = VaultRuntime.takePendingHeading(vaultId, path)
    savedSinceOpen = false
    document = null
    setEditable(false)
    setText("")
    setToolbarHidden(false)
    title.setText(name(path))
    setTitleEditable(false)
    emit(mapOf("status" to "loading"))

    val document = documentSession(vaultId, path, target) ?: run {
      onLoad(mapOf("kind" to "unavailable", "reason" to "The vault is not open."))
      return
    }
    loader.execute {
      val outcome = load(document)
      main.post {
        // a later navigation replaced this request; its result must not take over the editor.
        if (openedTarget != target) {
          document.close()
          return@post
        }
        apply(outcome, document)
      }
    }
  }

  /** a session for the note at [path] whose status reaches the view while it shows [target]. */
  private fun documentSession(vaultId: String, path: String, target: String): DocumentSession? {
    val session = VaultRuntime.session(vaultId) ?: return null
    val journal = VaultRuntime.journal ?: return null
    return DocumentSession(vaultId, path, session, journal) { status ->
      main.post {
        if (openedTarget != target) return@post
        if (status == DocumentStatus.Saving) savedSinceOpen = true
        emit(payload(status, savedSinceOpen))
      }
    }
  }

  private fun load(document: DocumentSession): LoadOutcome = try {
    document.load()
  } catch (error: Exception) {
    LoadOutcome.Unavailable(FileState.Unknown(error.message ?: "the note could not be read"))
  }

  private fun apply(outcome: LoadOutcome, document: DocumentSession) {
    when (outcome) {
      is LoadOutcome.Loaded -> {
        this.document = document
        newline = outcome.document.newline
        setText(outcome.document.text)
        setEditable(true)
        setTitleEditable(true)
        if (!showPendingHeading()) showStartOfNote()
        onLoad(mapOf("kind" to "loaded", "restoredDraft" to outcome.document.restoredDraft))
        if (outcome.document.restoredDraft) document.persist()
      }
      is LoadOutcome.ReadOnly -> {
        document.close()
        setText(outcome.preview)
        // a read-only note can still be renamed.
        setTitleEditable(true)
        showStartOfNote()
        onLoad(mapOf("kind" to "read-only", "encoding" to outcome.encoding))
      }
      is LoadOutcome.Unavailable -> {
        document.close()
        onLoad(mapOf("kind" to "unavailable", "reason" to outcome.state.toString()))
      }
      is LoadOutcome.RecoveryNeeded -> {
        document.close()
        onLoad(mapOf("kind" to "recovery-needed", "draftSequence" to outcome.draft.sequence, "diskChanged" to (outcome.disk != null)))
      }
    }
  }

  /** a note opens at its top, without the keyboard. the caret waits after the front matter. */
  private fun showStartOfNote() {
    val text = editText.text
    editText.setSelection(MarkdownStyles.frontMatterEnd(text).coerceIn(0, text.length))
    scroll.scrollTo(0, 0)
    post { scroll.scrollTo(0, 0) }
  }

  /** puts the caret on the pending heading; `[[note#a#b]]` names heading "b" under "a". */
  private fun showPendingHeading(): Boolean {
    val heading = pendingHeading ?: return false
    val wanted = heading.split('#').last().trim()
    val found = MarkdownStyles.headings(editText.text).firstOrNull { it.second.trim().equals(wanted, ignoreCase = true) } ?: return false
    pendingHeading = null
    editText.setSelection(found.first)
    post {
      val layout = editText.layout ?: return@post
      scroll.scrollTo(0, editText.top + layout.getLineTop(layout.getLineForOffset(found.first)))
    }
    return true
  }

  // MARK: - editing

  /**
   * new line breaks follow the file's convention; untouched text is never rewritten. return
   * chooses the highlighted link suggestion instead of starting a new line. a read-only note
   * keeps its text.
   */
  private fun filter(source: CharSequence, start: Int, end: Int, dest: Spanned, dstart: Int, dend: Int): CharSequence? {
    if (applying) return null
    if (!editable) return dest.subSequence(dstart, dend)
    val inserted = source.subSequence(start, end)
    if (completion.visibility == View.VISIBLE && inserted.toString() == "\n" && dstart == dend) {
      main.post { acceptCompletion(completion.highlighted) }
      return ""
    }
    if (newline == "\n" || !inserted.contains('\n')) return null
    return inserted.toString().replace("\r\n", "\n").replace("\n", newline)
  }

  private fun noteEdited() {
    if (document == null) return
    hasPendingEdits = true
    emit(mapOf("status" to "unsaved"))
    main.removeCallbacks(flushTask)
    main.postDelayed(flushTask, SETTLE_DELAY_MS)
  }

  /**
   * hands the current text to the document, which journals and then saves it. also retries a
   * save that failed earlier; persisting does nothing when everything is saved. while a rename
   * moves the file, edits wait for it (endRename).
   */
  fun flush() {
    main.removeCallbacks(flushTask)
    if (pendingRenames > 0) return
    val document = document ?: return
    if (hasPendingEdits) {
      hasPendingEdits = false
      document.update(editText.text.toString())
    }
    document.persist()
  }

  /**
   * writes pending edits and returns the open document, so a rename can wait for its save.
   * edits typed after this wait until [endRename].
   */
  fun beginRename(): DocumentSession? {
    flush()
    pendingRenames += 1
    renamedText = editText.text.toString()
    return document
  }

  /**
   * a rename of [oldPath] ended. when the file moved to [newPath] and this view still shows it,
   * the view follows the file: a new document session takes over, and the text, caret, undo,
   * and keyboard stay. otherwise waiting edits go to the same document.
   */
  fun endRename(oldPath: String, newPath: String?) {
    pendingRenames = max(0, pendingRenames - 1)
    val vaultId = vaultId
    if (newPath != null && vaultId != null && path == oldPath && openedTarget != null) {
      follow(vaultId, newPath)
    } else if (pendingRenames == 0 && hasPendingEdits) {
      main.removeCallbacks(flushTask)
      main.postDelayed(flushTask, SETTLE_DELAY_MS)
    }
  }

  private fun follow(vaultId: String, newPath: String) {
    val previous = document
    val target = "$vaultId\u0000$newPath"
    path = newPath
    openedTarget = target
    if (!title.isFocused) title.setText(name(newPath))
    val next = documentSession(vaultId, newPath, target) ?: run {
      previous?.close()
      document = null
      setEditable(false)
      setTitleEditable(false)
      onLoad(mapOf("kind" to "unavailable", "reason" to "The vault is not open."))
      return
    }
    // edits keep waiting until the document at the new path has read its file.
    pendingRenames += 1
    val expected = renamedText
    loader.execute {
      val outcome = load(next)
      main.post {
        if (openedTarget != target) {
          next.close()
          return@post
        }
        pendingRenames = max(0, pendingRenames - 1)
        if (outcome is LoadOutcome.Loaded && !outcome.document.restoredDraft && previous != null && outcome.document.text == expected) {
          previous.close()
          document = next
          newline = outcome.document.newline
          if (pendingRenames == 0 && hasPendingEdits) flush()
          return@post
        }
        // the file changed meanwhile, a draft waits for the new path, or the note is read-only:
        // it opens as any note does. edits typed during the rename go to the old document, which
        // keeps them as a draft for the old path.
        if (hasPendingEdits && previous != null) {
          hasPendingEdits = false
          previous.update(editText.text.toString())
          previous.persist()
        }
        previous?.close()
        document = null
        setEditable(false)
        setTitleEditable(false)
        apply(outcome, next)
      }
    }
  }

  fun focusEditor() {
    if (!editable) return
    editText.requestFocus()
    context.getSystemService(InputMethodManager::class.java)?.showSoftInput(editText, 0)
  }

  /** puts the caret in the name above the text, with the whole name selected. */
  fun focusTitle() {
    if (!titleEditable) return
    scroll.scrollTo(0, 0)
    title.requestFocus()
    title.selectAll()
    context.getSystemService(InputMethodManager::class.java)?.showSoftInput(title, 0)
  }

  /** shows the open note's name again, for example after a rename was refused. */
  fun resetTitle() {
    val path = path ?: return
    if (!title.isFocused) title.setText(name(path))
  }

  /** return in the name: the caret moves to the start of the text, after any front matter. */
  private fun beginEditingText() {
    if (!editable) {
      title.release()
      return
    }
    editText.setSelection(MarkdownStyles.frontMatterEnd(editText.text).coerceIn(0, editText.text.length))
    focusEditor()
  }

  /**
   * the name lost focus. a changed name goes to javascript, which renames the note. the check
   * waits a moment, so a view that is leaving the screen, and loses focus on the way, sends nothing.
   */
  private fun titleEdited() {
    main.post {
      val path = path ?: return@post
      val typed = title.text.toString()
      if (!isAttachedToWindow || typed == name(path)) return@post
      onTitleSubmit(mapOf("title" to typed))
    }
  }

  private fun setTitleEditable(on: Boolean) {
    titleEditable = on
    title.isFocusable = on
    title.isFocusableInTouchMode = on
  }

  private fun reconcile() {
    val document = document ?: return
    if (hasPendingEdits) {
      // local edits win the race to the journal; a changed file then becomes a conflict.
      flush()
      return
    }
    val target = openedTarget
    document.reconcile { text ->
      if (text == null) return@reconcile
      main.post {
        if (openedTarget != target || hasPendingEdits) return@post
        val selectionStart = editText.selectionStart
        val selectionEnd = editText.selectionEnd
        setText(text)
        editText.setSelection(selectionStart.coerceIn(0, text.length), selectionEnd.coerceIn(0, text.length))
        newline = DocumentSession.newline(text)
      }
    }
  }

  private fun setText(text: String) {
    applying = true
    editText.setText(text)
    applying = false
    restyleAll()
  }

  private fun setEditable(on: Boolean) {
    editable = on
    editText.showSoftInputOnFocus = on
    editText.isCursorVisible = on
    layoutBottom()
  }

  /**
   * styles the first lines at once and the rest in short steps, so a long note opens without
   * waiting for all of its styling.
   */
  private fun restyleAll() {
    val generation = ++styleGeneration
    styleStep(0, generation)
  }

  private fun styleStep(from: Int, generation: Int) {
    if (generation != styleGeneration) return
    val text = editText.text
    if (from >= text.length) return
    val to = MarkdownStyles.lineEnd(text, min(text.length, from + STYLE_STEP))
    styler.style(text, from, to)
    if (to < text.length) post { styleStep(to + 1, generation) }
  }

  // MARK: - toolbar

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> touching = true
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> touching = false
    }
    return super.dispatchTouchEvent(event)
  }

  /**
   * hides the toolbar once the text has moved 24 dp toward its end, and shows it once the text
   * has moved that far back, or at the top. while the keyboard is up, the text follows the caret
   * by itself, so only scrolls under a finger count then.
   */
  private fun followScroll(scrollY: Int, oldScrollY: Int) {
    if (scrollY <= 0) {
      scrollTravel = 0
      setToolbarHidden(false)
      return
    }
    val delta = scrollY - oldScrollY
    if (delta == 0 || (editText.isFocused && !touching)) return
    if ((delta > 0) != (scrollTravel > 0)) scrollTravel = 0
    scrollTravel += delta
    val travel = dp(24f)
    if (scrollTravel >= travel) {
      setToolbarHidden(true)
    } else if (scrollTravel <= -travel) {
      setToolbarHidden(false)
    }
  }

  private fun setToolbarHidden(hidden: Boolean) {
    if (hidden == toolbarHidden) return
    toolbarHidden = hidden
    onToolbarHiddenChange(mapOf("hidden" to hidden))
  }

  // MARK: - keyboard

  /** the part of this view the keyboard covers, kept clear so the caret stays visible. */
  private fun updateKeyboardOverlap() {
    val insets = ViewCompat.getRootWindowInsets(this) ?: return
    val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
    // the back button closes the keyboard but leaves the text focused; giving up focus then
    // makes the note behave as it does after opening, where a tap on a link opens it.
    val shown = insets.isVisible(WindowInsetsCompat.Type.ime())
    if (keyboardShown && !shown && (editText.isFocused || title.isFocused)) container.requestFocus()
    keyboardShown = shown
    val location = IntArray(2)
    getLocationInWindow(location)
    val overlap = if (keyboard > 0) max(0, location[1] + height - (rootView.height - keyboard)) else 0
    val navigation = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
    val navigationPart = if (navigation > 0) max(0, location[1] + height - (rootView.height - navigation)) else 0
    if (overlap == keyboardOverlap && navigationPart == navigationOverlap) return
    keyboardOverlap = overlap
    navigationOverlap = navigationPart
    layoutBottom()
  }

  /**
   * keeps the text clear of the keyboard and, while the text has focus, of the toolbar that sits
   * on the keyboard (or on the navigation bar, with a hardware keyboard).
   */
  private fun layoutBottom() {
    val showing = editable && editText.isFocused
    val toolbarBottom = if (keyboardOverlap > 0) keyboardOverlap else navigationOverlap
    val reserved = if (showing) toolbarBottom + dp(EditorToolbar.HEIGHT_DP.toFloat()).toInt() else keyboardOverlap
    toolbar.visibility = if (showing) View.VISIBLE else View.GONE
    val toolbarParams = toolbar.layoutParams as FrameLayout.LayoutParams
    if (toolbarParams.bottomMargin != toolbarBottom) {
      toolbarParams.bottomMargin = toolbarBottom
      toolbar.requestLayout()
    }
    val scrollParams = scroll.layoutParams as FrameLayout.LayoutParams
    if (scrollParams.bottomMargin == reserved) return
    scrollParams.bottomMargin = reserved
    scroll.requestLayout()
    if (editText.isFocused) {
      post { editText.bringPointIntoView(editText.selectionEnd) }
    }
  }

  /** the part at the bottom that the keyboard and the toolbar cover. */
  private fun reservedBottom(): Int = (scroll.layoutParams as FrameLayout.LayoutParams).bottomMargin

  // MARK: - toolbar

  /**
   * runs a toolbar button. undo and redo are the text field's own, as with ctrl+z; the other
   * edits replace text like a paste, so the field records each one as one undo step, and the
   * text watcher saves it and updates the link suggestions.
   */
  private fun runToolbar(action: ToolbarAction) {
    if (action == ToolbarAction.HIDE_KEYBOARD) {
      context.getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(editText.windowToken, 0)
      editText.release()
      return
    }
    if (!editable || document == null || !editText.isFocused) return
    val text = editText.text
    val start = min(editText.selectionStart, editText.selectionEnd).coerceIn(0, text.length)
    val end = max(editText.selectionStart, editText.selectionEnd).coerceIn(start, text.length)
    when (action) {
      ToolbarAction.UNDO -> editText.onTextContextMenuItem(android.R.id.undo)
      ToolbarAction.REDO -> editText.onTextContextMenuItem(android.R.id.redo)
      ToolbarAction.OUTDENT -> applyEdit(EditorCommands.outdent(text, start, end))
      ToolbarAction.INDENT -> applyEdit(EditorCommands.indent(text, start, end))
      ToolbarAction.TASK -> applyEdit(EditorCommands.toggleTask(text, start, end))
      ToolbarAction.LINK -> applyEdit(EditorCommands.insertLink(text, start, end))
      ToolbarAction.TAG -> applyEdit(EditorCommands.insertTag(text, start, end))
      ToolbarAction.BOLD -> applyEdit(EditorCommands.toggleEmphasis(text, start, end, strong = true))
      ToolbarAction.ITALIC -> applyEdit(EditorCommands.toggleEmphasis(text, start, end, strong = false))
      ToolbarAction.HIDE_KEYBOARD -> Unit
    }
  }

  private fun applyEdit(edit: TextEdit?) {
    edit ?: return
    val text = editText.text
    if (edit.end > text.length) return
    text.replace(edit.start, edit.end, edit.text)
    editText.setSelection(edit.selectionStart.coerceIn(0, text.length), edit.selectionEnd.coerceIn(0, text.length))
  }

  // MARK: - link completion

  /** shows, updates, or hides the `[[` popup for the caret; ranked natively on every edit. */
  private fun updateCompletion() {
    val text = editText.text
    val caret = editText.selectionStart
    val query = if (editText.isFocused && editable && document != null && caret == editText.selectionEnd) WikiLinkCompletion.query(text, caret) else null
    if (query == null) {
      dismissedCompletionStart = null
      hideCompletion()
      return
    }
    if (query.start == dismissedCompletionStart) {
      hideCompletion()
      return
    }
    val items = ArrayList<CompletionPanel.Item>()
    val inserts = ArrayList<String>()
    if (query.isHeading) {
      // `[[#`: headings of this note, best match first, in document order for ties.
      val wanted = query.text.drop(1)
      MarkdownStyles.headings(text).withIndex()
        .mapNotNull { (index, heading) -> WikiLinkTargets.score(wanted, heading.second)?.let { Triple(index, heading.second, it) } }
        .filter { it.second.isNotEmpty() }
        .sortedWith(compareByDescending<Triple<Int, String, Int>> { it.third }.thenBy { it.first })
        .take(MAX_SUGGESTIONS)
        .forEach {
          items.add(CompletionPanel.Item(it.second, null, isHeading = true))
          inserts.add("#" + it.second)
        }
    } else {
      targets()?.suggestions(query.text, path, MAX_SUGGESTIONS)?.forEach {
        items.add(CompletionPanel.Item(it.name, it.folder.ifEmpty { null }, isHeading = false))
        inserts.add(it.linkText)
      }
    }
    // nothing to offer when the only suggestion is what is already typed.
    val typedAlready = inserts.size == 1 && inserts[0].equals(query.text, ignoreCase = true)
    if (items.isEmpty() || typedAlready) {
      hideCompletion()
      return
    }
    val appearing = completion.visibility != View.VISIBLE
    completionQuery = query
    completionInserts = inserts
    completion.show(items)
    completion.visibility = View.VISIBLE
    positionCompletion()
    if (appearing) {
      @Suppress("DEPRECATION")
      announceForAccessibility("${items.size} link suggestions")
    }
  }

  /** below the caret's line, or above it when the keyboard leaves more room there. */
  private fun positionCompletion() {
    val layout = editText.layout
    if (layout == null || completion.visibility != View.VISIBLE) return
    val caret = editText.selectionEnd.coerceIn(0, editText.text.length)
    val line = layout.getLineForOffset(caret)
    val x = editText.totalPaddingLeft + layout.getPrimaryHorizontal(caret) - scroll.scrollX
    val lineTop = editText.top + editText.totalPaddingTop + layout.getLineTop(line) - scroll.scrollY
    val lineBottom = editText.top + editText.totalPaddingTop + layout.getLineBottom(line) - scroll.scrollY
    val visibleBottom = container.height - reservedBottom()
    val gap = dp(6f)
    val panelHeight = dp(CompletionPanel.ROW_HEIGHT_DP) * completion.items.size + dp(8f)
    val width = min(dp(CompletionPanel.WIDTH_DP), container.width - dp(16f))
    val below = lineBottom + gap
    val y = when {
      below + panelHeight <= visibleBottom -> below
      lineTop - gap - panelHeight >= 0 -> lineTop - gap - panelHeight
      else -> {
        hideCompletion()
        return
      }
    }
    if (lineBottom < 0 || lineTop > visibleBottom) {
      hideCompletion()
      return
    }
    completion.translationX = (x - dp(16f)).coerceIn(dp(8f), container.width - width - dp(8f))
    completion.translationY = y
    if (completion.layoutParams.width != width.toInt()) {
      completion.layoutParams = completion.layoutParams.apply { this.width = width.toInt() }
    }
  }

  private fun hideCompletion() {
    completion.visibility = View.GONE
    completion.show(emptyList())
    completionQuery = null
    completionInserts = emptyList()
  }

  /** replaces the typed target with the chosen link and puts the caret after it. */
  private fun acceptCompletion(index: Int) {
    val query = completionQuery ?: return
    val insert = completionInserts.getOrNull(index) ?: return
    val edit = query.edit(insert)
    // the finished link stays without a popup until the caret leaves it.
    dismissedCompletionStart = query.start
    hideCompletion()
    val text = editText.text
    if (edit.start + edit.length > text.length) return
    text.replace(edit.start, edit.start + edit.length, edit.text)
    editText.setSelection(min(edit.caret, text.length))
  }

  /** with the popup open, arrows move the highlight, tab or enter chooses, and escape closes. */
  private fun popupKey(keyCode: Int): Boolean {
    if (completion.visibility != View.VISIBLE) return false
    when (keyCode) {
      KeyEvent.KEYCODE_DPAD_UP -> completion.moveHighlight(-1)
      KeyEvent.KEYCODE_DPAD_DOWN -> completion.moveHighlight(1)
      KeyEvent.KEYCODE_TAB, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> acceptCompletion(completion.highlighted)
      KeyEvent.KEYCODE_ESCAPE -> {
        dismissedCompletionStart = completionQuery?.start
        hideCompletion()
      }
      else -> return false
    }
    return true
  }

  // MARK: - wikilinks

  private fun targets(): WikiLinkTargets? = vaultId?.let { VaultRuntime.linkTargets(it) }

  fun linkTargetsChanged(changedVaultId: String) {
    if (changedVaultId != vaultId) return
    styler.recolorLinks(editText.text)
    if (completion.visibility == View.VISIBLE) updateCompletion()
  }

  /**
   * a link to this note only moves to its heading. any other link goes to javascript, which
   * opens the note, or creates it when no note matches.
   */
  private fun follow(reference: WikiLinkReference) {
    val resolved = if (reference.target.isEmpty()) path else targets()?.resolve(reference.target, path)
    if (resolved != null && resolved == path) {
      reference.heading?.let {
        pendingHeading = it
        showPendingHeading()
      }
      return
    }
    val vaultId = vaultId
    if (resolved != null && vaultId != null) {
      // the note opens in a new editor view, which takes the heading.
      VaultRuntime.setPendingHeading(reference.heading, vaultId, resolved)
    }
    val payload = HashMap<String, Any>()
    payload["target"] = reference.target
    resolved?.let { payload["path"] = it }
    onOpenLink(payload)
  }

  // MARK: - status

  private fun emit(payload: Map<String, Any>) {
    val status = payload["status"] as? String
    editText.statusId = status?.let { "note-status:$it" }
    if (status == "unsaved" && lastStatus == "unsaved") return
    lastStatus = status
    onStatus(payload)
  }

  private fun payload(status: DocumentStatus, savedSinceOpen: Boolean): Map<String, Any> = when (status) {
    DocumentStatus.Loading -> mapOf("status" to "loading")
    is DocumentStatus.ReadOnly -> mapOf("status" to "read-only", "detail" to status.encoding)
    DocumentStatus.Clean -> mapOf("status" to if (savedSinceOpen) "saved" else "opened")
    DocumentStatus.Dirty -> mapOf("status" to "unsaved")
    DocumentStatus.Journaled -> mapOf("status" to "unsaved", "detail" to "journaled")
    DocumentStatus.Saving -> mapOf("status" to "saving")
    is DocumentStatus.Recoverable -> mapOf("status" to "error", "detail" to status.reason)
    is DocumentStatus.Conflict -> mapOf("status" to "conflict")
    DocumentStatus.Missing -> mapOf("status" to "missing")
    is DocumentStatus.CheckpointFailed -> mapOf("status" to "checkpoint-failed", "detail" to status.reason)
    is DocumentStatus.Unavailable -> mapOf("status" to "unavailable", "detail" to status.state.toString())
  }

  // MARK: - appearance

  private fun isNight(): Boolean =
    (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

  /** obsidian's default light and dark text colors, with its purple accent. */
  private fun palette(night: Boolean): EditorPalette = if (night) {
    EditorPalette(text = 0xFFDADADA.toInt(), secondary = 0xFF8A8A8A.toInt(), accent = 0xFFA594FF.toInt(), unresolved = 0x99A594FF.toInt(), code = 0xFFE68AB0.toInt())
  } else {
    EditorPalette(text = 0xFF222222.toInt(), secondary = 0xFF8A8A8A.toInt(), accent = 0xFF7F6DF2.toInt(), unresolved = 0x997F6DF2.toInt(), code = 0xFFC0306A.toInt())
  }

  private fun applyPalette() {
    editText.setTextColor(palette.text)
    editText.highlightColor = (palette.accent and 0x00FFFFFF) or 0x55000000
    title.setTextColor(palette.text)
    title.highlightColor = editText.highlightColor
    completion.setColors(palette, if (isNight()) 0xFF2A2A2A.toInt() else Color.WHITE)
    // the shell's surface and border colors (src/constants/theme.ts), as the scrolled app bar.
    if (isNight()) {
      toolbar.setColors(palette.text, 0xFF262626.toInt(), 0xFF363636.toInt())
    } else {
      toolbar.setColors(palette.text, 0xFFF6F6F6.toInt(), 0xFFE3E3E3.toInt())
    }
  }

  private fun dp(value: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, resources.displayMetrics)

  private companion object {
    const val SETTLE_DELAY_MS = 200L

    /** the note's name: its file name without the folder or ".md". */
    fun name(path: String): String {
      val file = path.substringAfterLast('/')
      return if (file.endsWith(".md", ignoreCase = true)) file.dropLast(3) else file
    }
    const val MAX_SUGGESTIONS = 6

    /** about this many characters are styled per step after a note opens. */
    const val STYLE_STEP = 40_000

    /** notes load off the main thread; one at a time, in order. */
    val loader = Executors.newSingleThreadExecutor { Thread(it, "vault.editor-load").apply { isDaemon = true } }
  }
}
