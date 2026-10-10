package expo.modules.vault

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.view.inputmethod.InputMethodManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.vault.core.CreateResult
import expo.modules.vault.core.DecodedText
import expo.modules.vault.core.DraftJournal
import expo.modules.vault.core.DraftRecord
import expo.modules.vault.core.DocumentSession
import expo.modules.vault.core.DocumentStatus
import expo.modules.vault.core.DocumentTree
import expo.modules.vault.core.FileDocumentTree
import expo.modules.vault.core.FileRevision
import expo.modules.vault.core.FileState
import expo.modules.vault.core.MoveResult
import expo.modules.vault.core.ReadResult
import expo.modules.vault.core.SaveResult
import expo.modules.vault.core.TextCodec
import expo.modules.vault.core.VaultFiles
import expo.modules.vault.core.VaultPath
import expo.modules.vault.core.VaultPathException
import expo.modules.vault.core.VaultRecord
import expo.modules.vault.core.VaultSession
import expo.modules.vault.core.WikiLinkTargets
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.Executors

class VaultException(message: String) : CodedException(message)

/**
 * javascript binding for the vault core on android. it has the same functions and results as
 * the ios module (modules/vault/src/index.ts), so the app's javascript runs unchanged. path,
 * state, and save rules live in core/, which `gradle test` covers; javascript passes vault ids
 * and vault-relative paths only.
 */
class VaultModule : Module() {
  /** vault calls run in order on their own thread, never on expo's shared module queue. */
  private val fileDispatcher = Executors.newSingleThreadExecutor { Thread(it, "vault.files") }.asCoroutineDispatcher()
  private val fileScope = CoroutineScope(fileDispatcher + SupervisorJob())

  /** the full vault scan has a thread of its own, so a large vault never delays today's note. */
  private val listingScope = CoroutineScope(
    Executors.newSingleThreadExecutor { Thread(it, "vault.listing").apply { priority = Thread.NORM_PRIORITY - 2 } }
      .asCoroutineDispatcher() + SupervisorJob(),
  )

  private lateinit var picker: AppContextActivityResultLauncher<VaultPickerInput, PickedFolder?>
  private var testFolderChecked = false

  private val context: Context
    get() = appContext.reactContext ?: throw VaultException("The app is not ready yet.")

  override fun definition() = ModuleDefinition {
    Name("Vault")

    // commands from the ipad menu bar; android sends none yet, but javascript listens the same way.
    Events("onMenuCommand")

    Constant("coreVersion") {
      CORE_VERSION
    }

    // where the disposable search index lives: app caches, outside every vault and backups.
    Constant("indexDirectory") {
      appContext.reactContext?.let { File(it.cacheDir, "vault-index").apply { mkdirs() }.absolutePath } ?: ""
    }

    // returns null for a valid vault-relative path, or the reason it is refused.
    Function("checkRelativePath") { path: String ->
      try {
        VaultPath.segments(path)
        null
      } catch (error: VaultPathException) {
        error.message
      }
    }

    RegisterActivityContracts {
      picker = registerForActivityResult(VaultPickerContract())
    }

    // resolves with the picked vault, or null when the user cancels. cancelling leaves any open
    // vault untouched.
    AsyncFunction("pickVault") Coroutine { ->
      val picked = picker.launch(VaultPickerInput())
      if (picked == null) null else withContext(fileDispatcher) { register(picked) }
    }

    // closes the keyboard and takes focus from the native editor, which react native's
    // Keyboard.dismiss() does not reach.
    AsyncFunction("dismissKeyboard") {
      dismissKeyboard()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("listVaults") {
      ready()
      registerTestFolder()
      VaultRuntime.registry.records().map { mapOf("id" to it.id, "name" to it.name) }
    }.runOnQueue(fileScope)

    AsyncFunction("openVault") { id: String ->
      ready()
      open(id)
    }.runOnQueue(fileScope)

    AsyncFunction("closeVault") { id: String ->
      VaultRuntime.remove(id)?.close()
      Unit
    }.runOnQueue(fileScope)

    AsyncFunction("forgetVault") { id: String ->
      ready()
      VaultRuntime.remove(id)?.close()
      val record = VaultRuntime.registry.find(id)
      VaultRuntime.registry.remove(id)
      if (record != null) releaseAccess(record)
    }.runOnQueue(fileScope)

    AsyncFunction("fileState") { vaultId: String, path: String ->
      withFiles(vaultId) { encode(it.state(path)) }
    }.runOnQueue(fileScope)

    AsyncFunction("readText") { vaultId: String, path: String ->
      withFiles(vaultId) { files ->
        when (val read = files.read(path)) {
          is ReadResult.Unavailable -> mapOf("kind" to "unavailable", "state" to encode(read.state))
          is ReadResult.Contents -> when (val decoded = TextCodec.decode(read.bytes)) {
            is DecodedText.Editable -> mapOf("kind" to "text", "text" to decoded.text, "bom" to decoded.bom, "revision" to encode(read.revision))
            is DecodedText.ReadOnly -> mapOf("kind" to "read-only", "preview" to decoded.preview, "encoding" to decoded.encoding, "revision" to encode(read.revision))
          }
        }
      }
    }.runOnQueue(fileScope)

    AsyncFunction("createExclusive") { vaultId: String, path: String, text: String ->
      withFiles(vaultId) { files ->
        when (val result = files.createExclusive(path, TextCodec.encode(text, bom = false))) {
          is CreateResult.Created -> mapOf("kind" to "created", "revision" to encode(result.revision))
          CreateResult.Exists -> mapOf("kind" to "exists")
          is CreateResult.Unavailable -> mapOf("kind" to "unavailable", "state" to encode(result.state))
        }
      }
    }.runOnQueue(fileScope)

    AsyncFunction("saveText") { vaultId: String, path: String, text: String, bom: Boolean, baseSha256: String, baseSize: Int ->
      withFiles(vaultId) { files ->
        when (val result = files.save(path, TextCodec.encode(text, bom), FileRevision(baseSha256, baseSize))) {
          is SaveResult.Saved -> mapOf("kind" to "saved", "revision" to encode(result.revision))
          is SaveResult.Conflict -> mapOf("kind" to "conflict", "current" to encode(result.current))
          SaveResult.Missing -> mapOf("kind" to "missing")
          is SaveResult.Unavailable -> mapOf("kind" to "unavailable", "state" to encode(result.state))
        }
      }
    }.runOnQueue(fileScope)

    AsyncFunction("listNotes") { vaultId: String ->
      withFiles(vaultId) { files ->
        val listing = files.enumerateNotes()
        // the editor resolves wikilinks against this listing without asking javascript.
        VaultRuntime.setLinkTargets(WikiLinkTargets(listing.notes.map { WikiLinkTargets.Note(it.path, it.modified) }), vaultId)
        val notes = listing.notes.map { note ->
          val item = HashMap<String, Any>(4)
          item["path"] = note.path
          item["placeholder"] = note.placeholder
          note.size?.let { item["size"] = it.toDouble() }
          note.modified?.let { item["modified"] = it.toDouble() }
          item
        }
        mapOf("notes" to notes, "unreadableFolders" to listing.unreadableFolders)
      }
    }.runOnQueue(listingScope)

    AsyncFunction("checkpointDraft") { vaultId: String, path: String, text: String, bom: Boolean, baseSha256: String?, baseSize: Int?, sequence: Int ->
      val base = if (baseSha256 != null && baseSize != null) FileRevision(baseSha256, baseSize) else null
      requireJournal().checkpoint(DraftRecord(vaultId, path, base, TextCodec.encode(text, bom), sequence, System.currentTimeMillis()))
    }.runOnQueue(fileScope)

    AsyncFunction("listDrafts") {
      val (drafts, unreadable) = requireJournal().all()
      val items = drafts.map { draft ->
        val item = HashMap<String, Any>(8)
        item["vaultId"] = draft.vaultId
        item["path"] = draft.path
        item["sequence"] = draft.sequence
        item["updatedAt"] = draft.updatedAt.toDouble()
        draft.base?.let { item["base"] = encode(it) }
        (TextCodec.decode(draft.contents) as? DecodedText.Editable)?.let {
          item["text"] = it.text
          item["bom"] = it.bom
        }
        item
      }
      mapOf("drafts" to items, "unreadable" to unreadable)
    }.runOnQueue(fileScope)

    AsyncFunction("discardDraft") { vaultId: String, path: String, sequence: Int ->
      requireJournal().discard(vaultId, path, sequence)
    }.runOnQueue(fileScope)

    // app-owned values such as per-vault settings and bookmarks, outside the vault.
    AsyncFunction("readAppData") { key: String ->
      ready()
      VaultRuntime.appData.read(key)
    }.runOnQueue(fileScope)

    AsyncFunction("writeAppData") { key: String, value: String? ->
      ready()
      VaultRuntime.appData.write(key, value)
    }.runOnQueue(fileScope)

    View(VaultEditorView::class) {
      Events("onStatus", "onLoad", "onOpenLink", "onScrolledChange")

      Prop("vaultId") { view: VaultEditorView, vaultId: String? ->
        view.vaultId = vaultId
      }

      Prop("path") { view: VaultEditorView, path: String? ->
        view.path = path
      }

      OnViewDidUpdateProps { view: VaultEditorView ->
        view.openIfNeeded()
      }

      OnViewDestroys { view: VaultEditorView ->
        view.destroy()
      }

      // starts writing pending edits to the journal and then the file; status events follow.
      AsyncFunction("flush") { view: VaultEditorView ->
        view.flush()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("focus") { view: VaultEditorView ->
        view.focusEditor()
      }.runOnQueue(Queues.MAIN)

      // saves the open note, waits for that save, then renames its file. nothing moves while
      // edits are unsaved, so no later save of this document can target the old path.
      AsyncFunction("rename") { view: VaultEditorView, newPath: String, promise: Promise ->
        val vaultId = view.vaultId
        val path = view.path
        if (vaultId == null || path == null) {
          promise.resolve(mapOf("kind" to "missing"))
        } else {
          renameAfterSave(view.flushForRename(), vaultId, path, newPath, promise)
        }
      }.runOnQueue(Queues.MAIN)
    }

    OnCreate {
      appContext.reactContext?.let { VaultRuntime.initialize(it) }
      registerTestFolder()
    }

    OnActivityEntersForeground {
      registerTestFolder()
      VaultRuntime.editors.forEach { it.enteredForeground() }
    }

    OnActivityEntersBackground {
      VaultRuntime.editors.forEach { it.enteredBackground() }
    }

    OnDestroy {
      VaultRuntime.removeAll().forEach { it.close() }
    }
  }

  // MARK: - vaults

  private fun ready() {
    VaultRuntime.initialize(context)
  }

  /** keeps the picker's permission across restarts and registers the folder. */
  private fun register(picked: PickedFolder): Map<String, Any> {
    ready()
    val modes = picked.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    if (modes and Intent.FLAG_GRANT_WRITE_URI_PERMISSION == 0) {
      throw VaultException("The folder was shared without permission to change it. Choose a folder the app can write to.")
    }
    val resolver = context.contentResolver
    try {
      resolver.takePersistableUriPermission(picked.uri, modes)
    } catch (error: SecurityException) {
      throw VaultException("The folder could not be saved for later access. (${error.message})")
    }
    val tree = SafDocumentTree(resolver, picked.uri)
    val name = runCatching { tree.rootName() }.getOrNull()?.takeIf { it.isNotBlank() } ?: "Vault"
    val record = VaultRuntime.registry.add(picked.uri.toString(), name)
    return mapOf("id" to record.id, "name" to record.name)
  }

  private fun open(id: String): Map<String, Any> {
    if (VaultRuntime.session(id) != null) {
      return mapOf("id" to id, "status" to "open")
    }
    val record = VaultRuntime.registry.find(id)
      ?: throw VaultException("The vault folder is no longer available. Pick it again. (unknownVault)")
    val tree = tree(record)
    try {
      tree.list(tree.rootId)
    } catch (error: Exception) {
      throw VaultException("The vault folder is no longer available. Pick it again. (${error.message})")
    }
    val session = VaultSession(id, VaultFiles(tree))
    if (VaultRuntime.insert(session) !== session) {
      // another call opened the vault first; keep that session.
      session.close()
    }
    return mapOf("id" to id, "name" to record.name, "status" to "open")
  }

  /** the folder behind a record. a picked folder needs its persisted permission. */
  private fun tree(record: VaultRecord): DocumentTree {
    val uri = Uri.parse(record.location)
    if (uri.scheme == "file") {
      val folder = File(uri.path ?: "")
      if (!isTestFolder(folder)) {
        throw VaultException("The vault folder is no longer available. Pick it again. (not a test folder)")
      }
      return FileDocumentTree(folder)
    }
    val resolver = context.contentResolver
    val kept = resolver.persistedUriPermissions.any { it.uri == uri && it.isReadPermission && it.isWritePermission }
    if (!kept) {
      throw VaultException("The vault folder is no longer available. Pick it again. (access was not kept)")
    }
    return SafDocumentTree(resolver, uri)
  }

  /** gives up the folder permission when no other registered vault uses the same folder. */
  private fun releaseAccess(record: VaultRecord) {
    val uri = Uri.parse(record.location)
    if (uri.scheme != "content" || VaultRuntime.registry.records().any { it.location == record.location }) {
      return
    }
    runCatching {
      context.contentResolver.releasePersistableUriPermission(
        uri,
        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
      )
    }
  }

  private fun <T> withFiles(vaultId: String, body: (VaultFiles) -> T): T {
    val session = VaultRuntime.session(vaultId) ?: throw VaultException("The vault is not open.")
    try {
      return session.perform(body)
    } catch (error: VaultPathException) {
      throw VaultException("Invalid vault path: ${error.message}")
    }
  }

  private fun requireJournal(): DraftJournal {
    ready()
    return VaultRuntime.journal ?: throw VaultException("The draft journal could not be created.")
  }

  // MARK: - keyboard

  private fun dismissKeyboard() {
    val activity = appContext.currentActivity ?: return
    val focused = activity.currentFocus
    if (focused is VaultEditText) {
      focused.release()
    } else {
      focused?.clearFocus()
    }
    val token = (focused ?: activity.window?.decorView)?.windowToken ?: return
    activity.getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(token, 0)
  }

  // MARK: - emulator test folder

  /**
   * emulator-only test hook, like the ios simulator's `-VaultTestFolder vault`: a launch extra
   * `VaultTestFolder` names a folder in the app's own external files folder, so automated runs
   * open a fixture vault without the system folder picker. it never reaches shared storage.
   */
  private fun registerTestFolder() {
    if (testFolderChecked || !isEmulator()) return
    val activity = appContext.currentActivity ?: return
    testFolderChecked = true
    // creates the app's own folder, so a test can copy a vault into it before a relaunch.
    val base = activity.getExternalFilesDir(null) ?: return
    val name = activity.intent?.getStringExtra("VaultTestFolder") ?: return
    val folder = File(base, name)
    if (!isTestFolder(folder) || !folder.isDirectory) return
    ready()
    val record = VaultRuntime.registry.add(Uri.fromFile(folder).toString(), folder.name)
    // skip first setup with the default daily-note settings (a3).
    val key = "vault:${record.id}:daily-notes"
    if (VaultRuntime.appData.read(key) == null) {
      VaultRuntime.appData.write(key, """{"folder":"Daily","filenameFormat":"YYYY-MM-DD","templatePath":""}""")
    }
  }

  private fun isTestFolder(folder: File): Boolean {
    if (!isEmulator()) return false
    val base = appContext.reactContext?.getExternalFilesDir(null)?.canonicalFile ?: return false
    val canonical = folder.canonicalFile
    return canonical.parentFile == base
  }

  private fun isEmulator(): Boolean =
    Build.HARDWARE == "ranchu" || Build.HARDWARE == "goldfish" || Build.PRODUCT.startsWith("sdk_gphone")

  // MARK: - renaming

  /** on the file queue: waits for the document's save, then renames the file if it was saved. */
  private fun renameAfterSave(document: DocumentSession?, vaultId: String, path: String, newPath: String, promise: Promise) {
    fileScope.launch {
      document?.waitUntilIdle()
      if (document != null && !isSettled(document.status)) {
        promise.resolve(mapOf("kind" to "unsaved"))
        return@launch
      }
      try {
        promise.resolve(encode(withFiles(vaultId) { it.move(path, newPath) }))
      } catch (error: Exception) {
        promise.reject(VaultException("The note could not be renamed. (${error.message})"))
      }
    }
  }

  /** true when the document has nothing left to save: its text is on disk, or it is read-only. */
  private fun isSettled(status: DocumentStatus): Boolean = status == DocumentStatus.Clean || status is DocumentStatus.ReadOnly

  // MARK: - encoding

  private fun encode(result: MoveResult): Map<String, Any> = when (result) {
    MoveResult.Moved -> mapOf("kind" to "moved")
    MoveResult.Exists -> mapOf("kind" to "exists")
    MoveResult.Missing -> mapOf("kind" to "missing")
    is MoveResult.Unavailable -> mapOf("kind" to "unavailable", "state" to encode(result.state))
  }

  private fun encode(revision: FileRevision): Map<String, Any> = mapOf("sha256" to revision.sha256, "size" to revision.size)

  private fun encode(state: FileState): Map<String, Any> = when (state) {
    FileState.Readable -> mapOf("kind" to "readable")
    FileState.Placeholder -> mapOf("kind" to "placeholder")
    FileState.Absent -> mapOf("kind" to "absent")
    is FileState.Unknown -> mapOf("kind" to "unknown", "reason" to state.reason)
  }

  private companion object {
    /** the vault core's version; javascript reads it to confirm the module is linked. */
    const val CORE_VERSION = "0.1.0"
  }
}
