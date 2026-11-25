# Focus navigation

Moving focus with real D-pad presses, without hardcoding `DOWN, DOWN, RIGHT`, which breaks whenever the layout changes. toets never models the app's focus graph; the focused element is the only focus input it reads. Every press is checked by reading focus again.

```ts nocheck
await app.focus.pressUntilFocused(Key.DOWN, app.getByTestId('rail-popular'));
await app.focus.pressUntilFocused(Key.RIGHT, app.getByTestId('card-7'));
await app.remote.press(Key.SELECT);

await app.focus.navigateTo(app.getByTestId('menu-watchlist'));

await app.focus.waitForChange(() => app.remote.press(Key.BACK));
```

## `pressUntilFocused(key, target, { maxPresses })`

Presses one direction key (`UP`, `DOWN`, `LEFT`, `RIGHT`) until `target` or an element inside it holds focus, and returns the number of presses (0 when it already does).

1. Read focus. Done when the target (at most one match) is focused or has focus within.
2. Press `key`. Wait until focus lands on another element, up to `navigationSettleMs` (default 1000; SDK idle ends the wait early once the app is done).
3. Repeat, failing fast:

| Code                | When                                                       | Usual cause                                                  |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| `FOCUS_STUCK`       | A press did not move focus within `navigationSettleMs`.    | End of a row or list, a focus trap, a disabled target.       |
| `FOCUS_LOOP`        | Focus came back to an element it already left.             | A wrap-around row or menu: the target is not on this path.   |
| `FOCUS_UNREACHABLE` | `maxPresses` (default 50) presses without reaching target. | The target is further away (raise it) or elsewhere.          |
| `NO_FOCUS`          | Nothing holds focus, before the first press or after one.  | The app is not ready, or a press moved focus out of the app. |

Every message lists the elements focus passed through. The target does not need to exist at the start: items of virtualized lists appear as focus approaches, and each press re-reads the screen.

An element counts as the same when its ref, test ID and text match. Some drivers derive refs from tree positions, so a list that scrolls under a fixed focus position keeps the ref while the focused item changes.

## `navigateTo(target, { maxPresses })`

For targets that are not one direction away. Returns the directions pressed.

1. Aim: directions toward the target's bounds first (same row: horizontal; same column: vertical; otherwise vertical, then horizontal), then detours.
2. Press, then read focus. Every observed move is learned, including presses that did not move focus. A direction is never tried twice from the same element; known moves lead back to elements with untried directions.
3. Stop when the target holds focus, or fail with `FOCUS_UNREACHABLE` when no direction is left or after `maxPresses` (default 50), with the path tried.

The target must be on screen, since its bounds aim the presses. For items that appear only as focus comes near, use `pressUntilFocused`.

## Principles

- **Real presses only.** Focus is never set programmatically, so the test proves a user can get there.
- **Observe, never predict.** The app's focus engine decides where a press goes; toets checks where focus landed and reacts.
- **`waitForChange`** runs an action and waits until focus lands on a different element. Use it when the destination is not known, for example after `BACK`.

## TV trap: focus memory and traps

TV focus engines remember the last focused child of a row and may jump there instead of the nearest item. Modals trap focus. Both look like "geometry lies". `pressUntilFocused` does not care where a press should go, only where it went; `navigateTo` copes by learning the real moves. A stuck or unreachable error usually means a real focus trap in the app.

## Text fields: caret before focus

An arrow on a focused system text field can move its caret instead of focus (web spatial navigation does this inside an input). Both methods keep pressing a direction that left focus on a text field as long as the caret can still move: once per character sideways, once per line up or down. Only then is the field stuck in that direction.
