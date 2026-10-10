package expo.modules.vault.core

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files

/**
 * a vault in an ordinary folder. tests use it, and so does the emulator-only test vault in the
 * app's own storage. ids are vault-relative paths built from listed names; symbolic links are
 * not listed, so no id leads outside the root.
 */
class FileDocumentTree(root: File) : DocumentTree {
  private val root: File = root.canonicalFile
  override val rootId: String = ""

  override fun list(folderId: String): List<TreeEntry> {
    val folder = file(folderId)
    if (!folder.isDirectory) {
      throw IOException("not a folder")
    }
    val canonicalFolder = folder.canonicalFile
    val names = folder.list() ?: throw IOException("the folder cannot be listed")
    return names.sorted().mapNotNull { name ->
      val child = File(canonicalFolder, name)
      // a link resolves elsewhere: its canonical path differs from the path through the folder.
      if (child.canonicalPath != child.absolutePath) {
        return@mapNotNull null
      }
      val id = if (folderId.isEmpty()) name else "$folderId/$name"
      if (child.isDirectory) {
        TreeEntry(id, name, isDirectory = true, modified = child.lastModified())
      } else {
        TreeEntry(id, name, isDirectory = false, size = child.length(), modified = child.lastModified(), readable = child.canRead())
      }
    }
  }

  override fun read(id: String): ByteArray = file(id).readBytes()

  override fun write(id: String, bytes: ByteArray) {
    // in place, like a storage access framework document opened with "wt".
    FileOutputStream(file(id), false).use { out ->
      out.write(bytes)
      out.fd.sync()
    }
  }

  override fun createFile(folderId: String, name: String): TreeEntry? {
    val id = childId(folderId, name)
    // createNewFile is an exclusive create: it never replaces an existing file.
    if (!file(id).createNewFile()) {
      return null
    }
    return TreeEntry(id, name, isDirectory = false, size = 0)
  }

  override fun createFolder(folderId: String, name: String): TreeEntry? {
    val id = childId(folderId, name)
    if (!file(id).mkdir()) {
      return null
    }
    return TreeEntry(id, name, isDirectory = true)
  }

  override fun rename(id: String, name: String): TreeEntry? {
    val source = file(id)
    val targetId = childId(id.substringBeforeLast('/', ""), name)
    val target = file(targetId)
    try {
      // without REPLACE_EXISTING, an existing target is refused rather than replaced.
      Files.move(source.toPath(), target.toPath())
    } catch (_: FileAlreadyExistsException) {
      return null
    }
    return TreeEntry(targetId, name, isDirectory = target.isDirectory, size = target.length(), modified = target.lastModified())
  }

  override fun delete(id: String) {
    if (!file(id).delete()) {
      throw IOException("could not delete $id")
    }
  }

  private fun childId(folderId: String, name: String): String {
    require(name.isNotEmpty() && !name.contains('/') && name != "." && name != "..") { "invalid name" }
    return if (folderId.isEmpty()) name else "$folderId/$name"
  }

  private fun file(id: String): File = if (id.isEmpty()) root else File(root, id)
}
