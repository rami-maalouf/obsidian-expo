package expo.modules.vault.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DraftJournalTest {
  @Test
  fun checkpointsAreOrderedAndDiscardKeepsNewerOnes(): Unit = TestVault().use { vault ->
    val journal = DraftJournal(File(vault.outside, "journal"))
    val first = DraftRecord("v1", "Note.md", FileRevision.of("a".utf8()), "draft 1".utf8(), 1, 10)
    journal.checkpoint(first)
    assertEquals(first, journal.load("v1", "Note.md"))
    assertFailsWith<DraftJournalException.StaleCheckpoint> { journal.checkpoint(DraftRecord("v1", "Note.md", null, "old".utf8(), 1, 11)) }
    val second = DraftRecord("v1", "Note.md", null, byteArrayOf(0xC3.toByte(), 0x28), 2, 12)
    journal.checkpoint(second)
    assertContentEquals(second.contents, journal.load("v1", "Note.md")?.contents)
    assertFalse(journal.discard("v1", "Note.md", 1))
    assertTrue(journal.discard("v1", "Note.md", 2))
    assertNull(journal.load("v1", "Note.md"))
    assertFalse(journal.discard("v1", "Note.md", 2))
  }

  @Test
  fun listsDraftsAcrossVaultsAndReportsUnreadableFiles(): Unit = TestVault().use { vault ->
    val directory = File(vault.outside, "journal")
    val journal = DraftJournal(directory)
    journal.checkpoint(DraftRecord("v2", "B.md", null, "b".utf8(), 1, 0))
    journal.checkpoint(DraftRecord("v1", "Z.md", null, "z".utf8(), 1, 0))
    journal.checkpoint(DraftRecord("v1", "A.md", null, "a".utf8(), 1, 0))
    File(directory, "broken.draft").writeText("not a draft")
    val (drafts, unreadable) = journal.all()
    assertEquals(listOf("v1" to "A.md", "v1" to "Z.md", "v2" to "B.md"), drafts.map { it.vaultId to it.path })
    assertEquals(listOf("broken.draft"), unreadable)
    // no temporary files are left behind.
    assertTrue(directory.list()!!.none { it.endsWith(".tmp") })
  }
}

class AppDataStoreTest {
  @Test
  fun valuesAreStoredReplacedAndRemoved(): Unit = TestVault().use { vault ->
    val store = AppDataStore(File(vault.outside, "app-data"))
    assertNull(store.read("vault:1:daily-notes"))
    store.write("vault:1:daily-notes", """{"folder":"Daily"}""")
    store.write("vault:1:daily-notes", """{"folder":"Journal"}""")
    assertEquals("""{"folder":"Journal"}""", AppDataStore(File(vault.outside, "app-data")).read("vault:1:daily-notes"))
    store.write("vault:1:daily-notes", null)
    assertNull(store.read("vault:1:daily-notes"))
    store.write("missing", null)
  }
}

class VaultRegistryTest {
  @Test
  fun repickingAFolderKeepsItsId(): Unit = TestVault().use { vault ->
    var next = 0
    val file = File(vault.outside, "vaults.bin")
    val registry = VaultRegistry(file) { "id-${next++}" }
    val first = registry.add("content://tree/primary%3AVault", "Vault", now = 5)
    val other = registry.add("content://tree/primary%3AOther", "Other", now = 6)
    val again = registry.add("content://tree/primary%3AVault", "Vault renamed", now = 7)
    assertEquals(first.id, again.id)
    assertEquals("Vault renamed", again.name)
    assertEquals(5, again.addedAt)
    val reloaded = VaultRegistry(file)
    assertEquals(listOf(again, other), reloaded.records())
    reloaded.remove(first.id)
    assertNull(reloaded.find(first.id))
    assertEquals(other, reloaded.find(other.id))
  }
}

class VaultSessionTest {
  @Test
  fun aClosedSessionRefusesNewOperations(): Unit = TestVault().use { vault ->
    val session = VaultSession("v1", vault.files)
    assertEquals(FileState.Absent, session.perform { it.state("Note.md") })
    session.close()
    assertFailsWith<VaultClosedException> { session.perform { it.state("Note.md") } }
  }
}
