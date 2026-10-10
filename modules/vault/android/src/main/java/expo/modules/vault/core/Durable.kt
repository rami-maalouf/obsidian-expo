package expo.modules.vault.core

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.util.UUID

/** durable replacement of small app-private files: the drafts, the vault list, and app data. */
object Durable {
  /**
   * flushes a folder's entries after a rename. the default opens the folder as a file, which
   * works on linux jvms; android's runtime sets an `Os.fsync` version, because its file apis
   * refuse to open folders.
   */
  @Volatile
  var syncFolder: (File) -> Unit = { folder ->
    try {
      RandomAccessFile(folder, "r").use { it.fd.sync() }
    } catch (_: Exception) {
      // best effort: the file itself is already synced.
    }
  }

  /** writes a synced temporary file, renames it over the target, then flushes the folder. */
  fun write(target: File, bytes: ByteArray) {
    val folder = target.absoluteFile.parentFile ?: throw IOException("no parent folder for ${target.name}")
    if (!folder.isDirectory && !folder.mkdirs()) {
      throw IOException("could not create ${folder.name}")
    }
    val temporary = File(folder, ".${UUID.randomUUID()}.tmp")
    try {
      FileOutputStream(temporary).use { out ->
        out.write(bytes)
        out.fd.sync()
      }
      if (!temporary.renameTo(target)) {
        throw IOException("could not replace ${target.name}")
      }
    } catch (error: Exception) {
      temporary.delete()
      throw error
    }
    syncFolder(folder)
  }

  /** removes a file and flushes its folder; returns whether it existed. */
  fun delete(target: File): Boolean {
    if (!target.exists()) {
      return false
    }
    if (!target.delete()) {
      throw IOException("could not remove ${target.name}")
    }
    target.absoluteFile.parentFile?.let(syncFolder)
    return true
  }
}
