import UIKit

/// the ipados 26 menu bar (swipe down from the top, or hold command on a keyboard): app
/// commands with keyboard shortcuts. each command posts `VaultMenu.notification`; the module
/// forwards it to javascript, which runs the action.
enum VaultMenu {
  static let notification = Notification.Name("VaultMenuCommand")

  /// command names shared with `MenuCommand` in modules/vault/src/index.ts.
  enum Command: String {
    case newNote = "new-note"
    case today
    case back
    case forward
    case search
    case toggleFiles = "toggle-files"
    case toggleCalendar = "toggle-calendar"
    case settings
  }

  static func post(_ command: Command) {
    NotificationCenter.default.post(name: notification, object: nil, userInfo: ["command": command.rawValue])
  }

  @MainActor
  static func install() {
    guard #available(iOS 26.0, *) else {
      return
    }
    UIMainMenuSystem.shared.setBuildConfiguration(UIMainMenuSystem.Configuration()) { builder in
      let file = UIMenu(title: "", options: .displayInline, children: [
        UIKeyCommand(title: "New Note", action: #selector(UIApplication.vaultNewNote(_:)), input: "n", modifierFlags: .command),
        UIKeyCommand(title: "Note Settings…", action: #selector(UIApplication.vaultSettings(_:)), input: ",", modifierFlags: .command),
      ])
      builder.insertChild(file, atStartOfMenu: .file)

      let panels = UIMenu(title: "", options: .displayInline, children: [
        UIKeyCommand(title: "Files", action: #selector(UIApplication.vaultToggleFiles(_:)), input: "s", modifierFlags: [.command, .control]),
        UIKeyCommand(title: "Calendar", action: #selector(UIApplication.vaultToggleCalendar(_:)), input: "i", modifierFlags: [.command, .alternate]),
      ])
      builder.insertChild(panels, atStartOfMenu: .view)

      let go = UIMenu(title: "Go", identifier: UIMenu.Identifier("com.ramimaalouf.obsidianexpo.go"), children: [
        UIKeyCommand(title: "Back", action: #selector(UIApplication.vaultBack(_:)), input: "[", modifierFlags: .command),
        UIKeyCommand(title: "Forward", action: #selector(UIApplication.vaultForward(_:)), input: "]", modifierFlags: .command),
        UIKeyCommand(title: "Today's Note", action: #selector(UIApplication.vaultToday(_:)), input: "t", modifierFlags: .command),
        UIKeyCommand(title: "Search Notes", action: #selector(UIApplication.vaultSearch(_:)), input: "f", modifierFlags: [.command, .shift]),
      ])
      builder.insertSibling(go, afterMenu: .view)
    }
  }
}

/// the application is always in the responder chain, so these commands stay enabled whichever
/// view has focus.
extension UIApplication {
  @objc func vaultNewNote(_ sender: Any?) { VaultMenu.post(.newNote) }
  @objc func vaultSettings(_ sender: Any?) { VaultMenu.post(.settings) }
  @objc func vaultToggleFiles(_ sender: Any?) { VaultMenu.post(.toggleFiles) }
  @objc func vaultToggleCalendar(_ sender: Any?) { VaultMenu.post(.toggleCalendar) }
  @objc func vaultToday(_ sender: Any?) { VaultMenu.post(.today) }
  @objc func vaultBack(_ sender: Any?) { VaultMenu.post(.back) }
  @objc func vaultForward(_ sender: Any?) { VaultMenu.post(.forward) }
  @objc func vaultSearch(_ sender: Any?) { VaultMenu.post(.search) }
}
