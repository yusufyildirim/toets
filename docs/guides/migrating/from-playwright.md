---
description: Port Playwright web tests to toets - same runner and assertion style, but focus and the remote replace the pointer, and page becomes app.
---

# Migrating from Playwright

toets runs on Playwright Test, so the runner, config, reporters, UI mode, `test.step`, fixtures and `expect` style carry over. What changes is the model of the app: `page` becomes `app`, and the pointer is replaced by focus and the remote.

| Playwright                                        | toets                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `import { test, expect } from '@playwright/test'` | `import { test, expect, Key } from '@toets/test'`                      |
| `{ page }` fixture                                | `{ app }` fixture                                                      |
| `page.goto(url)`                                  | `app.launch()`; the URL lives in the config (`app.web.url`)            |
| `page.getByTestId(id)`, `page.getByText(t)`       | `app.getByTestId(id)`, `app.getByText(t)`                              |
| `locator.click()`                                 | `app.focus.navigateTo(locator)`, then `app.remote.press(Key.SELECT)`   |
| `page.keyboard.press('ArrowRight')`               | `app.remote.press(Key.RIGHT)`                                          |
| `locator.fill(text)`                              | no equivalent in v1; drive the on-screen keyboard with focus and keys  |
| `page.route(url, handler)`                        | `app.network.use(http.get(url, handler))`                              |
| `expect(locator).toBeVisible()`                   | the same                                                               |
| `expect(locator).toBeFocused()`                   | the same, and central: assert it after every navigation                |
| `page.evaluate(fn)`                               | none; `app.platformOnly('web', ...)` as a marked last resort           |
| `projects: [{ use: devices['...'] }]`             | `projects: [platforms.web(), platforms.androidTV(), platforms.tvOS()]` |

## Principles

- **Rewrite clicks as navigation.** A click says "activate this"; on TV the user first has to get there. Decide whether getting there is part of the behavior (explicit presses) or not (`navigateTo`).
- **Drop `getByRole` and CSS selectors.** v1 locates by test ID and text only, because those mean the same on every platform. Add test IDs to the app where needed.
- **Remove web-only assumptions.** Viewport sizes, hover states, `page.evaluate` and DOM access do not exist on Android TV or tvOS.

## Traps

- **Keyboard key names are not remote keys.** `Enter` is not `SELECT` on every platform; `Escape` is not `BACK`. Use `Key` and let the driver map it.
- **Network mocking needs the app's cooperation.** `page.route` intercepts in the browser; toets's mock server works on every platform but is off until `toets: { mock: true }`, and the app must send traffic to it. See [Network mocking](../../concepts/network-mocking.md).
