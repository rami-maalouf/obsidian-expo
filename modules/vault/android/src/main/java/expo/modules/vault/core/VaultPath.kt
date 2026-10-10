package expo.modules.vault.core

/** reasons a vault-relative path is refused before any file access. */
sealed class VaultPathException(message: String) : Exception(message) {
  class Empty : VaultPathException("empty")
  class Absolute : VaultPathException("absolute")
  class InvalidSegment(val segment: String) : VaultPathException("invalidSegment(\"$segment\")")
  class HiddenSegment(val segment: String) : VaultPathException("hiddenSegment(\"$segment\")")
}

/**
 * vault-relative paths. javascript passes only these, never an absolute path or a uri; every
 * file operation walks them one name at a time from the vault's root folder.
 */
object VaultPath {
  /** splits and validates a vault-relative path such as `Daily/2026-10-08.md`. */
  fun segments(relativePath: String): List<String> {
    if (relativePath.isEmpty()) {
      throw VaultPathException.Empty()
    }
    if (relativePath.startsWith("/")) {
      throw VaultPathException.Absolute()
    }
    val segments = relativePath.split("/")
    for (segment in segments) {
      if (segment.isEmpty() || segment == "." || segment == ".." || segment.contains('\u0000')) {
        throw VaultPathException.InvalidSegment(segment)
      }
      // hidden items include .obsidian and .trash, which the app never modifies (r16).
      if (segment.startsWith(".")) {
        throw VaultPathException.HiddenSegment(segment)
      }
    }
    return segments
  }
}
