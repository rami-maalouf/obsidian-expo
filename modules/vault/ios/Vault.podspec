Pod::Spec.new do |s|
  s.name           = 'Vault'
  s.version        = '0.1.0'
  s.summary        = 'Coordinated access to an existing Markdown vault'
  s.description    = 'Local Expo module for obsidian-expo: vault paths, file state, and coordinated reads and writes'
  s.license        = 'MIT'
  s.author         = 'obsidian-expo'
  s.homepage       = 'https://github.com/rami-maalouf/obsidian-expo'
  # laperm's editor needs ios 27 (app.json sets the same deployment target).
  s.platforms      = { :ios => '27.0' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/rami-maalouf/obsidian-expo.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # the markdown editor (t05 in docs/technology-decisions.md), pinned to one upstream commit.
  # react native's helper adds the swift package to this pod during `pod install`.
  spm_dependency(s,
    url: 'https://github.com/k-ymmt/LapermEditor.git',
    requirement: { kind: 'revision', revision: 'b905bc45dca55cd689f810e491e64b6b99b45e89' },
    products: ['LapermEditor']
  )

  # Core/ is foundation-only and is also built by ../Package.swift for `swift test`.
  s.source_files = '*.swift', 'Core/**/*.swift', 'Editor/**/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
