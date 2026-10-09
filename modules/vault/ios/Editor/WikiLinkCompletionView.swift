import UIKit

/// the floating list of link suggestions shown near the caret while a `[[link` is typed.
/// rows are buttons, so a tap chooses one without taking focus from the text view; the
/// highlighted row is the one return, tab, and the arrow keys act on.
final class WikiLinkCompletionView: UIView {
  struct Item: Equatable {
    let title: String
    /// the note's folder, shown under its name; nil for the vault root and for headings.
    let detail: String?
    let isHeading: Bool
  }

  static let rowHeight: CGFloat = 48
  static let width: CGFloat = 300
  private static let inset: CGFloat = 4

  var onSelect: ((Int) -> Void)?
  private(set) var items: [Item] = []
  private(set) var highlighted = 0
  private let background = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
  private let stack = UIStackView()

  init() {
    super.init(frame: .zero)
    layer.shadowColor = UIColor.black.cgColor
    layer.shadowOpacity = 0.2
    layer.shadowRadius = 12
    layer.shadowOffset = CGSize(width: 0, height: 4)
    background.layer.cornerRadius = 12
    background.layer.cornerCurve = .continuous
    background.clipsToBounds = true
    addSubview(background)
    stack.axis = .vertical
    stack.distribution = .fillEqually
    background.contentView.addSubview(stack)
    accessibilityLabel = "Link suggestions"
    isHidden = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("WikiLinkCompletionView does not support NSCoder")
  }

  /// the height for `rows` rows, including the list's padding.
  static func height(rows: Int) -> CGFloat {
    CGFloat(rows) * rowHeight + inset * 2
  }

  func show(_ items: [Item]) {
    if items != self.items {
      self.items = items
      highlighted = 0
      rebuild()
    }
  }

  func moveHighlight(by delta: Int) {
    guard !items.isEmpty else { return }
    highlighted = (highlighted + delta + items.count) % items.count
    refreshHighlight()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    background.frame = bounds
    stack.frame = bounds.insetBy(dx: WikiLinkCompletionView.inset, dy: WikiLinkCompletionView.inset)
    layer.shadowPath = UIBezierPath(roundedRect: bounds, cornerRadius: 12).cgPath
  }

  private func rebuild() {
    for view in stack.arrangedSubviews {
      stack.removeArrangedSubview(view)
      view.removeFromSuperview()
    }
    for (index, item) in items.enumerated() {
      let button = UIButton(type: .system)
      button.contentHorizontalAlignment = .leading
      button.accessibilityLabel = item.detail.map { "\(item.title), in \($0)" } ?? item.title
      button.addAction(UIAction { [weak self] _ in self?.onSelect?(index) }, for: .primaryActionTriggered)
      stack.addArrangedSubview(button)
    }
    refreshHighlight()
  }

  private func refreshHighlight() {
    for (index, view) in stack.arrangedSubviews.enumerated() {
      guard let button = view as? UIButton, index < items.count else { continue }
      let item = items[index]
      var config = UIButton.Configuration.plain()
      config.title = item.title
      config.subtitle = item.detail
      config.image = UIImage(systemName: item.isHeading ? "number" : "doc.text")
      config.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(textStyle: .subheadline)
      config.imagePadding = 10
      config.titleAlignment = .leading
      config.titleLineBreakMode = .byTruncatingTail
      config.subtitleLineBreakMode = .byTruncatingMiddle
      config.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 10, bottom: 4, trailing: 10)
      config.baseForegroundColor = .label
      config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
        var attributes = attributes
        attributes.font = UIFont.preferredFont(forTextStyle: .body)
        return attributes
      }
      config.subtitleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
        var attributes = attributes
        attributes.font = UIFont.preferredFont(forTextStyle: .caption1)
        attributes.foregroundColor = UIColor.secondaryLabel
        return attributes
      }
      config.background.backgroundColor = index == highlighted ? .tertiarySystemFill : .clear
      config.background.cornerRadius = 8
      button.configuration = config
      button.accessibilityTraits = index == highlighted ? [.button, .selected] : .button
    }
  }
}
