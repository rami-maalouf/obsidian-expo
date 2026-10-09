package expo.modules.vault.core

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.IOException

/**
 * one recoverable draft: the exact bytes to save, the revision they were edited from, and the
 * document they belong to (persistence protocol).
 */
class DraftRecord(
  val vaultId: String,
  val path: String,
  /** the on-disk revision the draft started from; null when the note does not exist yet. */
  val base: FileRevision?,
  val contents: ByteArray,
  /** increases with every checkpoint of the same document, so an older one never wins. */
  val sequence: Int,
  /** ms since 1970. */
  val updatedAt: Long,
) {
  override fun equals(other: Any?): Boolean = other is DraftRecord &&
    vaultId == other.vaultId && path == other.path && base == other.base &&
    contents.contentEquals(other.contents) && sequence == other.sequence && updatedAt == other.updatedAt

  override fun hashCode(): Int = listOf(vaultId, path, base, contents.contentHashCode(), sequence, updatedAt).hashCode()

  override fun toString(): String = "DraftRecord($vaultId, $path, sequence $sequence, ${contents.size} bytes)"
}

sealed class DraftJournalException(message: String) : IOException(message) {
  /** a checkpoint with the same or a newer sequence is already stored. */
  class StaleCheckpoint(val stored: Int, val attempted: Int) : DraftJournalException("staleCheckpoint(stored: $stored, attempted: $attempted)")
}

/**
 * app-private storage for unsaved drafts, outside the vault (r16). a checkpoint returns only
 * after its bytes and the rename are flushed, so a returned call is a durable acknowledgement.
 */
class DraftJournal(val directory: File) {
  private val lock = Any()

  init {
    if (!directory.isDirectory && !directory.mkdirs()) {
      throw IOException("could not create the draft journal folder")
    }
  }

  fun checkpoint(record: DraftRecord) = synchronized(lock) {
    val file = fileFor(record.vaultId, record.path)
    val stored = if (file.exists()) runCatching { read(file) }.getOrNull() else null
    if (stored != null && stored.sequence >= record.sequence) {
      throw DraftJournalException.StaleCheckpoint(stored.sequence, record.sequence)
    }
    Durable.write(file, encode(record))
  }

  fun load(vaultId: String, path: String): DraftRecord? = synchronized(lock) {
    val file = fileFor(vaultId, path)
    if (file.exists()) read(file) else null
  }

  /**
   * every stored draft, plus the files that could not be decoded. unreadable drafts are
   * reported rather than dropped, so recovery can say that something was not restored.
   */
  fun all(): Pair<List<DraftRecord>, List<String>> = synchronized(lock) {
    val drafts = ArrayList<DraftRecord>()
    val unreadable = ArrayList<String>()
    val names = directory.list() ?: throw IOException("the draft journal cannot be listed")
    for (name in names.filter { it.endsWith(SUFFIX) }) {
      val record = runCatching { read(File(directory, name)) }.getOrNull()
      if (record != null) drafts.add(record) else unreadable.add(name)
    }
    drafts.sortWith(compareBy({ it.vaultId }, { it.path }))
    drafts to unreadable.sorted()
  }

  /**
   * removes a draft after a verified save or an explicit discard. a newer checkpoint than
   * [sequence] is kept. returns whether a draft was removed.
   */
  fun discard(vaultId: String, path: String, sequence: Int): Boolean = synchronized(lock) {
    val file = fileFor(vaultId, path)
    val stored = if (file.exists()) runCatching { read(file) }.getOrNull() else null
    if (stored == null || stored.sequence > sequence) {
      return false
    }
    Durable.delete(file)
  }

  private fun fileFor(vaultId: String, path: String) = File(directory, sha256Hex("$vaultId\u0000$path".toByteArray(Charsets.UTF_8)) + SUFFIX)

  private fun read(file: File): DraftRecord = DataInputStream(ByteArrayInputStream(file.readBytes())).use { input ->
    if (input.readInt() != MAGIC) {
      throw IOException("not a draft")
    }
    val vaultId = input.readUTF()
    val path = input.readUTF()
    val base = if (input.readBoolean()) FileRevision(input.readUTF(), input.readInt()) else null
    val sequence = input.readInt()
    val updatedAt = input.readLong()
    val contents = ByteArray(input.readInt())
    input.readFully(contents)
    DraftRecord(vaultId, path, base, contents, sequence, updatedAt)
  }

  private fun encode(record: DraftRecord): ByteArray {
    val buffer = ByteArrayOutputStream(record.contents.size + 256)
    DataOutputStream(buffer).use { output ->
      output.writeInt(MAGIC)
      output.writeUTF(record.vaultId)
      output.writeUTF(record.path)
      output.writeBoolean(record.base != null)
      record.base?.let {
        output.writeUTF(it.sha256)
        output.writeInt(it.size)
      }
      output.writeInt(record.sequence)
      output.writeLong(record.updatedAt)
      output.writeInt(record.contents.size)
      output.write(record.contents)
    }
    return buffer.toByteArray()
  }

  private companion object {
    const val SUFFIX = ".draft"

    /** "VDR1": the draft format's version. */
    const val MAGIC = 0x56445231
  }
}
