---
name: dpad-write-tests
description: Write or change end-to-end tests, page objects and fixtures for TV apps with dpad (@dpad-tv/test) on web, Android TV / Fire TV or tvOS. Use when creating, editing or reviewing test files that import @dpad-tv/test, or adding the test IDs those tests need. For installing dpad use dpad-setup; for investigating failures use dpad-debug-failures.
---

# Writing dpad tests

dpad tests run on Playwright Test. Each platform is a project; each test gets one fixture, `app`, the app under test on the current platform. A good test drives the app like a user with a remote, checks what the user would see, and means the same on every platform.

Docs are referenced by slug, for example `concepts/focus`: the docs site page `/<slug>`, also served as markdown at `/<slug>.md` and indexed in `/llms.txt` (until the site is hosted: under `docs/` in the dpad repository). Package reference pages (`reference/<package>/docs/<page>`) ship offline in each installed package's `docs/`; errors print the exact path.

## Mental model

- **No click.** Move focus with the remote, then press `Key.SELECT`. (`concepts/focus`)
- **Locators are lazy, assertions retry.** Never sleep, never read a value and compare it yourself. (`concepts/locators-and-assertions`)
- **Keys are semantic.** `Key.PLAY_PAUSE`, never keycodes; keys a remote lacks are capability-gated. (`concepts/remote-and-keys`)
- **Platform gaps are capabilities.** Declare `requires`; never branch on the platform. (`concepts/capabilities`)
- **The SDK is optional.** It adds idle sync, focus graph, media state and named states. (`concepts/sdk`)

## Workflow

1. **Read what exists**: `playwright.config.ts`, the test folder, page objects and fixtures. Follow their conventions and reuse their page objects.
2. **Name the behavior** the test proves, one per test, and name the test after it.
3. **Find the elements by test ID.** If one is missing, add it to the app (`testID` in React Native, `data-testid` on web, resource ID on Android, `accessibilityIdentifier` on tvOS) rather than matching layout or volatile text.
4. **Write it**: arrange (mocks, launch), act (focus, keys), assert. Assert focus after every navigation step.
5. **Run on web first**: `npx playwright test <file> --project=web`. Then run every project (`npx playwright test <file>`). Done means passing, or skipped with a reason, everywhere.
6. **Prove it can fail**: break the expectation once (wrong text, wrong test ID) and check the failure message is clear. Revert.

## Example

```ts run
import { test, expect, Key, http, HttpResponse } from '@dpad-tv/test';

test('shows the empty state when the watchlist is empty', async ({ app }) => {
  app.network.use(http.get('*/api/watchlist', () => HttpResponse.json([])));
  await app.launch();

  const tab = app.getByTestId('menu-watchlist');
  await app.focus.navigateTo(tab);
  await expect(tab).toBeFocused();
  await app.remote.press(Key.SELECT);

  await expect(app.getByTestId('watchlist-empty')).toBeVisible();
});
```

## API at a glance

| Need                       | Use                                                                |
| -------------------------- | ------------------------------------------------------------------ |
| Start the app              | `app.launch()`, `app.launch({ state, flags, clearData })`          |
| Find elements              | `app.getByTestId(id)`, `app.getByText(text)`, `.nth(i)`, chaining  |
| Get somewhere              | `app.focus.navigateTo(locator)`                                    |
| Press keys                 | `app.remote.press(Key.X)`, `longPress`, `repeat`, `sequence`       |
| Check focus                | `expect(l).toBeFocused()`, `expect(container).toHaveFocusWithin()` |
| Check content              | `toBeVisible`, `toHaveText`, `toContainText`, `toHaveCount`        |
| Check playback             | `expect(app.media).toBePlaying()`, `toBePaused()`                  |
| Mock data (`dpad.mock` on) | `app.network.use(http.get(...))` before `launch()`                 |
| Needs a capability         | `test(name, requires('key.color'), fn)`                            |
| Run in order, shared `app` | `test.describe.serial(...)`                                        |

## Rules

- `await` every action and assertion.
- `navigateTo` to get somewhere; explicit presses when navigation itself is under test.
- Negative assertions (`.not`) only after a positive assertion proved the screen is in the intended state. (`concepts/idle`)
- Mock data the test depends on (needs `dpad: { mock: true }` and app cooperation); a relative path like `/api/x` matches any origin. (`concepts/network-mocking`)
- Page objects take `app`, expose locators and intent-level actions, and do not assert except to wait until loaded. (`concepts/page-objects`)
- App-specific setup (splash, sign-in) lives in a fixture in the project. (`guides/writing-tests`)
- Serial flows only for journeys that can not be set up directly; prefer named states. (`guides/serial-flows`)
- No `sleep`, no `waitForTimeout`, no raw keycodes, no `if (platform)`, no `platformOnly` unless a maintainer asks for it.
- Keep text snapshot assertions to a region, with mocked data. (`concepts/text-snapshots`)

## Platform notes

- tvOS has only D-pad, select, back, play/pause and home keys. (`platforms/tvos`)
- Android TV has every TV key; emulators are slower than web. (`platforms/android-tv`)
- Web focus is `document.activeElement`, unless the web driver's `focus` selectors or the SDK report the app's own focus. (`platforms/web`)

If a test fails and the cause is not obvious, switch to the dpad-debug-failures skill.
