package expo.modules.vault.core

import java.io.File
import java.util.Collections
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** a vault, a journal, and a factory for document sessions that share them. */
class DocumentHarness : AutoCloseable {
  val vault = TestVault()
  val session = VaultSession("v1", vault.files)
  val journalDirectory = File(vault.outside, "journal")
  val journal = DraftJournal(journalDirectory)
  private val opened = ArrayList<DocumentSession>()

  fun open(path: String, log: MutableList<DocumentStatus> = Collections.synchronizedList(ArrayList())): DocumentSession =
    DocumentSession("v1", path, session, journal, onStatus = { log.add(it) }).also { opened.add(it) }

  override fun close() {
    opened.forEach { it.close() }
    vault.close()
  }
}

class DocumentSessionTest {
  private val harness = DocumentHarness()
  private val vault = harness.vault
  private val bom = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())
  private val crlf = bom + "# Title\r\n\r\nbody\r\n".utf8()

  @AfterTest
  fun cleanUp() = harness.close()

  private fun loaded(outcome: LoadOutcome): LoadedDocument = (outcome as? LoadOutcome.Loaded)?.document ?: fail("expected a loaded document, got $outcome")

  @Test
  fun loadsTextBomAndNewlineConvention() {
    vault.write("Note.md", crlf)
    val document = harness.open("Note.md")
    val loaded = loaded(document.load())
    assertEquals("# Title\r\n\r\nbody\r\n", loaded.text)
    assertTrue(loaded.bom)
    assertEquals("\r\n", loaded.newline)
    assertEquals(FileRevision.of(crlf), loaded.revision)
    assertFalse(loaded.restoredDraft)
    assertEquals(DocumentStatus.Clean, document.status)
  }

  @Test
  fun editsAreCheckpointedThenSavedByteForByte() {
    vault.write("Note.md", crlf)
    val log = Collections.synchronizedList(ArrayList<DocumentStatus>())
    val document = harness.open("Note.md", log)
    document.load()
    document.update("# Title\r\n\r\nbody\r\nmore\r\n")
    document.persist()
    document.waitUntilIdle()
    assertContentEquals(bom + "# Title\r\n\r\nbody\r\nmore\r\n".utf8(), vault.bytes("Note.md"))
    assertEquals(DocumentStatus.Clean, document.status)
    assertEquals(listOf(DocumentStatus.Clean, DocumentStatus.Dirty, DocumentStatus.Journaled, DocumentStatus.Saving, DocumentStatus.Clean), log.toList())
    assertTrue(harness.journal.all().first.isEmpty())
  }

  @Test
  fun aDraftSurvivesAProcessRestartAndIsSavedLater() {
    vault.write("Note.md", "v1")
    // the first process journals an edit but stops before saving.
    harness.journal.checkpoint(DraftRecord("v1", "Note.md", FileRevision.of("v1".utf8()), "v1 + unsaved".utf8(), 3, 0))
    val document = harness.open("Note.md")
    val loaded = loaded(document.load())
    assertEquals("v1 + unsaved", loaded.text)
    assertTrue(loaded.restoredDraft)
    document.persist()
    document.waitUntilIdle()
    assertContentEquals("v1 + unsaved".utf8(), vault.bytes("Note.md"))
    assertTrue(harness.journal.all().first.isEmpty())
  }

  @Test
  fun aDraftWhoseFileChangedNeedsRecoveryAndKeepsBothVersions() {
    vault.write("Note.md", "changed elsewhere")
    val draft = DraftRecord("v1", "Note.md", FileRevision.of("original".utf8()), "my edit".utf8(), 1, 1_791_000_000_000)
    harness.journal.checkpoint(draft)
    assertEquals(LoadOutcome.RecoveryNeeded(draft, FileRevision.of("changed elsewhere".utf8())), harness.open("Note.md").load())
    assertContentEquals("changed elsewhere".utf8(), vault.bytes("Note.md"))
    assertEquals(draft, harness.journal.load("v1", "Note.md"))
  }

  @Test
  fun anExternalEditWhileDirtyIsAConflictAndWritesNothing() {
    vault.write("Note.md", "original")
    val document = harness.open("Note.md")
    document.load()
    vault.write("Note.md", "changed elsewhere")
    document.update("my edit")
    document.persist()
    document.waitUntilIdle()
    assertEquals(DocumentStatus.Conflict(FileRevision.of("changed elsewhere".utf8())), document.status)
    assertContentEquals("changed elsewhere".utf8(), vault.bytes("Note.md"))
    assertContentEquals("my edit".utf8(), harness.journal.load("v1", "Note.md")?.contents)
    // further edits stay in the journal while the conflict is open.
    document.update("my edit 2")
    document.persist()
    document.waitUntilIdle()
    assertContentEquals("changed elsewhere".utf8(), vault.bytes("Note.md"))
    assertContentEquals("my edit 2".utf8(), harness.journal.load("v1", "Note.md")?.contents)
  }

  private fun reconcile(document: DocumentSession): String? {
    val result = CompletableFuture<String?>()
    document.reconcile { result.complete(it) }
    return result.get(10, TimeUnit.SECONDS)
  }

  @Test
  fun aCleanDocumentFollowsAnExternalEditOnReconcile() {
    vault.write("Note.md", "original")
    val document = harness.open("Note.md")
    document.load()
    vault.write("Note.md", "from obsidian")
    assertEquals("from obsidian", reconcile(document))
    assertEquals(DocumentStatus.Clean, document.status)
    document.update("from obsidian + mine")
    document.persist()
    document.waitUntilIdle()
    assertContentEquals("from obsidian + mine".utf8(), vault.bytes("Note.md"))
  }

  @Test
  fun aDirtyDocumentDoesNotFollowAnExternalEdit() {
    vault.write("Note.md", "original")
    val document = harness.open("Note.md")
    document.load()
    document.update("unsaved")
    vault.write("Note.md", "from obsidian")
    assertNull(reconcile(document))
    assertEquals(DocumentStatus.Conflict(FileRevision.of("from obsidian".utf8())), document.status)
  }

  @Test
  fun aDeletedFileIsMissingAndTheDraftIsKept() {
    vault.write("Note.md", "original")
    val document = harness.open("Note.md")
    document.load()
    assertTrue(vault.file("Note.md").delete())
    document.update("edit")
    document.persist()
    document.waitUntilIdle()
    assertEquals(DocumentStatus.Missing, document.status)
    assertFalse(vault.exists("Note.md"))
    assertContentEquals("edit".utf8(), harness.journal.load("v1", "Note.md")?.contents)
  }

  @Test
  fun nonUtf8FilesAreReadOnlyAndNeverWritten() {
    val latin1 = byteArrayOf(0x43, 0x61, 0x66, 0xE9.toByte(), 0x0A)
    vault.write("Latin.md", latin1)
    val document = harness.open("Latin.md")
    assertEquals("unknown", assertIs<LoadOutcome.ReadOnly>(document.load()).encoding)
    document.update("Café\n")
    document.persist()
    document.waitUntilIdle()
    assertContentEquals(latin1, vault.bytes("Latin.md"))
    assertTrue(harness.journal.all().first.isEmpty())
  }

  @Test
  fun aFailedCheckpointIsReportedAndTheFileIsNotTouched() {
    vault.write("Note.md", "original")
    val document = harness.open("Note.md")
    document.load()
    // a file where the journal folder should be makes every checkpoint fail, even as root.
    val brokenJournal = DraftJournal(File(vault.outside, "broken-journal"))
    brokenJournal.directory.deleteRecursively()
    brokenJournal.directory.writeText("not a folder")
    val broken = DocumentSession("v1", "Note.md", harness.session, brokenJournal, onStatus = {})
    try {
      broken.load()
      broken.update("edit")
      broken.persist()
      broken.waitUntilIdle()
      assertIs<DocumentStatus.CheckpointFailed>(broken.status)
      assertContentEquals("original".utf8(), vault.bytes("Note.md"))
    } finally {
      broken.close()
    }
  }

  @Test
  fun aDraftForANewNoteIsCreatedNotOverwritten() {
    harness.journal.checkpoint(DraftRecord("v1", "New.md", null, "draft".utf8(), 1, 0))
    val document = harness.open("New.md")
    assertNull(loaded(document.load()).revision)
    // another app creates the note before our save.
    vault.write("New.md", "someone else")
    document.persist()
    document.waitUntilIdle()
    assertEquals(DocumentStatus.Conflict(null), document.status)
    assertContentEquals("someone else".utf8(), vault.bytes("New.md"))
  }

  @Test
  fun aDraftForANewNoteIsCreatedWhenStillAbsent() {
    harness.journal.checkpoint(DraftRecord("v1", "Folder/New.md", null, "draft".utf8(), 1, 0))
    val document = harness.open("Folder/New.md")
    loaded(document.load())
    document.persist()
    document.waitUntilIdle()
    assertEquals(DocumentStatus.Clean, document.status)
    assertContentEquals("draft".utf8(), vault.bytes("Folder/New.md"))
    assertTrue(harness.journal.all().first.isEmpty())
  }

  @Test
  fun newlineFollowsTheFirstLineBreak() {
    for ((text, expected) in listOf("one line" to "\n", "a\nb\r\nc" to "\n", "a\r\nb\nc" to "\r\n", "a\rb" to "\r", "ends with return\r" to "\r")) {
      assertEquals(expected, DocumentSession.newline(text), text)
    }
  }
}
