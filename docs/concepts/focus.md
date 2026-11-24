---
description: Focus is the primary state of a TV app. Press a direction, read where focus landed, repeat until the target holds it; never model the app's focus engine.
---

# Focus

On TV, exactly one element holds **focus** and the remote moves it. Focus is what the user sees as "where I am", so it is what toets tests act through and assert on. There is no pointer: to activate something, focus it, then press `SELECT`.

The app's focus engine decides where every press goes. Focus guides, focus memory, custom resolvers and JS focus engines keep that logic in app code, so no description of it from outside is ever complete. toets does not try: it presses a direction, reads where focus landed, and repeats until the target holds focus.

```ts run
import { test, expect, Key } from '@toets/test';

test('remembers the focused card when returning to a rail', async ({ app }) => {
  await app.launch();

  const card = app.getByTestId('rail-0-card-3');
  await app.focus.pressUntil(Key.RIGHT, card);
  await expect(card).toBeFocused();

  await app.remote.press(Key.DOWN);
  await expect(app.getByTestId('rail-1')).toHaveFocusWithin();

  await app.remote.press(Key.UP);
  await expect(card).toBeFocused();
});
```

## API

- `app.focus.pressUntil(key, target)` presses one D-pad direction until the target (or an element inside it) holds focus, reading focus after every press, and returns the number of presses. The target may not exist yet: virtualized lists render items as focus approaches. It fails fast with `FOCUS_STUCK` when a press does not move focus, `FOCUS_LOOP` when focus comes back to an element it left, and `FOCUS_UNREACHABLE` after `maxPresses` (default 50). **The recommended way to move focus.**
- `app.focus.navigateTo(target)` moves focus when the way there is more than one direction. It aims each press by element geometry, checks focus after it the same way, and detours around presses that did not move focus. The target must be on screen.
- `app.focus.current()` is a locator for the focused element.
- `app.focus.waitForChange(action)` runs `action` and waits until focus moves to another element.
- `toBeFocused()` and `toHaveFocusWithin()` assert focus on an element or inside a container.

Both movers are one step in the report, with every press inside it. How they decide and fail: [focus navigation reference](../reference/core/docs/focus-navigation.md).

## When to use which

- **Getting somewhere** is not what the test is about: `pressUntil`, one call per direction (`DOWN` to the rail, then `RIGHT` to the card). It survives layout changes that break a fixed key sequence, and its errors say exactly where focus went. Use `navigateTo` when the route is not worth spelling out.
- **Navigation is the behavior under test** (focus memory, wrap-around, traps, back behavior): press keys explicitly and assert focus after each press.

## Where focus comes from

- **The platform's focus engine** (tvOS, Android TV, DOM focus on web) owns focus: toets reads it black-box, with no app changes.
- **A JS focus engine** (Norigin Spatial Navigation, LRUD, react-tv-space-navigation, ...) keeps focus in app state, invisible from outside. The app reports it through the [SDK](./sdk.md) with `reportFocus()`: [reporting focus](../reference/sdk/docs/focus.md).

## Traps

- **Assert focus after moving.** A press that lands on the wrong element fails much later, somewhere confusing. `await expect(target).toBeFocused()` right after makes the failure point at the cause.
- **Focus is not visibility.** A visible element may be disabled or unreachable from the current position. If a user must reach it, test that they can.
- **The app's focus engine decides.** tvOS, Android and web each have their own rules for "nearest in this direction", and apps add more. toets sends the press and observes the result; assertions on focus are portable, assumptions about exact paths are not.
- **Wrap-around rows and menus.** Pressing toward a target that is not in that direction cycles forever on a user's remote; `pressUntil` stops at the first repeat with `FOCUS_LOOP`.
- **JS focus engines need the SDK.** Without `reportFocus()`, toets sees DOM or native focus, usually nothing, and every focus assertion fails.
