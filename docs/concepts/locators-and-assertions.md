---
description: Find elements by test ID or text with lazy locators, and assert with matchers that retry until they pass or time out.
---

# Locators and assertions

A **locator** describes how to find elements; it holds no element. It resolves again on every use, so it never goes stale when the screen re-renders. An **assertion** (`expect(locator).toX()`) retries until it passes or times out. Together they replace finding, waiting and checking by hand.

```ts
import { test, expect, Key } from '@dpad-tv/test';

test('saves a title to the watchlist', async ({ app }) => {
  await app.launch();

  const rail = app.getByTestId('rail-popular');
  const card = rail.getByTestId('card').nth(2);
  await app.focus.navigateTo(card);
  await app.remote.press(Key.SELECT);

  await expect(app.getByText('Added to watchlist')).toBeVisible();
  await expect(app.getByTestId('watchlist-count')).toHaveText('1');
});
```

## Selectors

v1 has two selectors, chainable from `app` or from another locator (each step searches inside the previous matches):

- `getByTestId(id)`: preferred. Stable across layouts, languages and platforms.
- `getByText(text, { exact })`: for user-visible copy. Substring and case-insensitive unless `exact: true`; a `RegExp` also works.

Narrow multiple matches with `first()` and `nth(index)`, in tree order. Role and label selectors come later.

How a test ID maps to each platform:

| Platform             | Test ID source                      |
| -------------------- | ----------------------------------- |
| Web                  | `data-testid` attribute             |
| Android TV / Fire TV | view resource ID                    |
| tvOS                 | `accessibilityIdentifier`           |
| React Native         | `testID` (maps to all of the above) |

## Matchers

Element matchers, implemented once in the core over the same element snapshot on every platform:

| Matcher                                | Passes when                                 |
| -------------------------------------- | ------------------------------------------- |
| `toBeVisible()`                        | attached, non-zero size, not hidden         |
| `toBeInViewport()`                     | intersects the screen                       |
| `toBeFocused()`, `toHaveFocusWithin()` | it, or one of its descendants, holds focus  |
| `toBeEnabled()`, `toBeDisabled()`      | the platform reports it enabled or disabled |
| `toBeSelected()`                       | selected (tabs, toggles, chosen options)    |
| `toBeBusy()`                           | it or a descendant reports loading          |
| `toHaveText(t)`, `toContainText(t)`    | full text equals, or contains, `t`          |
| `toHaveCount(n)`                       | the locator matches `n` elements            |

Every matcher takes `{ timeout }` and supports `.not`. Media, network, screenshot and text snapshot matchers are covered on their own pages.

## Traps

- **Read values only through matchers.** `expect(await locator.text()).toBe('1')` reads once and does not retry; `await expect(locator).toHaveText('1')` does.
- **No click, no tap, no fill.** On TV, input is the remote. Locators are for finding and asserting; actions go through [focus](./focus.md) and the [remote](./remote-and-keys.md).
- **Visible is not focusable.** An element can be visible yet unreachable by the remote. Assert focus when the user would navigate to it.
- **Test IDs are part of the app's contract.** Add one where a test needs it instead of matching layout positions or translated copy.
