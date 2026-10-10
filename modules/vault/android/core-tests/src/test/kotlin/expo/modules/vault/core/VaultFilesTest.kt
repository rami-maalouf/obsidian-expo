package expo.modules.vault.core

import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class VaultFilesTest {
  @Test
  fun statesOfFilesFoldersAndAbsence(): Unit = TestVault().use { vault ->
    vault.write("Daily/2026-10-08.md", "x")
    assertEquals(FileState.Readable, vault.files.state("Daily/2026-10-08.md"))
    assertEquals(FileState.Absent, vault.files.state("Daily/2026-10-09.md"))
    assertEquals(FileState.Absent, vault.files.state("Missing/deeper/note.md"))
    assertIs<FileState.Unknown>(vault.files.state("Daily"))
    assertIs<FileState.Unknown>(vault.files.state("Daily/2026-10-08.md/child.md"))
  }

  @Test
  fun aNameThatDiffersOnlyInCaseOrAccentsIsNeverAbsent(): Unit = TestVault().use { vault ->
    vault.write("Daily/Note.md", "x")
    vault.write("Résumé.md", "x")
    assertIs<FileState.Unknown>(vault.files.state("daily/Note.md"))
    assertIs<FileState.Unknown>(vault.files.state("Daily/note.md"))
    assertIs<FileState.Unknown>(vault.files.state("Résumé.md"))
    assertIs<CreateResult.Unavailable>(vault.files.createExclusive("Daily/NOTE.md", "y".utf8()))
    assertContentEquals("x".utf8(), vault.bytes("Daily/Note.md"))
  }

  @Test
  fun anUnlistableFolderIsUnknown(): Unit = TestVault().use { vault ->
    vault.write("Locked/note.md", "x")
    val locked = vault.file("Locked")
    assertTrue(locked.setReadable(false))
    try {
      if (locked.list() != null) return@use // running as root: permissions are not enforced.
      assertIs<FileState.Unknown>(vault.files.state("Locked/other.md"))
      assertEquals(listOf("Locked"), vault.files.enumerateNotes().unreadableFolders)
    } finally {
      locked.setReadable(true)
    }
  }

  @Test
  fun readsExactBytes(): Unit = TestVault().use { vault ->
    val bytes = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + "a\r\nb\rc".utf8()
    vault.write("Note.md", bytes)
    val read = vault.files.read("Note.md") as ReadResult.Contents
    assertContentEquals(bytes, read.bytes)
    assertEquals(FileRevision.of(bytes), read.revision)
    assertEquals(ReadResult.Unavailable(FileState.Absent), vault.files.read("Other.md"))
  }

  @Test
  fun createsFoldersAndNeverReplaces(): Unit = TestVault().use { vault ->
    val created = vault.files.createExclusive("Daily/2026/2026-10-08.md", "# Today\n".utf8())
    assertEquals(CreateResult.Created(FileRevision.of("# Today\n".utf8())), created)
    assertContentEquals("# Today\n".utf8(), vault.bytes("Daily/2026/2026-10-08.md"))
    assertEquals(CreateResult.Exists, vault.files.createExclusive("Daily/2026/2026-10-08.md", "other".utf8()))
    assertContentEquals("# Today\n".utf8(), vault.bytes("Daily/2026/2026-10-08.md"))
    vault.write("File.md", "x")
    assertIs<CreateResult.Unavailable>(vault.files.createExclusive("File.md/child.md", "y".utf8()))
  }

  @Test
  fun concurrentCreatesMakeOneFile(): Unit = TestVault().use { vault ->
    // separate VaultFiles share no lock, as two processes would not.
    val writers = 16
    val start = CountDownLatch(1)
    val pool = Executors.newFixedThreadPool(writers)
    val results = (0 until writers).map { index ->
      pool.submit<CreateResult> {
        start.await()
        VaultFiles(FileDocumentTree(vault.directory)).createExclusive("Daily/race.md", "writer $index".utf8())
      }
    }
    start.countDown()
    val outcomes = results.map { it.get(30, TimeUnit.SECONDS) }
    pool.shutdown()
    val winners = outcomes.filterIsInstance<CreateResult.Created>()
    assertEquals(1, winners.size, "outcomes: $outcomes")
    assertTrue(outcomes.all { it is CreateResult.Created || it == CreateResult.Exists })
    assertEquals(winners.single().revision, FileRevision.of(vault.bytes("Daily/race.md")))
  }

  @Test
  fun savesOnlyOverTheBaseRevision(): Unit = TestVault().use { vault ->
    vault.write("Note.md", "v1")
    val v1 = FileRevision.of("v1".utf8())
    assertEquals(SaveResult.Saved(FileRevision.of("v2".utf8())), vault.files.save("Note.md", "v2".utf8(), v1))
    assertContentEquals("v2".utf8(), vault.bytes("Note.md"))
    // a shorter text truncates the file.
    assertEquals(SaveResult.Saved(FileRevision.of("x".utf8())), vault.files.save("Note.md", "x".utf8(), FileRevision.of("v2".utf8())))
    assertContentEquals("x".utf8(), vault.bytes("Note.md"))
    // a stale base is a conflict and writes nothing.
    assertEquals(SaveResult.Conflict(FileRevision.of("x".utf8())), vault.files.save("Note.md", "v3".utf8(), v1))
    assertContentEquals("x".utf8(), vault.bytes("Note.md"))
  }

  @Test
  fun aDeletedOrRenamedTargetIsMissingAndNotRecreated(): Unit = TestVault().use { vault ->
    vault.write("Note.md", "v1")
    assertTrue(vault.file("Note.md").renameTo(vault.file("Renamed.md")))
    assertEquals(SaveResult.Missing, vault.files.save("Note.md", "v2".utf8(), FileRevision.of("v1".utf8())))
    assertFalse(vault.exists("Note.md"))
  }

  @Test
  fun aFolderAtTheTargetIsUnavailable(): Unit = TestVault().use { vault ->
    vault.file("Note.md").mkdirs()
    assertIs<SaveResult.Unavailable>(vault.files.save("Note.md", "v2".utf8(), FileRevision.of("v1".utf8())))
  }

  @Test
  fun symlinksAreNotFollowed(): Unit = TestVault().use { vault ->
    val elsewhere = File(vault.outside, "elsewhere").apply { mkdirs() }
    File(elsewhere, "secret.md").writeText("secret")
    Files.createSymbolicLink(vault.file("Linked").toPath(), elsewhere.toPath())
    Files.createSymbolicLink(vault.file("link.md").toPath(), File(elsewhere, "secret.md").toPath())
    assertEquals(FileState.Absent, vault.files.state("Linked/secret.md"))
    assertEquals(FileState.Absent, vault.files.state("link.md"))
    // creating through the link's name finds the link and refuses to replace or follow it.
    val result = vault.files.createExclusive("Linked/new.md", "x".utf8())
    assertFalse(File(elsewhere, "new.md").exists(), "result: $result")
    assertTrue(vault.files.enumerateNotes().notes.none { it.path.startsWith("Linked") || it.path == "link.md" })
  }

  @Test
  fun enumerationListsMarkdownAndSkipsHiddenItems(): Unit = TestVault().use { vault ->
    vault.write("Welcome.md", "a")
    vault.write("Daily/2026-10-08.md", "bb")
    vault.write("Upper.MD", "c")
    vault.write("image.png", "d")
    vault.write(".obsidian/app.md", "e")
    vault.write("Notes/.hidden.md", "f")
    vault.write(".md", "g")
    val listing = vault.files.enumerateNotes()
    assertEquals(listOf("Daily/2026-10-08.md", "Upper.MD", "Welcome.md"), listing.notes.map { it.path }.sorted())
    assertEquals(2L, listing.notes.first { it.path == "Daily/2026-10-08.md" }.size)
    assertTrue(listing.notes.all { it.modified != null && !it.placeholder })
    assertEquals(emptyList(), listing.unreadableFolders)
  }

  @Test
  fun aWriteThatDoesNotReadBackIsAnError(): Unit = TestVault().use { vault ->
    vault.write("Note.md", "v1")
    val dropping = object : DocumentTree by vault.tree {
      override fun write(id: String, bytes: ByteArray) = vault.tree.write(id, bytes.copyOf(bytes.size - 1))
    }
    val files = VaultFiles(dropping)
    val error = runCatching { files.save("Note.md", "v2 longer".utf8(), FileRevision.of("v1".utf8())) }.exceptionOrNull()
    assertIs<VaultFileException>(error)
    assertIs<VaultFileException>(runCatching { files.createExclusive("New.md", "text".utf8()) }.exceptionOrNull())
    // the partial note this call created is removed.
    assertFalse(vault.exists("New.md"))
  }
}
