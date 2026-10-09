package expo.modules.vault.core

import java.io.File

/**
 * small app-owned values such as per-vault settings and bookmarks, stored as one file per key
 * in app-private storage, outside every vault (r16, ktd7).
 */
class AppDataStore(val directory: File) {
  private val lock = Any()

  fun read(key: String): String? = synchronized(lock) {
    val file = fileFor(key)
    if (file.exists()) file.readText(Charsets.UTF_8) else null
  }

  /** replaces the value atomically; null removes it. */
  fun write(key: String, value: String?) = synchronized(lock) {
    val file = fileFor(key)
    if (value == null) {
      Durable.delete(file)
    } else {
      Durable.write(file, value.toByteArray(Charsets.UTF_8))
    }
  }

  private fun fileFor(key: String) = File(directory, sha256Hex(key.toByteArray(Charsets.UTF_8)) + ".json")
}
