package expo.modules.vault.core

import java.io.IOException

class VaultClosedException : IOException("closed")

/** an opened vault. after [close], new operations fail; running ones finish. */
class VaultSession(val id: String, val files: VaultFiles) {
  @Volatile
  private var closed = false

  val isClosed: Boolean get() = closed

  fun <T> perform(body: (VaultFiles) -> T): T {
    if (closed) {
      throw VaultClosedException()
    }
    return body(files)
  }

  fun close() {
    closed = true
  }
}
