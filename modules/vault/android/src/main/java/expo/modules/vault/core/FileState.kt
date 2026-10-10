package expo.modules.vault.core

import java.security.MessageDigest

/** identifies file contents: two revisions are equal exactly when the bytes are equal. */
data class FileRevision(val sha256: String, val size: Int) {
  companion object {
    fun of(bytes: ByteArray): FileRevision = FileRevision(sha256Hex(bytes), bytes.size)
  }
}

/** what is known about a path before reading or creating it (r4). */
sealed class FileState {
  data object Readable : FileState()

  /** exists, but its bytes are not on this device. never treated as absent. */
  data object Placeholder : FileState()

  /** positively confirmed not to exist. */
  data object Absent : FileState()

  /** permission, availability, or type could not be established. */
  data class Unknown(val reason: String) : FileState()
}

internal fun sha256Hex(bytes: ByteArray): String =
  MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
