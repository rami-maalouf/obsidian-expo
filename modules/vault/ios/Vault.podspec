Pod::Spec.new do |s|
  s.name           = 'Vault'
  s.version        = '0.1.0'
  s.summary        = 'Coordinated access to an existing Markdown vault'
  s.description    = 'Local Expo module for obsidian-expo: vault paths, file state, and coordinated reads and writes'
  s.license        = 'MIT'
  s.author         = 'obsidian-expo'
  s.homepage       = 'https://github.com/rami-maalouf/obsidian-expo'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/rami-maalouf/obsidian-expo.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Core/ is foundation-only and is also built by ../Package.swift for `swift test`.
  s.source_files = '*.swift', 'Core/**/*.swift', 'Editor/**/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
