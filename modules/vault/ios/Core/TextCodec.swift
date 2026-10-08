import Foundation

/// how a file's bytes map to editable text (r2).
public enum DecodedText: Equatable, Sendable {
  /// valid utf-8. `encode` reproduces the original bytes exactly, including the bom.
  case editable(text: String, bom: Bool)
  /// not valid utf-8. shown read-only; it can never be saved back through a lossy conversion.
  case readOnly(preview: String, encoding: String)
}

public enum TextCodec {
  static let utf8Bom: [UInt8] = [0xEF, 0xBB, 0xBF]

  public static func decode(_ data: Data) -> DecodedText {
    let bom = data.starts(with: utf8Bom)
    let body = bom ? data.dropFirst(utf8Bom.count) : data[...]
    // the stdlib decoder never strips a bom or normalizes; invalid bytes become U+FFFD, which
    // the byte comparison detects.
    let text = String(decoding: body, as: UTF8.self)
    if Data(text.utf8) == body {
      return .editable(text: text, bom: bom)
    }
    if data.starts(with: [0xFF, 0xFE]) || data.starts(with: [0xFE, 0xFF]), let text = String(data: data, encoding: .utf16) {
      return .readOnly(preview: text, encoding: "utf-16")
    }
    // invalid bytes become U+FFFD in the preview only.
    return .readOnly(preview: String(decoding: data, as: UTF8.self), encoding: "unknown")
  }

  public static func encode(_ text: String, bom: Bool) -> Data {
    (bom ? Data(utf8Bom) : Data()) + Data(text.utf8)
  }
}
