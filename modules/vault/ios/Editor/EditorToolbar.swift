import SwiftUI
import UIKit

/// the editing toolbar's buttons, in order (t17).
enum EditorToolbarAction: String, CaseIterable, Identifiable {
  case undo, redo, outdent, indent, task, link, tag, bold, italic, hideKeyboard

  var id: String { rawValue }

  var symbol: String {
    switch self {
    case .undo: return "arrow.uturn.backward"
    case .redo: return "arrow.uturn.forward"
    case .outdent: return "decrease.indent"
    case .indent: return "increase.indent"
    case .task: return "checklist"
    case .link: return "link"
    case .tag: return "number"
    case .bold: return "bold"
    case .italic: return "italic"
    case .hideKeyboard: return "keyboard.chevron.compact.down"
    }
  }

  var label: String {
    switch self {
    case .undo: return "Undo"
    case .redo: return "Redo"
    case .outdent: return "Outdent"
    case .indent: return "Indent"
    case .task: return "Task"
    case .link: return "Link"
    case .tag: return "Tag"
    case .bold: return "Bold"
    case .italic: return "Italic"
    case .hideKeyboard: return "Hide Keyboard"
    }
  }
}

/// whether undo and redo can run; the editor updates it as the text and its undo stack change.
@MainActor
final class EditorToolbarState: ObservableObject {
  @Published var canUndo = false
  @Published var canRedo = false
}

/// the row above the keyboard: one glass capsule of buttons that scrolls sideways when it is
/// wider than the screen. it is the text view's `inputAccessoryView`, so UIKit keeps it on the
/// keyboard, and laperm adds its height to the text's bottom inset.
struct EditorToolbarView: View {
  @ObservedObject var state: EditorToolbarState
  let perform: (EditorToolbarAction) -> Void

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 2) {
        ForEach(EditorToolbarAction.allCases) { action in
          Button {
            perform(action)
          } label: {
            Image(systemName: action.symbol)
              .font(.body.weight(.medium))
              .frame(width: 44, height: 44)
              .contentShape(.rect)
          }
          .buttonStyle(.plain)
          .foregroundStyle(isEnabled(action) ? Color.primary : Color.secondary.opacity(0.5))
          .disabled(!isEnabled(action))
          .accessibilityLabel(action.label)
          .accessibilityIdentifier("toolbar-\(action.rawValue)")
        }
      }
      .padding(.horizontal, 8)
    }
    .frame(height: 48)
    .clipShape(.capsule)
    .glassEffect(.regular, in: .capsule)
    .padding(.horizontal, 8)
    .padding(.bottom, 6)
    .frame(maxWidth: .infinity)
  }

  private func isEnabled(_ action: EditorToolbarAction) -> Bool {
    switch action {
    case .undo: return state.canUndo
    case .redo: return state.canRedo
    default: return true
    }
  }
}
