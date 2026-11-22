Pod::Spec.new do |s|
  s.name           = 'DpadLaunch'
  s.version        = '1.0.0'
  s.summary        = 'Exposes the dpad launch payload (launch argument -__dpad) to JS.'
  s.author         = 'dpad'
  s.homepage       = 'https://github.com/dpad-tv/dpad'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4', :tvos => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
end
