import ExpoModulesCore

/// javascript binding for the vault core. it stays thin: validation and file rules live in Core/.
public class VaultModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Vault")

    Constant("coreVersion") {
      VaultCoreInfo.version
    }

    // returns nil for a valid vault-relative path, or the reason it is refused.
    Function("checkRelativePath") { (path: String) -> String? in
      do {
        _ = try VaultRoot.segments(of: path)
        return nil
      } catch {
        return String(describing: error)
      }
    }
  }
}
