---
description: Port Detox tests to toets - matchers and launch options map closely; taps become focus navigation and synchronization becomes an accelerator instead of a gate.
---

# Migrating from Detox

Detox and toets share the gray-box idea: an in-app component reports when the app is idle. The differences: toets runs on Playwright Test, targets TV platforms including web, drives the app with a remote instead of touch, and treats idle as an accelerator rather than a gate.

| Detox                                                   | toets                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| Jest runner, `.detoxrc` configurations                  | Playwright Test, `defineConfig` with `platforms.*()` projects               |
| `element(by.id('x'))`, `element(by.text('Play'))`       | `app.getByTestId('x')`, `app.getByText('Play')`                             |
| `.atIndex(n)`                                           | `.nth(n)`                                                                   |
| `.tap()`                                                | `app.focus.pressUntil(Key.X, locator)`, then `app.remote.press(Key.SELECT)` |
| `.typeText(text)`                                       | no equivalent in v1; drive the on-screen keyboard                           |
| `expect(el).toBeVisible()`                              | `await expect(locator).toBeVisible()`                                       |
| `waitFor(el).toBeVisible().withTimeout(5000)`           | `await expect(locator).toBeVisible({ timeout: 5000 })`                      |
| `device.launchApp({ newInstance: true, delete: true })` | `app.launch({ clearData: true })`                                           |
| `device.launchApp({ launchArgs })`                      | `app.launch({ state, flags })`                                              |
| `device.pressBack()`                                    | `app.remote.press(Key.BACK)`                                                |
| Automatic synchronization                               | SDK idle (`sync.idle`), plus assertions that always retry                   |

## Principles

- **Taps become navigation.** Decide per step whether reaching the element is part of the behavior (explicit presses) or not (`pressUntil`, `navigateTo`), and assert focus.
- **Idle never blocks.** Detox waits for idle before every action and hangs when the app never settles. toets uses idle to check sooner and falls back to polling, naming the busy resource. See [Idle](../../concepts/idle.md).
- **The SDK is optional.** Start black-box; add the [SDK](../../concepts/sdk.md) for idle, media state and named states (and to report focus from a JS focus engine).

## Traps

- **`await` every assertion.** Detox `expect` is async too, but Playwright reports an un-awaited assertion as a passing test that checked nothing.
- **Launch arguments are not states.** Detox `launchArgs` reach the app however you wire them; toets delivers `state` and `flags` through the launch payload, and the app applies them through the SDK.
