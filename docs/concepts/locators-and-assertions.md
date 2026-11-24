---
description: Find elements by test ID or text with lazy locators, and assert with matchers that retry until they pass or time out.
---

# Locators and assertions

A **locator** describes how to find elements; it holds no element. It resolves again on every use, so it never goes stale when the screen re-renders. An **assertion** (`expect(locator).toX()`) retries until it passes or times out. Together they replace finding, waiting and checking by hand.

```ts run
import { test, expect, Key } from '@toets/test';

test('saves a title to the watchlist', async ({ app }) => {
  await app.launch();

  const rail = app.getByTestId('rail-popular');
  const card = rail.getByTestId('card').nth(2);
  await app.focus.pressUntil(Key.DOWN, rail);
  await app.focus.pressUntil(Key.RIGHT, card);
  await app.remote.press(Key.SELECT);

  await expect(app.getByText('Added to watchlist')).toBeVisible();
  await expect(app.getByTestId('watchlist-count')).toHaveText('1');
});
```

## Selectors

v1 has two selectors, chainable from `app` or from another locator (each step searches inside the previous matches):

- `getByTestId(id)`: preferred. Stable across layouts, languages and platforms.
- `getByText(text, { exact })`: for user-visible copy. Substring and case-insensitive unless `exact: true`; a `RegExp` also works.

Narrow multiple matches with `first()` and `nth(index)`, in tree order. Actions and single-element reads are strict: a locator that matches several elements fails instead of picking one. Role and label selectors come later.

How a test ID maps to each platform:

| Platform             | Test ID source                      |
| -------------------- | ----------------------------------- |
| Web                  | `data-testid` attribute             |
| Android TV / Fire TV | view resource ID                    |
| tvOS                 | `accessibilityIdentifier`           |
| React Native         | `testID` (maps to all of the above) |

## Matchers

Matchers are implemented once in the core, over the same element snapshot on every platform, so `toBeFocused()` means the same on web, Android TV and tvOS. Element matchers: `toBeVisible`, `toBeInViewport`, `toBeFocused`, `toHaveFocusWithin`, `toBeEnabled`, `toBeDisabled`, `toBeSelected`, `toBeBusy`, `toHaveText`, `toContainText`, `toHaveCount`. The app, `app.media` and `app.network` have their own (text snapshots, screenshots, playback, requests).

Every matcher takes `{ timeout }` (default: Playwright's `expect.timeout`, 5 s); element matchers support `.not`. Semantics of each, including how missing elements count: [assertions reference](../reference/core/docs/assertions.md). Selector details: [locators reference](../reference/core/docs/locators.md).

## Traps

- **Read values only through matchers.** `expect(await locator.text()).toBe('1')` reads once and does not retry; `await expect(locator).toHaveText('1')` does.
- **No click, no tap, no fill.** On TV, input is the remote. Locators are for finding and asserting; actions go through [focus](./focus.md) and the [remote](./remote-and-keys.md).
- **Visible is not focusable.** An element can be visible yet unreachable by the remote. Assert focus when the user would navigate to it.
- **Test IDs are part of the app's contract.** Add one where a test needs it instead of matching layout positions or translated copy.
