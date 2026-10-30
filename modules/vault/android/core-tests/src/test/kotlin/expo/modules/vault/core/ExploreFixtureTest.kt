package expo.modules.vault.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class ExploreFixtureTest {
  @Test
  fun onlyExploreEmulatorBuildsCreateTheFixture(): Unit = TestVault().use { vault ->
    for ((identifier, emulator) in listOf(
      "com.ramimaalouf.obsidianexpo" to true,
      "com.ramimaalouf.obsidianexpo.preview" to true,
      "com.ramimaalouf.obsidianexpo.dev" to true,
      "com.ramimaalouf.obsidianexpo.explore" to false,
    )) {
      assertNull(ExploreFixture.prepare(vault.outside, identifier, emulator) {
        error("disabled builds must not read fixture resources")
      })
      assertFalse(File(vault.outside, "expo-explore").exists())
    }
  }

  @Test
  fun initializesOnlyItsOwnFolderAndPreservesLaterEdits(): Unit = TestVault().use { vault ->
    vault.write("Personal.md", "untouched")
    val folder = assertNotNull(ExploreFixture.prepare(vault.outside,
      "com.ramimaalouf.obsidianexpo.explore", true) { "# Welcome\n".utf8() })
    assertEquals(File(vault.outside, "expo-explore"), folder)
    val note = File(folder, "Welcome.md")
    assertContentEquals("# Welcome\n".utf8(), note.readBytes())
    note.writeText("edited in capture")
    ExploreFixture.prepare(vault.outside, "com.ramimaalouf.obsidianexpo.explore", true) { "replacement".utf8() }
    assertEquals("edited in capture", note.readText())
    assertContentEquals("untouched".utf8(), vault.bytes("Personal.md"))
  }
}
