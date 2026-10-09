package expo.modules.vault

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import expo.modules.vault.core.AppDataStore
import expo.modules.vault.core.DraftJournal
import expo.modules.vault.core.Durable
import expo.modules.vault.core.VaultRegistry
import expo.modules.vault.core.VaultSession
import expo.modules.vault.core.WikiLinkTargets
import java.io.File
import java.util.concurrent.CopyOnWriteArraySet

/** process-wide vault state shared by the module's functions and the editor views. */
internal object VaultRuntime {
  private val lock = Any()
  private var initialized = false
  private val main = Handler(Looper.getMainLooper())

  lateinit var registry: VaultRegistry
    private set
  var journal: DraftJournal? = null
    private set
  lateinit var appData: AppDataStore
    private set

  private val sessions = HashMap<String, VaultSession>()
  private val linkTargets = HashMap<String, WikiLinkTargets>()

  /** the heading of a `[[note#heading]]` link being followed; the next editor for that note takes it. */
  private var pendingHeading: Triple<String, String, String>? = null

  /** editors that want link target changes and app lifecycle events, on the main thread. */
  val editors = CopyOnWriteArraySet<VaultEditorView>()

  /** app-private storage for the vault list, drafts, and app data, outside every vault (r16). */
  fun initialize(context: Context) {
    synchronized(lock) { initializeLocked(context) }
  }

  private fun initializeLocked(context: Context) {
    if (initialized) return
    // android's file apis refuse to open a folder, so the folder flush after a rename uses Os.
    Durable.syncFolder = { folder ->
      try {
        val descriptor = Os.open(folder.path, OsConstants.O_RDONLY, 0)
        try {
          Os.fsync(descriptor)
        } finally {
          Os.close(descriptor)
        }
      } catch (_: ErrnoException) {
        // best effort: the file itself is already synced.
      }
    }
    val support = File(context.applicationContext.filesDir, "vault")
    registry = VaultRegistry(File(support, "vaults.bin"))
    journal = runCatching { DraftJournal(File(support, "drafts")) }.getOrNull()
    appData = AppDataStore(File(support, "app-data"))
    initialized = true
  }

  fun session(id: String): VaultSession? = synchronized(lock) { sessions[id] }

  /** stores the session unless one is already open for the vault; returns the open session. */
  fun insert(session: VaultSession): VaultSession = synchronized(lock) {
    sessions.getOrPut(session.id) { session }
  }

  fun remove(id: String): VaultSession? = synchronized(lock) { sessions.remove(id) }

  fun removeAll(): List<VaultSession> = synchronized(lock) {
    sessions.values.toList().also { sessions.clear() }
  }

  /** the notes that wikilinks can name, from the vault's last complete listing. */
  fun linkTargets(vaultId: String): WikiLinkTargets? = synchronized(lock) { linkTargets[vaultId] }

  fun setLinkTargets(targets: WikiLinkTargets, vaultId: String) {
    synchronized(lock) { linkTargets[vaultId] = targets }
    main.post { editors.forEach { it.linkTargetsChanged(vaultId) } }
  }

  fun setPendingHeading(heading: String?, vaultId: String, path: String) = synchronized(lock) {
    pendingHeading = heading?.let { Triple(vaultId, path, it) }
  }

  fun takePendingHeading(vaultId: String, path: String): String? = synchronized(lock) {
    val pending = pendingHeading ?: return null
    if (pending.first != vaultId || pending.second != path) return null
    pendingHeading = null
    pending.third
  }
}
