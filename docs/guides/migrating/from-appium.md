---
description: Port Appium or WebdriverIO TV tests to toets - semantic keys instead of keycodes, retrying matchers instead of explicit waits, and devices managed for you.
---

# Migrating from Appium / WebdriverIO

toets uses Appium underneath on Android TV and tvOS, but tests never see it. Sessions, capabilities JSON, keycodes and emulator ports are replaced by a config, semantic keys and a device pool, and the runner is Playwright Test.

| Appium / WebdriverIO                                | toets                                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| Capabilities JSON per platform                      | `app` entries and `platforms.*()` projects in `defineConfig`                     |
| Mocha or Jest runner                                | Playwright Test                                                                  |
| `$('~id')`, `$('id=com.example:id/x')`              | `app.getByTestId('x')`                                                           |
| `$('android=new UiSelector().text("Play")')`        | `app.getByText('Play')`                                                          |
| `driver.pressKeyCode(22)`                           | `app.remote.press(Key.RIGHT)`                                                    |
| `$('~play').click()`                                | `app.focus.pressUntilFocused(Key.X, app.getByTestId('play'))`, then `Key.SELECT` |
| `el.waitForDisplayed()`, `browser.waitUntil(...)`   | `await expect(locator).toBeVisible()`                                            |
| `driver.activateApp(id)`, `driver.terminateApp(id)` | `app.launch()`, `app.terminate()`                                                |
| `mobile: shell` with `dumpsys` for player state     | `await expect(app.media).toBePlaying()` (`media.state`)                          |
| Booting emulators and port math in scripts          | the device pool: one device per worker, reset between tests                      |

## Principles

- **Keycodes become semantic keys.** toets maps them per platform and refuses, with a capability error, what the remote lacks. See [Remote and keys](../../concepts/remote-and-keys.md).
- **Explicit waits become assertions.** Matchers retry with a timeout; remove `pause()` and `waitUntil` loops entirely.
- **Platform selectors become test IDs.** One locator per element for all platforms. If Android and tvOS tests used different selectors, give the element one test ID.
- **Parallelism is free.** Each worker gets its own device, so drop serial-only setups.

## Traps

- **Do not port `element.click()` literally.** Appium's click on TV often bypasses focus. toets always moves focus with the remote, which may expose real focus bugs your old tests skipped.
- **Shell commands are gone on purpose.** Needs like player state, app state or OS events have capabilities (`media.state`, `app.state`, `platform.events`). See [Capabilities](../../concepts/capabilities.md).
