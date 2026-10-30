import Foundation

/// a disposable, app-private vault for the dedicated explore simulator build only.
public enum ExploreFixture {
  public static func prepare(
    in documents: URL,
    appIdentifier: String?,
    isSimulator: Bool,
    welcome: () throws -> Data
  ) throws -> URL? {
    guard isSimulator, appIdentifier == "com.ramimaalouf.obsidianexpo.explore" else { return nil }
    let folder = documents.appendingPathComponent("expo-explore", isDirectory: true)
    let note = folder.appendingPathComponent("Welcome.md")
    if !FileManager.default.fileExists(atPath: note.path) {
      let bytes = try welcome()
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      try bytes.write(to: note, options: .withoutOverwriting)
    }
    return folder
  }
}
