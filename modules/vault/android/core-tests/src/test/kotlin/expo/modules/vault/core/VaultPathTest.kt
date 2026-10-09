package expo.modules.vault.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class VaultPathTest {
  @Test
  fun acceptsNestedRelativePaths() {
    assertEquals(listOf("Daily", "2026-10-08.md"), VaultPath.segments("Daily/2026-10-08.md"))
    assertEquals(listOf("Résumé.md"), VaultPath.segments("Résumé.md"))
  }

  @Test
  fun rejectsUnsafePaths() {
    assertFailsWith<VaultPathException.Empty> { VaultPath.segments("") }
    assertFailsWith<VaultPathException.Absolute> { VaultPath.segments("/etc/passwd") }
    for (path in listOf("../outside.md", "Daily/../../x.md", "./x.md", "a//b.md", "Daily/", "a/\u0000.md")) {
      assertFailsWith<VaultPathException.InvalidSegment>(path) { VaultPath.segments(path) }
    }
    assertEquals(".obsidian", assertFailsWith<VaultPathException.HiddenSegment> { VaultPath.segments(".obsidian/app.json") }.segment)
    assertEquals(".trash", assertFailsWith<VaultPathException.HiddenSegment> { VaultPath.segments("Notes/.trash/x.md") }.segment)
  }
}
