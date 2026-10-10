package expo.modules.vault.core

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/** how a file's bytes map to editable text (r2). */
sealed class DecodedText {
  /** valid utf-8. `encode` reproduces the original bytes exactly, including the bom. */
  data class Editable(val text: String, val bom: Boolean) : DecodedText()

  /** not valid utf-8. shown read-only; it can never be saved back through a lossy conversion. */
  data class ReadOnly(val preview: String, val encoding: String) : DecodedText()
}

object TextCodec {
  private val utf8Bom = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())

  fun decode(bytes: ByteArray): DecodedText {
    val bom = bytes.startsWith(utf8Bom)
    val offset = if (bom) utf8Bom.size else 0
    // the strict decoder reports malformed input instead of replacing it, and the round trip
    // confirms that saving the text writes the same bytes.
    val strict = Charsets.UTF_8.newDecoder()
      .onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT)
    try {
      val text = strict.decode(ByteBuffer.wrap(bytes, offset, bytes.size - offset)).toString()
      if (text.toByteArray(Charsets.UTF_8).contentEquals(bytes.copyOfRange(offset, bytes.size))) {
        return DecodedText.Editable(text, bom)
      }
    } catch (_: CharacterCodingException) {
      // not utf-8; shown read-only below.
    }
    if (bytes.startsWith(byteArrayOf(0xFF.toByte(), 0xFE.toByte())) || bytes.startsWith(byteArrayOf(0xFE.toByte(), 0xFF.toByte()))) {
      return DecodedText.ReadOnly(String(bytes, Charsets.UTF_16), "utf-16")
    }
    // invalid bytes become U+FFFD in the preview only.
    return DecodedText.ReadOnly(String(bytes, Charsets.UTF_8), "unknown")
  }

  fun encode(text: String, bom: Boolean): ByteArray {
    val body = text.toByteArray(Charsets.UTF_8)
    return if (bom) utf8Bom + body else body
  }

  private fun ByteArray.startsWith(prefix: ByteArray): Boolean =
    size >= prefix.size && prefix.indices.all { this[it] == prefix[it] }
}
