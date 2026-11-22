# Focus navigation

`app.focus.navigateTo(target)` moves focus to an element with real D-pad presses and returns the path it took. It is how a test says "go to the Settings button" without hardcoding `DOWN, DOWN, RIGHT`, which breaks whenever the layout changes.

```ts nocheck
const path = await app.focus.navigateTo(app.getByTestId('menu-watchlist'));
await app.remote.press(Key.SELECT);

await app.focus.waitForChange(() => app.remote.press(Key.RIGHT));
```

## How it chooses

1. With the SDK focus graph (`focus.graph`), it follows the app's own next-focus map. An edge is a node id (focus moves there), `null` (focus does not move: never pressed) or absent (unknown: geometry decides).
2. Otherwise it uses geometry: directions toward the target first, then detours. It learns which press moved focus where, never repeats a failed press from the same element, and backtracks over known moves to reach untried directions.
3. It stops after `maxPresses` (default 50) and fails with the reason, the focused element and the path tried.

## Principles

- **Real presses only.** Focus is never set programmatically, so the test proves a user can get there.
- **The target must be focusable** and present. Containers are fine when the focused element is inside them.
- **`waitForChange`** runs an action and waits until focus lands on a different element. Use it when the destination is not known, for example after `BACK`.

## TV trap: focus memory and traps

TV focus engines remember the last focused child of a row and may jump there instead of the nearest item. Modals trap focus. Both look like "geometry lies". navigateTo copes by learning the real moves, but an unreachable target error usually means a real focus trap in the app.
