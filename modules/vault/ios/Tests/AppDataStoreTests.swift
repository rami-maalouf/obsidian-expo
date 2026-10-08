import Foundation
import Testing

@testable import VaultCore

@Suite struct AppDataStoreTests {
  @Test func readWriteReplaceAndRemove() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("app-data-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = AppDataStore(directory: directory)
    #expect(try store.read("vault:a:bookmarks") == nil)
    try store.write("vault:a:bookmarks", #"{"version":1,"items":[]}"#)
    try store.write("vault:b:bookmarks", "café ✓")
    #expect(try store.read("vault:a:bookmarks") == #"{"version":1,"items":[]}"#)
    #expect(try store.read("vault:b:bookmarks") == "café ✓")
    try store.write("vault:a:bookmarks", "replaced")
    #expect(try store.read("vault:a:bookmarks") == "replaced")
    try store.write("vault:a:bookmarks", nil)
    #expect(try store.read("vault:a:bookmarks") == nil)
    #expect(try store.read("vault:b:bookmarks") == "café ✓")
  }
}
