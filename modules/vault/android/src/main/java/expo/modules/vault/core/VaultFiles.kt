package expo.modules.vault.core

import java.io.IOException
import java.text.Normalizer
import java.util.Locale

sealed class ReadResult {
  class Contents(val bytes: ByteArray, val revision: FileRevision) : ReadResult()

  data class Unavailable(val state: FileState) : ReadResult()
}

sealed class CreateResult {
  data class Created(val revision: FileRevision) : CreateResult()

  /** a document already exists; nothing was written. */
  data object Exists : CreateResult()

  data class Unavailable(val state: FileState) : CreateResult()
}

sealed class SaveResult {
  data class Saved(val revision: FileRevision) : SaveResult()

  /** the file no longer matches the base revision; nothing was written. */
  data class Conflict(val current: FileRevision) : SaveResult()

  /** the file was deleted; it is never recreated silently. */
  data object Missing : SaveResult()

  data class Unavailable(val state: FileState) : SaveResult()
}

sealed class MoveResult {
  data object Moved : MoveResult()

  /** another file already has the new name; nothing moved. */
  data object Exists : MoveResult()

  /** the file to move is gone. */
  data object Missing : MoveResult()

  data class Unavailable(val state: FileState) : MoveResult()
}

class VaultFileException(message: String) : IOException(message)

/** a markdown file found by enumeration. contents are not read. */
data class VaultEntry(
  val path: String,
  val size: Long?,
  val modified: Long?,
  /** true when the tree lists the file but cannot read its bytes here. */
  val placeholder: Boolean,
)

data class Enumeration(
  val notes: List<VaultEntry>,
  /** vault-relative folders that could not be listed; results are incomplete when non-empty. */
  val unreadableFolders: List<String>,
)

/**
 * file operations on vault-relative paths. android has no file coordinator, so mutations are
 * serialized inside this process, and every save rereads the file and compares its revision
 * right before writing. callers run these off the main thread.
 */
class VaultFiles(val tree: DocumentTree) {
  private val lock = Any()

  private sealed class Lookup {
    data class Found(val entry: TreeEntry) : Lookup()

    data object Absent : Lookup()

    data class Unknown(val reason: String) : Lookup()
  }

  fun state(path: String): FileState = when (val found = lookup(VaultPath.segments(path))) {
    is Lookup.Found -> stateOf(found.entry)
    Lookup.Absent -> FileState.Absent
    is Lookup.Unknown -> FileState.Unknown(found.reason)
  }

  fun read(path: String): ReadResult = synchronized(lock) {
    when (val found = lookup(VaultPath.segments(path))) {
      Lookup.Absent -> ReadResult.Unavailable(FileState.Absent)
      is Lookup.Unknown -> ReadResult.Unavailable(FileState.Unknown(found.reason))
      is Lookup.Found -> {
        val state = stateOf(found.entry)
        if (state != FileState.Readable) {
          ReadResult.Unavailable(state)
        } else {
          val bytes = tree.read(found.entry.id)
          ReadResult.Contents(bytes, FileRevision.of(bytes))
        }
      }
    }
  }

  /** creates a new file and any missing parent folders, never replacing an existing file. */
  fun createExclusive(path: String, bytes: ByteArray): CreateResult = synchronized(lock) {
    val segments = VaultPath.segments(path)
    var folder = tree.rootId
    for (name in segments.dropLast(1)) {
      val children = listOrNull(folder) ?: return CreateResult.Unavailable(FileState.Unknown("the folder for $name cannot be listed"))
      val existing = children.firstOrNull { it.name == name }
      folder = when {
        existing != null && existing.isDirectory -> existing.id
        existing != null -> return CreateResult.Unavailable(FileState.Unknown("$name is a file, not a folder"))
        children.any { similar(it.name, name) } -> return CreateResult.Unavailable(FileState.Unknown(similarReason(name)))
        // the folder can appear between the listing and the create; it is used, never replaced.
        else -> tree.createFolder(folder, name)?.id
          ?: listOrNull(folder)?.firstOrNull { it.name == name && it.isDirectory }?.id
          ?: return CreateResult.Unavailable(FileState.Unknown("the folder $name could not be created"))
      }
    }
    val name = segments.last()
    val children = listOrNull(folder) ?: return CreateResult.Unavailable(FileState.Unknown("the folder cannot be listed"))
    val existing = children.firstOrNull { it.name == name }
    if (existing != null) {
      return if (existing.isDirectory) CreateResult.Unavailable(FileState.Unknown("a folder exists at this path")) else CreateResult.Exists
    }
    if (children.any { similar(it.name, name) }) {
      return CreateResult.Unavailable(FileState.Unknown(similarReason(name)))
    }
    val created = tree.createFile(folder, name) ?: return CreateResult.Exists
    try {
      tree.write(created.id, bytes)
      if (!tree.read(created.id).contentEquals(bytes)) {
        throw VaultFileException("the new note did not read back as written")
      }
    } catch (error: Exception) {
      // the document is the one this call just created; remove it rather than leave it partial.
      runCatching { tree.delete(created.id) }
      throw error
    }
    CreateResult.Created(FileRevision.of(bytes))
  }

  /** replaces a file only if its current bytes still match [base] (persistence protocol). */
  fun save(path: String, bytes: ByteArray, base: FileRevision): SaveResult = synchronized(lock) {
    val entry = when (val found = lookup(VaultPath.segments(path))) {
      Lookup.Absent -> return SaveResult.Missing
      is Lookup.Unknown -> return SaveResult.Unavailable(FileState.Unknown(found.reason))
      is Lookup.Found -> found.entry
    }
    val state = stateOf(entry)
    if (state != FileState.Readable) {
      return SaveResult.Unavailable(state)
    }
    val current = FileRevision.of(tree.read(entry.id))
    if (current != base) {
      return SaveResult.Conflict(current)
    }
    val next = FileRevision.of(bytes)
    if (next != current) {
      tree.write(entry.id, bytes)
      // the write is in place, not atomic, so it is read back before reporting a save.
      if (FileRevision.of(tree.read(entry.id)) != next) {
        throw VaultFileException("the saved note did not read back as written")
      }
    }
    SaveResult.Saved(next)
  }

  /**
   * renames a file in its folder. another file is never replaced, and a name that differs from
   * another item's only in case or accents is refused, because android's shared storage can treat
   * those as one file. unlike ios, a file is not moved to another folder: the app only renames a
   * note where it is.
   */
  fun move(path: String, newPath: String): MoveResult = synchronized(lock) {
    val from = VaultPath.segments(path)
    val to = VaultPath.segments(newPath)
    if (from.dropLast(1) != to.dropLast(1)) {
      return MoveResult.Unavailable(FileState.Unknown("a note can be renamed only within its folder"))
    }
    val folderId = if (from.size == 1) {
      tree.rootId
    } else {
      when (val found = lookup(from.dropLast(1))) {
        is Lookup.Found -> found.entry.takeIf { it.isDirectory }?.id ?: return MoveResult.Unavailable(FileState.Unknown("the note's folder is a file"))
        Lookup.Absent -> return MoveResult.Missing
        is Lookup.Unknown -> return MoveResult.Unavailable(FileState.Unknown(found.reason))
      }
    }
    val children = listOrNull(folderId) ?: return MoveResult.Unavailable(FileState.Unknown("the note's folder cannot be listed"))
    val name = from.last()
    val newName = to.last()
    val source = children.firstOrNull { it.name == name }
      ?: return if (children.any { similar(it.name, name) }) MoveResult.Unavailable(FileState.Unknown(similarReason(name))) else MoveResult.Missing
    val state = stateOf(source)
    if (state != FileState.Readable) {
      return MoveResult.Unavailable(state)
    }
    if (newName == name) {
      return MoveResult.Moved
    }
    val others = children.filter { it.id != source.id }
    if (others.any { it.name == newName }) {
      return MoveResult.Exists
    }
    if (others.any { similar(it.name, newName) }) {
      return MoveResult.Unavailable(FileState.Unknown(similarReason(newName)))
    }
    if (!similar(name, newName)) {
      if (tree.rename(source.id, newName) != null) {
        return MoveResult.Moved
      }
      // the tree kept the old name; the new one was taken since the listing, or not accepted.
      return if (listOrNull(folderId)?.any { it.name == newName } == true) {
        MoveResult.Exists
      } else {
        MoveResult.Unavailable(FileState.Unknown("the storage provider did not accept the name $newName"))
      }
    }
    // a change of case or accents only goes through a temporary name: a provider that ignores
    // case sees the new name as taken by the file itself. the temporary name keeps the note
    // visible in the vault if the app stops in between.
    val dot = newName.lastIndexOf('.').takeIf { it > 0 } ?: newName.length
    val temporary = "${newName.substring(0, dot)} (renaming)${newName.substring(dot)}"
    if (others.any { similar(it.name, temporary) }) {
      return MoveResult.Unavailable(FileState.Unknown("$temporary is taken, so $name cannot be renamed"))
    }
    val moving = tree.rename(source.id, temporary)
      ?: return MoveResult.Unavailable(FileState.Unknown("the storage provider did not accept the name $temporary"))
    if (tree.rename(moving.id, newName) != null) {
      return MoveResult.Moved
    }
    if (tree.rename(moving.id, name) == null) {
      throw VaultFileException("the note was left as $temporary")
    }
    MoveResult.Unavailable(FileState.Unknown("the storage provider did not accept the name $newName"))
  }

  /**
   * lists markdown files without reading them, so file names are known before content indexing
   * (ktd4). hidden files and folders such as .obsidian are skipped.
   */
  fun enumerateNotes(): Enumeration {
    val notes = ArrayList<VaultEntry>()
    val unreadable = ArrayList<String>()
    val pending = ArrayDeque<Pair<String, String>>()
    pending.addLast(tree.rootId to "")
    while (pending.isNotEmpty()) {
      val (folderId, prefix) = pending.removeFirst()
      val children = listOrNull(folderId)
      if (children == null) {
        unreadable.add(prefix)
        continue
      }
      for (child in children) {
        if (child.name.startsWith(".")) {
          continue
        }
        val path = if (prefix.isEmpty()) child.name else "$prefix/${child.name}"
        if (child.isDirectory) {
          pending.addLast(child.id to path)
        } else if (child.name.lowercase(Locale.ROOT).endsWith(".md") && child.name.length > 3) {
          notes.add(VaultEntry(path, child.size, child.modified, placeholder = !child.readable))
        }
      }
    }
    return Enumeration(notes, unreadable.sorted())
  }

  // MARK: - helpers

  /**
   * walks the names from the root. absence is trusted only when every folder on the way was
   * listed completely and no name there differs from the wanted one only in case or accents,
   * because android's shared storage can treat those as the same file.
   */
  private fun lookup(segments: List<String>): Lookup {
    var folder = tree.rootId
    for ((index, name) in segments.withIndex()) {
      val children = listOrNull(folder) ?: return Lookup.Unknown("the folder ${segments.take(index).joinToString("/").ifEmpty { "at the top of the vault" }} cannot be listed")
      val entry = children.firstOrNull { it.name == name }
      if (entry == null) {
        return if (children.any { similar(it.name, name) }) Lookup.Unknown(similarReason(name)) else Lookup.Absent
      }
      if (index == segments.lastIndex) {
        return Lookup.Found(entry)
      }
      if (!entry.isDirectory) {
        return Lookup.Unknown("$name is a file, not a folder")
      }
      folder = entry.id
    }
    return Lookup.Absent
  }

  private fun stateOf(entry: TreeEntry): FileState = when {
    entry.isDirectory -> FileState.Unknown("a folder exists at this path")
    !entry.readable -> FileState.Placeholder
    else -> FileState.Readable
  }

  private fun listOrNull(folderId: String): List<TreeEntry>? = try {
    tree.list(folderId)
  } catch (_: Exception) {
    null
  }

  private fun similar(a: String, b: String): Boolean = fold(a) == fold(b)

  private fun similarReason(name: String) = "another item's name differs from $name only in case or accents"

  private fun fold(name: String): String = Normalizer.normalize(name, Normalizer.Form.NFC).lowercase(Locale.ROOT)
}
