# @dpad-tv/driver-tvos

Runs dpad tests on tvOS simulators through WebdriverIO and Appium XCUITest. You do not call it directly: `@dpad-tv/test` loads it for `platforms.tvOS()` projects.

| Page                              | What it covers                                                  |
| --------------------------------- | --------------------------------------------------------------- |
| [setup](./setup.md)               | Requirements, app config, how Appium and WebDriverAgent are run |
| [simulators](./simulators.md)     | `managed`, `external` and `command` devices, device sets        |
| [remote](./remote.md)             | Siri Remote buttons, long press, key overrides                  |
| [capabilities](./capabilities.md) | What the driver supports, how elements are mapped, latency      |
| [traps](./traps.md)               | Where web or mobile intuition is wrong on tvOS                  |
