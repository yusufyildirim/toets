---
name: dpad-migrate
description: Port existing end-to-end tests to dpad (@dpad-tv/test) from Playwright, Appium / WebdriverIO, Detox or an in-house TV test layer, or plan such a migration. Use when asked to migrate, convert or rewrite TV or web E2E tests into dpad tests.
---

# Migrating tests to dpad

Translate intent, not syntax. Old tests encode the old tool's model (pointer clicks, explicit waits, platform selectors, keycodes, per-platform files). dpad's model is focus, the remote, retrying assertions and capabilities; a literal port keeps the old problems.

Docs are referenced by slug, for example `guides/migrating/from-appium`: the docs site page `/<slug>`, also served as markdown at `/<slug>.md`.

## Source-specific mappings

- Playwright: `guides/migrating/from-playwright`
- Appium / WebdriverIO: `guides/migrating/from-appium`
- Detox: `guides/migrating/from-detox`
- An in-house layer (for example Playwright on web plus WebdriverIO on Android): read the guides for the tools it wraps, then apply the rules below.

## Approach

1. **Set up dpad first** with the dpad-setup skill, and get one new smoke test green on web.
2. **Inventory** the old suite: flows covered, platforms each runs on, helpers, page objects, custom waits, mocking, device scripts. Note tests that exist per platform for the same behavior; they become one dpad test.
3. **Migrate in vertical slices**: one screen or flow at a time, page object first, then its tests. Keep the old suite running until the slice is green on every platform in dpad.
4. **Delete the old tests for a slice** once the dpad tests cover the same behaviors. Do not keep two suites testing the same thing.

## Translation rules

| Old                                              | dpad                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| click / tap                                      | `app.focus.navigateTo(locator)`, assert focus, `app.remote.press(Key.SELECT)` |
| sleeps, `waitUntil`, `waitForDisplayed`          | `await expect(locator).toBeVisible()` and other retrying matchers             |
| CSS, XPath, UiSelector, accessibility-id strings | `app.getByTestId(id)`; add one test ID per element for all platforms          |
| raw keycodes, `keyboard.press('ArrowRight')`     | `app.remote.press(Key.RIGHT)`                                                 |
| `if (platform === ...)`, per-platform files      | one test; `requires: [...]` for real capability gaps                          |
| shell commands (`adb shell dumpsys`, `simctl`)   | capabilities: `media.state`, `app.state`, `platform.events`                   |
| clicking through onboarding in every test        | `app.launch({ state })` with the SDK, or a project fixture                    |
| per-request interception in the browser          | `app.network.use(http.get('*/path', ...))` before `launch()`                  |
| device boot scripts, port math, global session   | dpad device pool: `managed` devices, one per worker                           |
| app-specific launch logic in the framework layer | a fixture in the project (`guides/writing-tests`)                             |

Concepts behind the rules: `concepts/focus`, `concepts/locators-and-assertions`, `concepts/capabilities`, `concepts/idle`, `concepts/network-mocking`, `concepts/page-objects`.

## Traps

- **Old click-based tests can hide focus bugs.** When a ported test fails because focus can not reach an element, check the app before changing the test.
- **No text input API in v1.** Tests that typed into fields drive the on-screen keyboard with focus and keys.
- **Old assertions may have been too weak.** Keep the behavior the test name promises; do not port an assertion that checked nothing.
- **Old retries may have hidden flakiness.** Run each migrated slice with `--repeat-each=5` on every platform before deleting the old tests.

## Report back

List migrated slices, behaviors covered per platform (and skips with reasons), old tests deleted, behaviors dropped on purpose, and app changes needed (test IDs, mock routing, SDK).
