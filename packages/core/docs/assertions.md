# Assertions

Every toets matcher retries until it passes or the timeout elapses (`expect.timeout`, default 5000 ms). There are no sleeps in a toets test.

```ts nocheck
await app.remote.press(Key.SELECT);
await expect(app.getByTestId('details-title')).toHaveText('The Matrix');
await expect(app.getByTestId('play')).toBeFocused({ timeout: 10_000 });
```

| Subject       | Matchers                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locator       | `toBeVisible`, `toBeInViewport`, `toBeFocused`, `toHaveFocusWithin`, `toBeEnabled`, `toBeDisabled`, `toBeSelected`, `toBeBusy`, `toHaveText`, `toContainText`, `toHaveCount` |
| App, Locator  | `toMatchTextSnapshot`, `toMatchScreenshot`                                                                                                                                   |
| `app.media`   | `toBePlaying`, `toBePaused`, `toHaveMediaState`, `toHavePosition` (needs `media.state`)                                                                                      |
| `app.network` | `toHaveRequested(filter, { times? })` (needs `network.mock`)                                                                                                                 |

## Principles

- **Assert focus, not just visibility.** On a TV the question is almost always "where is focus?". `toBeFocused` and `toHaveFocusWithin` (focus is on the element or a descendant) are the core TV assertions.
- **`.not` waits too.** `expect(x).not.toBeVisible()` passes as soon as the element is gone, and fails only after the timeout.
- **Missing elements:** `toBeVisible` and `toBeInViewport` treat a missing element as "not visible". The other locator matchers wait for the element and fail if it never appears, with or without `.not`.
- **Failures explain themselves:** the message shows the locator, expected and received values, what was focused, how many checks ran, and whether the app was idle (see [idle](./idle.md)).

## TV trap: visible is not in viewport

Offscreen rail items are often laid out and "visible" in the tree but scrolled out of the screen. Use `toBeInViewport` when you mean "the user can see it".
