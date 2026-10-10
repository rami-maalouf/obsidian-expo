package expo.modules.vault.core

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals

class TextCodecTest {
  private val bom = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())

  @Test
  fun utf8RoundTripsByteForByte() {
    for (bytes in listOf("plain\n".utf8(), "a\r\nb\rc\n".utf8(), "Résumé 😀".utf8(), ByteArray(0), bom + "# BOM\n".utf8())) {
      val decoded = TextCodec.decode(bytes) as DecodedText.Editable
      assertContentEquals(bytes, TextCodec.encode(decoded.text, decoded.bom))
    }
    assertEquals(DecodedText.Editable("# BOM\n", bom = true), TextCodec.decode(bom + "# BOM\n".utf8()))
  }

  @Test
  fun nfdIsNotNormalized() {
    val nfd = "Résumé"
    assertEquals(DecodedText.Editable(nfd, bom = false), TextCodec.decode(nfd.utf8()))
  }

  @Test
  fun otherEncodingsAreReadOnly() {
    val latin1 = byteArrayOf(0x43, 0x61, 0x66, 0xE9.toByte(), 0x0A)
    assertEquals("unknown", (TextCodec.decode(latin1) as DecodedText.ReadOnly).encoding)
    val utf16 = byteArrayOf(0xFF.toByte(), 0xFE.toByte(), 0x41, 0x00, 0x0A, 0x00)
    assertEquals(DecodedText.ReadOnly("A\n", "utf-16"), TextCodec.decode(utf16))
    // an encoded surrogate (cesu-8) is not utf-8.
    val cesu = byteArrayOf(0xED.toByte(), 0xA0.toByte(), 0x80.toByte())
    assertEquals("unknown", (TextCodec.decode(cesu) as DecodedText.ReadOnly).encoding)
  }
}
