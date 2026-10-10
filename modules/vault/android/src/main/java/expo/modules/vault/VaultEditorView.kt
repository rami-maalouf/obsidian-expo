package expo.modules.vault

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
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
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout
import android.widget.ScrollView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.vault.core.DocumentSession
import expo.modules.vault.core.DocumentStatus
import expo.modules.vault.core.LoadOutcome
import expo.modules.vault.core.MarkdownStyles
import expo.modules.vault.core.WikiLinkCompletion
import expo.modules.vault.core.WikiLinkQuery
import expo.modules.vault.core.WikiLinkReference
import expo.modules.vault.core.WikiLinkTargets
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

/**
 * native markdown source editor for android (ktd3). native code owns the text, selection,
 * composition, and undo; javascript receives status events, never the full text on each
 * keystroke. the document session, drafts, saves, and newline rules are the same as on ios
 * (VaultEditorView.swift). the source is shown with restrained styling: spans only, never
 * changed characters. live preview, which hides markers on ios, is not part of the android
 * editor yet.
 */
class VaultEditorView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onStatus by EventDispatcher()
  private val onLoad by EventDispatcher()

  /** a tap on a wikilink to another note: `target` as written, and `path` when a note matches. */
  private val onOpenLink by EventDispatcher()

  /** the text left its top or returned to it; the app bar takes a surface color while scrolled. */
  private val onScrolledChange by EventDispatcher()
  private var scrolled = false

  var vaultId: String? = null
  var path: String? = null

  override val shouldUseAndroidLayout = true

  private val main = Handler(Looper.getMainLooper())
  private val container = FrameLayout(context)
  private val scroll = ScrollView(context)
  private val editText = VaultEditText(context)
  private val completion = CompletionPanel(context)
  private val styler: EditorStyler
  private var palette: EditorPalette

  private var document: DocumentSession? = null
  private var openedTarget: String? = null
  private var newline = "\n"
  private var hasPendingEdits = false
  private var lastStatus: String? = null
  private var editable = false

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
      setOnFocusChangeListener { _, focused -> if (!focused) hideCompletion() }
    }
    scroll.addView(editText, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
    scroll.setOnScrollChangeListener { _, _, scrollY, _, _ ->
      if (completion.visibility == View.VISIBLE) positionCompletion()
      if ((scrollY > 0) != scrolled) {
        scrolled = scrollY > 0
        onScrolledChange(mapOf("scrolled" to scrolled))
      }
    }

    completion.onSelect = { index -> acceptCompletion(index) }
    container.addView(completion, FrameLayout.LayoutParams(dp(CompletionPanel.WIDTH_DP).toInt(), FrameLayout.LayoutParams.WRAP_CONTENT))
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
    // keep long lines readable on a tablet: at most about 70 characters wide.
    val side = max(dp(16f), (w - dp(720f)) / 2f).toInt()
    editText.setPadding(side, dp(16f).toInt(), side, dp(32f).toInt())
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
    flush()
    document?.close()
    openedTarget = target
    hideCompletion()
    pendingHeading = VaultRuntime.takePendingHeading(vaultId, path)
    savedSinceOpen = false
    document = null
    setEditable(false)
    setText("")
    emit(mapOf("status" to "loading"))

    val session = VaultRuntime.session(vaultId)
    val journal = VaultRuntime.journal
    if (session == null || journal == null) {
      onLoad(mapOf("kind" to "unavailable", "reason" to "The vault is not open."))
      return
    }
    val document = DocumentSession(vaultId, path, session, journal) { status ->
      main.post {
        if (openedTarget != target) return@post
        if (status == DocumentStatus.Saving) savedSinceOpen = true
        emit(payload(status, savedSinceOpen))
      }
    }
    loader.execute {
      val outcome = try {
        document.load()
      } catch (error: Exception) {
        LoadOutcome.Unavailable(expo.modules.vault.core.FileState.Unknown(error.message ?: "the note could not be read"))
      }
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

  private fun apply(outcome: LoadOutcome, document: DocumentSession) {
    when (outcome) {
      is LoadOutcome.Loaded -> {
        this.document = document
        newline = outcome.document.newline
        setText(outcome.document.text)
        setEditable(true)
        if (!showPendingHeading()) showStartOfNote()
        onLoad(mapOf("kind" to "loaded", "restoredDraft" to outcome.document.restoredDraft))
        if (outcome.document.restoredDraft) document.persist()
      }
      is LoadOutcome.ReadOnly -> {
        document.close()
        setText(outcome.preview)
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
      scroll.scrollTo(0, layout.getLineTop(layout.getLineForOffset(found.first)))
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
   * save that failed earlier; persisting does nothing when everything is saved.
   */
  fun flush() {
    main.removeCallbacks(flushTask)
    val document = document ?: return
    if (hasPendingEdits) {
      hasPendingEdits = false
      document.update(editText.text.toString())
    }
    document.persist()
  }

  /** writes pending edits and returns the open document, so a rename can wait for its save. */
  fun flushForRename(): DocumentSession? {
    flush()
    return document
  }

  fun focusEditor() {
    if (!editable) return
    editText.requestFocus()
    context.getSystemService(InputMethodManager::class.java)?.showSoftInput(editText, 0)
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

  // MARK: - keyboard

  /** the part of this view the keyboard covers, kept clear so the caret stays visible. */
  private fun updateKeyboardOverlap() {
    val insets = ViewCompat.getRootWindowInsets(this) ?: return
    val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
    // the back button closes the keyboard but leaves the text focused; giving up focus then
    // makes the note behave as it does after opening, where a tap on a link opens it.
    val shown = insets.isVisible(WindowInsetsCompat.Type.ime())
    if (keyboardShown && !shown && editText.isFocused) container.requestFocus()
    keyboardShown = shown
    val location = IntArray(2)
    getLocationInWindow(location)
    val overlap = if (keyboard > 0) max(0, location[1] + height - (rootView.height - keyboard)) else 0
    if (overlap == keyboardOverlap) return
    keyboardOverlap = overlap
    (scroll.layoutParams as FrameLayout.LayoutParams).bottomMargin = overlap
    scroll.requestLayout()
    if (editText.isFocused) {
      post { editText.bringPointIntoView(editText.selectionEnd) }
    }
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
    val visibleBottom = container.height - keyboardOverlap
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
    completion.setColors(palette, if (isNight()) 0xFF2A2A2A.toInt() else Color.WHITE)
  }

  private fun dp(value: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, resources.displayMetrics)

  private companion object {
    const val SETTLE_DELAY_MS = 200L
    const val MAX_SUGGESTIONS = 6

    /** about this many characters are styled per step after a note opens. */
    const val STYLE_STEP = 40_000

    /** notes load off the main thread; one at a time, in order. */
    val loader = Executors.newSingleThreadExecutor { Thread(it, "vault.editor-load").apply { isDaemon = true } }
  }
}
