---
description: Focus is the primary state of a TV app. Move it with real remote presses, assert it after every navigation, and let navigateTo find paths.
---

# Focus

On TV, exactly one element holds **focus** and the remote moves it. Focus is what the user sees as "where I am", so it is what dpad tests act through and assert on. There is no pointer: to activate something, focus it, then press `SELECT`.

```ts
import { test, expect, Key } from '@dpad-tv/test';

test('remembers the focused card when returning to a rail', async ({ app }) => {
  await app.launch();

  const card = app.getByTestId('rail-0-card-3');
  await app.focus.navigateTo(card);
  await expect(card).toBeFocused();

  await app.remote.press(Key.DOWN);
  await expect(app.getByTestId('rail-1')).toHaveFocusWithin();

  await app.remote.press(Key.UP);
  await expect(card).toBeFocused();
});
```

## API

- `app.focus.navigateTo(locator)` moves focus to the target with real D-pad presses and returns the directions taken. It picks each press from the SDK focus graph when available, otherwise from element geometry, and re-reads focus after every press. The path is recorded in the report. It throws when the target is unreachable within `maxPresses` (default 50).
- `app.focus.current()` is a locator for the focused element.
- `app.focus.waitForChange(action)` runs `action` and waits until focus moves to another element.
- `toBeFocused()` and `toHaveFocusWithin()` assert focus on an element or inside a container.

## When to use which

- **Getting somewhere** is not what the test is about: use `navigateTo`. It survives layout changes that would break a fixed key sequence.
- **Navigation is the behavior under test** (focus memory, wrap-around, traps, back behavior): press keys explicitly and assert focus after each press.

## Traps

- **Assert focus after navigating.** A press that lands on the wrong element fails much later, somewhere confusing. `await expect(target).toBeFocused()` right after makes the failure point at the cause.
- **Focus is not visibility.** A visible element may be unfocusable or unreachable from the current position. If a user must reach it, test that they can.
- **The app's focus engine decides.** tvOS, Android and web each have their own rules for "nearest in this direction". dpad sends the press; the app's engine moves focus. Assertions on focus are portable; assumptions about exact paths are not.
- **Web apps with virtual focus.** If an app highlights elements without moving DOM focus, `document.activeElement` is wrong. The [SDK](./sdk.md) reports the app's real focus.
