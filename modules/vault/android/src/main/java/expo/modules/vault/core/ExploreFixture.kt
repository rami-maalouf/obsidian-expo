package expo.modules.vault.core

import java.io.File

/** a disposable, app-private vault for the dedicated explore emulator build only. */
object ExploreFixture {
  fun prepare(base: File, appIdentifier: String, isEmulator: Boolean, welcome: () -> ByteArray): File? {
    if (!isEmulator || appIdentifier != "com.ramimaalouf.obsidianexpo.explore") return null
    val folder = File(base, "expo-explore")
    val note = File(folder, "Welcome.md")
    if (!note.exists()) {
      val bytes = welcome()
      check(folder.mkdirs() || folder.isDirectory) { "Could not create the Explore fixture folder." }
      if (note.createNewFile()) note.writeBytes(bytes)
    }
    return folder
  }
}
