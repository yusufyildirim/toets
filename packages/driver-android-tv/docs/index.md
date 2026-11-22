# @dpad-tv/driver-android-tv

Runs dpad tests on Android TV, Google TV and Fire TV emulators: Appium UiAutomator2 for UI state and key presses, `adb` for app lifecycle, port reversing, logs, video and key holds. Works with any app framework (native Views, Compose, React Native, Flutter): it reads the platform accessibility tree.

- [Setup](./setup.md): requirements, app config, options, reading the launch payload.
- [Devices](./devices.md): managed emulators, external devices, lease brokers, CI.
- [Keys](./keys.md): key mapping and long press.
- [Capabilities](./capabilities.md): what is supported black-box and how snapshots are filled.
- [Fire TV](./fire-tv.md): testing Fire OS apps.
- [Traps](./traps.md): where web and phone intuition is wrong.
- [Performance](./performance.md): latency per action.

Tests never import this package; `@dpad-tv/test` loads it for `android-tv` projects. Use the escape hatch (`app.platformOnly('android-tv', browser => ...)`, a WebdriverIO `Browser`) only for what dpad cannot express.
