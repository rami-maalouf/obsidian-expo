package expo.modules.vault

import android.content.ContentResolver
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import expo.modules.vault.core.DocumentTree
import expo.modules.vault.core.TreeEntry
import java.io.FileOutputStream
import java.io.IOException
import java.io.SyncFailedException

/**
 * a vault folder the user picked with the system folder picker, reached through android's
 * storage access framework. the persisted tree permission is the android counterpart of an ios
 * security-scoped bookmark: the provider only serves documents inside the picked folder.
 */
class SafDocumentTree(private val resolver: ContentResolver, val treeUri: Uri) : DocumentTree {
  override val rootId: String = DocumentsContract.getTreeDocumentId(treeUri)

  private fun documentUri(id: String): Uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id)

  /** the picked folder's display name, or null when the provider does not report one. */
  fun rootName(): String? = query(documentUri(rootId)) { it.name }

  override fun list(folderId: String): List<TreeEntry> {
    val children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, folderId)
    val cursor = resolver.query(children, PROJECTION, null, null, null) ?: throw IOException("the folder could not be listed")
    return cursor.use {
      // a cloud provider can answer with part of a folder while it fetches the rest; a partial
      // listing must never count as proof that a note is absent (r4).
      if (it.extras?.getBoolean(DocumentsContract.EXTRA_LOADING, false) == true) {
        throw IOException("the folder is still loading")
      }
      val entries = ArrayList<TreeEntry>(it.count)
      while (it.moveToNext()) {
        entries.add(entry(it))
      }
      entries
    }
  }

  override fun read(id: String): ByteArray =
    resolver.openInputStream(documentUri(id))?.use { it.readBytes() } ?: throw IOException("the note could not be opened")

  override fun write(id: String, bytes: ByteArray) {
    // "wt" truncates: plain "w" leaves old bytes past the new end with some providers.
    val descriptor = resolver.openFileDescriptor(documentUri(id), "wt") ?: throw IOException("the note could not be opened for writing")
    descriptor.use { pfd ->
      val output = FileOutputStream(pfd.fileDescriptor)
      output.write(bytes)
      output.flush()
      try {
        pfd.fileDescriptor.sync()
      } catch (_: SyncFailedException) {
        // a provider that streams through a pipe cannot sync; the caller reads the bytes back.
      }
    }
  }

  override fun createFile(folderId: String, name: String): TreeEntry? {
    val mimeType = if (name.lowercase().endsWith(".md")) "text/markdown" else "application/octet-stream"
    return create(folderId, name, mimeType)
  }

  override fun createFolder(folderId: String, name: String): TreeEntry? = create(folderId, name, Document.MIME_TYPE_DIR)

  override fun delete(id: String) {
    if (!DocumentsContract.deleteDocument(resolver, documentUri(id))) {
      throw IOException("the document could not be deleted")
    }
  }

  /**
   * a provider that finds the name taken creates "Name (1).md" instead of failing. that
   * document is removed again, so a create never replaces or shadows an existing note.
   */
  private fun create(folderId: String, name: String, mimeType: String): TreeEntry? {
    val created = DocumentsContract.createDocument(resolver, documentUri(folderId), mimeType, name) ?: return null
    val entry = query(created) { it }
    if (entry == null || entry.name != name) {
      runCatching { DocumentsContract.deleteDocument(resolver, created) }
      return null
    }
    return entry
  }

  private fun <T> query(uri: Uri, map: (TreeEntry) -> T): T? =
    resolver.query(uri, PROJECTION, null, null, null)?.use { if (it.moveToFirst()) map(entry(it)) else null }

  private fun entry(cursor: android.database.Cursor): TreeEntry {
    val mimeType = cursor.getString(2)
    val flags = if (cursor.isNull(5)) 0 else cursor.getInt(5)
    val isDirectory = mimeType == Document.MIME_TYPE_DIR
    return TreeEntry(
      id = cursor.getString(0),
      name = cursor.getString(1) ?: "",
      isDirectory = isDirectory,
      size = if (isDirectory || cursor.isNull(3)) null else cursor.getLong(3),
      modified = if (cursor.isNull(4)) null else cursor.getLong(4).takeIf { it > 0 },
      // a virtual document (for example a cloud document without a file form) has no bytes here.
      readable = flags and Document.FLAG_VIRTUAL_DOCUMENT == 0,
    )
  }

  private companion object {
    val PROJECTION = arrayOf(
      Document.COLUMN_DOCUMENT_ID,
      Document.COLUMN_DISPLAY_NAME,
      Document.COLUMN_MIME_TYPE,
      Document.COLUMN_SIZE,
      Document.COLUMN_LAST_MODIFIED,
      Document.COLUMN_FLAGS,
    )
  }
}
