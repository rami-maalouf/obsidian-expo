package expo.modules.vault.core

/** a document or folder in a [DocumentTree], as the tree listed it. */
data class TreeEntry(
  /** opaque to the vault code; only the tree that listed it can use it. */
  val id: String,
  val name: String,
  val isDirectory: Boolean,
  val size: Long? = null,
  /** last modification in ms since 1970, when the tree reports one. */
  val modified: Long? = null,
  /** false for an item whose bytes cannot be read here, such as a provider's virtual document. */
  val readable: Boolean = true,
)

/**
 * one vault folder, reached only through its root and the names inside it. android's storage
 * access framework (SafDocumentTree) and a plain folder ([FileDocumentTree]) implement it, so
 * the file rules in [VaultFiles] run unchanged in tests on any jvm.
 */
interface DocumentTree {
  val rootId: String

  /** the folder's children. throws when the folder cannot be listed completely. */
  fun list(folderId: String): List<TreeEntry>

  fun read(id: String): ByteArray

  /** replaces the document's bytes in place and flushes them to storage. */
  fun write(id: String, bytes: ByteArray)

  /**
   * creates an empty document named exactly [name]. returns null, and leaves nothing behind,
   * when the name is taken: a tree never replaces an existing document here.
   */
  fun createFile(folderId: String, name: String): TreeEntry?

  /** creates a folder named exactly [name], or returns null when the name is taken. */
  fun createFolder(folderId: String, name: String): TreeEntry?

  fun delete(id: String)
}
