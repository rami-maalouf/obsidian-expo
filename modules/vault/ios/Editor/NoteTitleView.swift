import UIKit

/// the note's name above its text, as obsidian's inline title. the editor puts it in laperm's
/// `headerView`, which scrolls it with the text and lines it up with the text's margins. a long
/// name wraps. return moves to the text; when editing ends, the editor offers the typed name for
/// a rename. voiceover does not reach it inside the text view (decided October 10, 2026).
final class NoteTitleView: UIView, UITextViewDelegate {
  /// the height the header needs changed, for example when a long name wraps.
  var onHeightChange: ((CGFloat) -> Void)?
  /// return was pressed in the name.
  var onReturn: (() -> Void)?
  /// editing the name ended with this text.
  var onEndEditing: ((String) -> Void)?

  let field = UITextView()
  private var reportedHeight: CGFloat = 0
  /// space above the name, and between the name and the note's first line.
  private static let top: CGFloat = 16
  private static let bottom: CGFloat = 12

  init() {
    super.init(frame: .zero)
    field.isScrollEnabled = false
    field.backgroundColor = .clear
    // the name starts where the note's lines start.
    field.textContainerInset = .zero
    field.textContainer.lineFragmentPadding = 0
    field.textColor = .label
    field.returnKeyType = .next
    // a file name is kept as typed.
    field.autocorrectionType = .no
    field.smartQuotesType = .no
    field.smartDashesType = .no
    field.smartInsertDeleteType = .no
    field.isEditable = false
    field.accessibilityIdentifier = "note-title"
    // the editing toolbar edits the note's text. without an accessory of its own, the name would
    // show the text view's toolbar, which uikit finds up the responder chain.
    field.inputAccessoryView = UIView(frame: .zero)
    field.delegate = self
    addSubview(field)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  var font: UIFont? {
    get { field.font }
    set {
      field.font = newValue
      setNeedsLayout()
    }
  }

  var text: String {
    get { field.text }
    set {
      guard field.text != newValue else { return }
      field.text = newValue
      setNeedsLayout()
    }
  }

  var isEditable: Bool {
    get { field.isEditable }
    set { field.isEditable = newValue }
  }

  /// the header's height for a width: the space above, the wrapped name, and the space below.
  func height(for width: CGFloat) -> CGFloat {
    let line = field.font?.lineHeight ?? 34
    let name = width > 0 ? field.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height : line
    return ceil(NoteTitleView.top + max(name, line) + NoteTitleView.bottom)
  }

  /// puts the caret in the name with the whole name selected, as for a new note.
  func beginEditingWithNameSelected() {
    guard field.isEditable, field.becomeFirstResponder() else { return }
    field.selectedTextRange = field.textRange(from: field.beginningOfDocument, to: field.endOfDocument)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let needed = height(for: bounds.width)
    field.frame = CGRect(x: 0, y: NoteTitleView.top, width: bounds.width, height: needed - NoteTitleView.top - NoteTitleView.bottom)
    if needed != reportedHeight {
      reportedHeight = needed
      onHeightChange?(needed)
    }
  }

  // MARK: - UITextViewDelegate

  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
    guard text.contains(where: \.isNewline) else {
      return true
    }
    if text.allSatisfy(\.isNewline) {
      onReturn?()
      return false
    }
    // a pasted name stays on one line: its line breaks become spaces.
    let flattened = text.components(separatedBy: .newlines).joined(separator: " ")
    if let start = textView.position(from: textView.beginningOfDocument, offset: range.location),
      let end = textView.position(from: start, offset: range.length),
      let textRange = textView.textRange(from: start, to: end)
    {
      textView.replace(textRange, withText: flattened)
    }
    return false
  }

  func textViewDidChange(_ textView: UITextView) {
    // a longer or shorter name can change the number of lines.
    setNeedsLayout()
  }

  func textViewDidEndEditing(_ textView: UITextView) {
    onEndEditing?(textView.text)
  }
}
