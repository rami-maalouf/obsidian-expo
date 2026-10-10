package expo.modules.vault.core

import java.util.concurrent.Callable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** what the editor shows about its text (persistence protocol, r3). */
sealed class DocumentStatus {
  data object Loading : DocumentStatus()

  /** the file is not editable utf-8; it is shown read-only and never saved. */
  data class ReadOnly(val encoding: String) : DocumentStatus()

  /** the file and the editor match: "saved locally". */
  data object Clean : DocumentStatus()

  /** edits not yet in the journal. */
  data object Dirty : DocumentStatus()

  /** edits durable in the journal, not yet in the file. */
  data object Journaled : DocumentStatus()

  data object Saving : DocumentStatus()

  /** the last save could not finish; the draft is kept and a retry is possible. */
  data class Recoverable(val reason: String) : DocumentStatus()

  /** another writer changed the file; both versions are kept until the user resolves it. */
  data class Conflict(val disk: FileRevision?) : DocumentStatus()

  /** the file was deleted or renamed; it is never recreated silently. */
  data object Missing : DocumentStatus()

  /** the journal could not record the edits; navigation must not claim they are safe. */
  data class CheckpointFailed(val reason: String) : DocumentStatus()

  data class Unavailable(val state: FileState) : DocumentStatus()
}

/** the text and newline facts the editor needs when a document opens. */
data class LoadedDocument(
  val text: String,
  val bom: Boolean,
  /** the separator for newly typed line breaks, matching the file's first line break. */
  val newline: String,
  /** null for a restored draft of a note that does not exist on disk yet. */
  val revision: FileRevision?,
  /** true when a journaled draft was restored instead of the file's text. */
  val restoredDraft: Boolean,
)

sealed class LoadOutcome {
  data class Loaded(val document: LoadedDocument) : LoadOutcome()

  data class ReadOnly(val preview: String, val encoding: String) : LoadOutcome()

  data class Unavailable(val state: FileState) : LoadOutcome()

  /** a journaled draft exists but the file changed or disappeared since; the user decides. */
  data class RecoveryNeeded(val draft: DraftRecord, val disk: FileRevision?) : LoadOutcome()
}

/**
 * owns one open note: the base revision, edit sequence numbers, checkpoints, and saves. every
 * method except [load] returns immediately and runs on a private thread, so the main thread
 * never waits for file i/o. [onStatus] is called on that thread.
 */
class DocumentSession(
  val vaultId: String,
  val path: String,
  private val session: VaultSession,
  private val journal: DraftJournal,
  private val clock: () -> Long = System::currentTimeMillis,
  private val onStatus: (DocumentStatus) -> Unit,
) {
  private val executor: ExecutorService = Executors.newSingleThreadExecutor { task ->
    Thread(task, "vault.document").apply { isDaemon = true }
  }

  // all fields below are touched only on the executor's thread.
  private var base: FileRevision? = null
  private var bom = false
  private var editable = false
  private var editSequence = 0
  private var checkpointedSequence = 0
  private var savedSequence = 0
  private var latestText = ""
  private var current: DocumentStatus = DocumentStatus.Loading

  val status: DocumentStatus get() = executor.submit(Callable { current }).get()

  /** blocks until queued work has finished. for tests and teardown. */
  fun waitUntilIdle() {
    executor.submit {}.get()
  }

  /** finishes queued work, then stops the thread. later calls do nothing. */
  fun close() {
    executor.shutdown()
  }

  /**
   * reads the file and any draft. call off the main thread. a draft whose base matches the
   * file is restored; any other draft needs explicit recovery before editing.
   */
  fun load(): LoadOutcome = executor.submit(Callable { loadOnQueue() }).get()

  /** records the editor's current text after edits settle, for example after a short pause. */
  fun update(text: String) = enqueue {
    if (editable) {
      editSequence += 1
      latestText = text
      set(DocumentStatus.Dirty)
    }
  }

  /** writes the latest text to the journal, then saves it against the base revision. */
  fun persist() = enqueue {
    if (!editable || editSequence <= savedSequence) {
      return@enqueue
    }
    if (checkpointedSequence < editSequence) {
      val sequence = editSequence
      try {
        journal.checkpoint(DraftRecord(vaultId, path, base, TextCodec.encode(latestText, bom), sequence, clock()))
        checkpointedSequence = sequence
        set(DocumentStatus.Journaled)
      } catch (error: Exception) {
        set(DocumentStatus.CheckpointFailed(describe(error)))
        return@enqueue
      }
    }
    if (current is DocumentStatus.Conflict) {
      // a conflict stays until the user resolves it; edits keep going to the journal only.
      return@enqueue
    }
    save()
  }

  /**
   * compares the file with the base revision, for example when the app returns to the
   * foreground. [completion] receives new text when a clean document followed an external edit.
   */
  fun reconcile(completion: (String?) -> Unit) = enqueue {
    completion(reconcileOnQueue())
  }

  // MARK: - helpers (on the executor's thread)

  private fun enqueue(task: () -> Unit) {
    try {
      executor.execute(task)
    } catch (_: RejectedExecutionException) {
      // closed: the editor moved on and flushed before closing.
    }
  }

  private fun loadOnQueue(): LoadOutcome {
    val read = try {
      session.perform { it.read(path) }
    } catch (error: Exception) {
      set(DocumentStatus.Recoverable(describe(error)))
      return LoadOutcome.Unavailable(FileState.Unknown(describe(error)))
    }
    val draft = runCatching { journal.load(vaultId, path) }.getOrNull()
    return when (read) {
      is ReadResult.Unavailable -> {
        if (read.state == FileState.Absent && draft != null) {
          if (draft.base == null) restore(draft, null) else LoadOutcome.RecoveryNeeded(draft, null)
        } else {
          // a placeholder or unknown file keeps any draft in the journal until it can be read.
          set(DocumentStatus.Unavailable(read.state))
          LoadOutcome.Unavailable(read.state)
        }
      }
      is ReadResult.Contents -> when {
        draft != null -> if (draft.base == read.revision) restore(draft, read.revision) else LoadOutcome.RecoveryNeeded(draft, read.revision)
        else -> when (val decoded = TextCodec.decode(read.bytes)) {
          is DecodedText.ReadOnly -> {
            set(DocumentStatus.ReadOnly(decoded.encoding))
            LoadOutcome.ReadOnly(decoded.preview, decoded.encoding)
          }
          is DecodedText.Editable -> open(decoded.text, decoded.bom, read.revision, restored = false)
        }
      }
    }
  }

  private fun reconcileOnQueue(): String? {
    if (!editable) {
      return null
    }
    val read = runCatching { session.perform { it.read(path) } }.getOrNull() ?: return null
    when (read) {
      is ReadResult.Unavailable -> {
        set(if (read.state == FileState.Absent) DocumentStatus.Missing else DocumentStatus.Unavailable(read.state))
        return null
      }
      is ReadResult.Contents -> {
        if (read.revision == base) {
          return null
        }
        val decoded = TextCodec.decode(read.bytes)
        if (editSequence != savedSequence || decoded !is DecodedText.Editable) {
          set(DocumentStatus.Conflict(read.revision))
          return null
        }
        bom = decoded.bom
        base = read.revision
        latestText = decoded.text
        set(DocumentStatus.Clean)
        return decoded.text
      }
    }
  }

  private fun open(text: String, bom: Boolean, revision: FileRevision?, restored: Boolean): LoadOutcome {
    this.bom = bom
    base = revision
    latestText = text
    editable = true
    set(if (restored) DocumentStatus.Journaled else DocumentStatus.Clean)
    return LoadOutcome.Loaded(LoadedDocument(text, bom, newline(text), revision, restored))
  }

  private fun restore(draft: DraftRecord, revision: FileRevision?): LoadOutcome {
    val decoded = TextCodec.decode(draft.contents) as? DecodedText.Editable
      ?: return LoadOutcome.RecoveryNeeded(draft, revision)
    editSequence = draft.sequence
    checkpointedSequence = draft.sequence
    savedSequence = 0
    return open(decoded.text, decoded.bom, revision, restored = true)
  }

  private fun save() {
    val sequence = checkpointedSequence
    val bytes = TextCodec.encode(latestText, bom)
    set(DocumentStatus.Saving)
    try {
      val base = this.base
      if (base != null) {
        when (val result = session.perform { it.save(path, bytes, base) }) {
          is SaveResult.Saved -> saved(result.revision, sequence)
          is SaveResult.Conflict -> set(DocumentStatus.Conflict(result.current))
          SaveResult.Missing -> set(DocumentStatus.Missing)
          is SaveResult.Unavailable -> set(DocumentStatus.Recoverable("the file is unavailable: ${result.state}"))
        }
      } else {
        // a restored draft of a note that does not exist yet is created, never overwritten.
        when (val result = session.perform { it.createExclusive(path, bytes) }) {
          is CreateResult.Created -> saved(result.revision, sequence)
          CreateResult.Exists -> set(DocumentStatus.Conflict(null))
          is CreateResult.Unavailable -> set(DocumentStatus.Recoverable("the file is unavailable: ${result.state}"))
        }
      }
    } catch (error: Exception) {
      set(DocumentStatus.Recoverable(describe(error)))
    }
  }

  private fun saved(revision: FileRevision, sequence: Int) {
    base = revision
    savedSequence = sequence
    // a newer checkpoint written meanwhile is kept by the journal.
    runCatching { journal.discard(vaultId, path, sequence) }
    set(if (editSequence > savedSequence) DocumentStatus.Dirty else DocumentStatus.Clean)
  }

  private fun set(next: DocumentStatus) {
    current = next
    onStatus(next)
  }

  private fun describe(error: Exception): String = error.message ?: error.javaClass.simpleName

  companion object {
    /** "\r\n" or "\r" when the file's first line break uses it, otherwise "\n". */
    fun newline(text: String): String {
      var previousWasReturn = false
      for (char in text) {
        if (previousWasReturn) {
          return if (char == '\n') "\r\n" else "\r"
        }
        if (char == '\r') {
          previousWasReturn = true
        } else if (char == '\n') {
          return "\n"
        }
      }
      return if (previousWasReturn) "\r" else "\n"
    }
  }
}
