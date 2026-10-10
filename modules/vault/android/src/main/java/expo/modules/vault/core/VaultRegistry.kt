package expo.modules.vault.core

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.IOException
import java.util.UUID

/**
 * a vault the user picked. the id is stable across launches and keys app-owned settings and
 * bookmarks (ktd7). `location` is the folder's storage access framework tree uri, whose
 * persisted permission restores access (r1).
 */
data class VaultRecord(val id: String, val name: String, val location: String, val addedAt: Long)

class UnknownVaultException(id: String) : IOException("unknownVault($id)")

/** app-private list of picked vaults, stored as one file outside every vault (r16). */
class VaultRegistry(private val file: File, private val newId: () -> String = { UUID.randomUUID().toString() }) {
  private val lock = Any()

  fun records(): List<VaultRecord> = synchronized(lock) { load() }

  fun find(id: String): VaultRecord? = synchronized(lock) { load().firstOrNull { it.id == id } }

  /**
   * registers a picked folder. picking a folder that is already registered keeps its id, so
   * its settings and bookmarks survive, and updates its name.
   */
  fun add(location: String, name: String, now: Long = System.currentTimeMillis()): VaultRecord = synchronized(lock) {
    val all = load().toMutableList()
    val index = all.indexOfFirst { it.location == location }
    if (index >= 0) {
      all[index] = all[index].copy(name = name)
      store(all)
      return all[index]
    }
    val record = VaultRecord(newId(), name, location, now)
    all.add(record)
    store(all)
    record
  }

  /** forgets a vault. its folder and notes are not touched. */
  fun remove(id: String) = synchronized(lock) {
    store(load().filter { it.id != id })
  }

  private fun load(): List<VaultRecord> {
    if (!file.exists()) {
      return emptyList()
    }
    return DataInputStream(ByteArrayInputStream(file.readBytes())).use { input ->
      if (input.readInt() != MAGIC) {
        throw IOException("not a vault list")
      }
      List(input.readInt()) {
        VaultRecord(id = input.readUTF(), name = input.readUTF(), location = input.readUTF(), addedAt = input.readLong())
      }
    }
  }

  private fun store(records: List<VaultRecord>) {
    val buffer = ByteArrayOutputStream()
    DataOutputStream(buffer).use { output ->
      output.writeInt(MAGIC)
      output.writeInt(records.size)
      for (record in records) {
        output.writeUTF(record.id)
        output.writeUTF(record.name)
        output.writeUTF(record.location)
        output.writeLong(record.addedAt)
      }
    }
    Durable.write(file, buffer.toByteArray())
  }

  private companion object {
    /** "VLS1": the vault list format's version. */
    const val MAGIC = 0x564C5331
  }
}
