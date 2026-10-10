package expo.modules.vault.core

import java.io.File
import java.nio.file.Files

/** a disposable vault in the temporary folder; [close] removes it. */
class TestVault : AutoCloseable {
  val base: File = Files.createTempDirectory("vault-core-").toFile()
  val directory: File = File(base, "vault").apply { mkdirs() }
  val tree = FileDocumentTree(directory)
  val files = VaultFiles(tree)

  /** the folder that contains the vault, for creating things outside it. */
  val outside: File get() = base

  fun file(path: String) = File(directory, path)

  fun write(path: String, bytes: ByteArray): File = file(path).apply {
    parentFile.mkdirs()
    writeBytes(bytes)
  }

  fun write(path: String, text: String) = write(path, text.toByteArray())

  fun bytes(path: String): ByteArray = file(path).readBytes()

  fun exists(path: String) = file(path).exists()

  override fun close() {
    base.walkTopDown().forEach { it.setWritable(true) }
    base.deleteRecursively()
  }
}

fun String.utf8(): ByteArray = toByteArray(Charsets.UTF_8)
