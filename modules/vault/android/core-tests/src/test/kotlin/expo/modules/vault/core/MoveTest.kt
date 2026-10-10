package expo.modules.vault.core

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs

/** renaming a note in its folder; the ios core's move tests, where android behaves the same. */
class MoveTest {
  private val crlfWithBom = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + "# Note\r\nline\r\n".utf8()

  @Test
  fun renameKeepsTheExactBytes(): Unit = TestVault().use { vault ->
    vault.write("Notes/Old.md", crlfWithBom)
    assertEquals(MoveResult.Moved, vault.files.move("Notes/Old.md", "Notes/New name.md"))
    assertFalse(vault.exists("Notes/Old.md"))
    assertContentEquals(crlfWithBom, vault.bytes("Notes/New name.md"))
  }

  @Test
  fun neverReplacesAnotherFile(): Unit = TestVault().use { vault ->
    vault.write("A.md", "a")
    vault.write("B.md", "b")
    assertEquals(MoveResult.Exists, vault.files.move("A.md", "B.md"))
    assertContentEquals("a".utf8(), vault.bytes("A.md"))
    assertContentEquals("b".utf8(), vault.bytes("B.md"))
  }

  @Test
  fun aNameThatDiffersFromAnotherOnlyInCaseIsRefused(): Unit = TestVault().use { vault ->
    vault.write("A.md", "a")
    vault.write("b.md", "b")
    assertIs<MoveResult.Unavailable>(vault.files.move("A.md", "B.md"))
    assertContentEquals("a".utf8(), vault.bytes("A.md"))
    assertContentEquals("b".utf8(), vault.bytes("b.md"))
  }

  @Test
  fun missingAndUnreadableFilesDoNotMove(): Unit = TestVault().use { vault ->
    assertEquals(MoveResult.Missing, vault.files.move("Missing.md", "Found.md"))
    assertEquals(MoveResult.Missing, vault.files.move("Gone/Missing.md", "Gone/Found.md"))
    vault.write("Cloud.md", "x")
    // a provider's virtual document lists without readable bytes, like an icloud placeholder.
    val virtual = object : DocumentTree by vault.tree {
      override fun list(folderId: String) = vault.tree.list(folderId).map { it.copy(readable = false) }
    }
    assertEquals(MoveResult.Unavailable(FileState.Placeholder), VaultFiles(virtual).move("Cloud.md", "Moved.md"))
    assertFalse(vault.exists("Found.md"))
    assertFalse(vault.exists("Moved.md"))
  }

  @Test
  fun changesOnlyTheCaseOfAName(): Unit = TestVault().use { vault ->
    vault.write("Notes/meeting.md", "x")
    assertEquals(MoveResult.Moved, vault.files.move("Notes/meeting.md", "Notes/Meeting.md"))
    assertEquals(listOf("Meeting.md"), vault.file("Notes").list()!!.toList())
    assertContentEquals("x".utf8(), vault.bytes("Notes/Meeting.md"))
  }

  @Test
  fun aChangeOfCaseWorksWhereTheTreeIgnoresCase(): Unit = TestVault().use { vault ->
    vault.write("Notes/meeting.md", "x")
    // like a provider that ignores case: a name that matches any item in the folder is taken.
    val ignoringCase = object : DocumentTree by vault.tree {
      override fun rename(id: String, name: String): TreeEntry? {
        val folder = id.substringBeforeLast('/', "")
        if (vault.tree.list(folder).any { it.name.equals(name, ignoreCase = true) }) return null
        return vault.tree.rename(id, name)
      }
    }
    assertEquals(MoveResult.Moved, VaultFiles(ignoringCase).move("Notes/meeting.md", "Notes/Meeting.md"))
    assertEquals(listOf("Meeting.md"), vault.file("Notes").list()!!.toList())
  }

  @Test
  fun aNameTheTreeDoesNotGiveKeepsTheOldName(): Unit = TestVault().use { vault ->
    vault.write("Note.md", "x")
    val refusing = object : DocumentTree by vault.tree {
      override fun rename(id: String, name: String): TreeEntry? = null
    }
    assertIs<MoveResult.Unavailable>(VaultFiles(refusing).move("Note.md", "Other.md"))
    assertIs<MoveResult.Unavailable>(VaultFiles(refusing).move("Note.md", "NOTE.md"))
    assertEquals(listOf("Note.md"), vault.directory.list()!!.toList())
  }

  @Test
  fun aFailedChangeOfCaseRestoresTheOldName(): Unit = TestVault().use { vault ->
    vault.write("note.md", "x")
    // the temporary name is accepted, the final name is not.
    val halfway = object : DocumentTree by vault.tree {
      override fun rename(id: String, name: String): TreeEntry? = if (name == "Note.md") null else vault.tree.rename(id, name)
    }
    assertIs<MoveResult.Unavailable>(VaultFiles(halfway).move("note.md", "Note.md"))
    assertEquals(listOf("note.md"), vault.directory.list()!!.toList())
  }

  @Test
  fun staysInItsFolder(): Unit = TestVault().use { vault ->
    vault.write("Note.md", "x")
    assertIs<MoveResult.Unavailable>(vault.files.move("Note.md", "Inbox/Note.md"))
    assertContentEquals("x".utf8(), vault.bytes("Note.md"))
    assertFalse(vault.exists("Inbox"))
  }

  @Test
  fun refusesPathsOutsideTheVaultOrHidden(): Unit = TestVault().use { vault ->
    vault.write("Note.md", "x")
    assertFailsWith<VaultPathException> { vault.files.move("Note.md", "../Note.md") }
    assertFailsWith<VaultPathException> { vault.files.move("Note.md", ".obsidian/Note.md") }
    assertFailsWith<VaultPathException> { vault.files.move("Note.md", ".Note.md") }
    assertContentEquals("x".utf8(), vault.bytes("Note.md"))
  }
}
