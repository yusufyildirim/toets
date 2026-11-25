# Exploring an app, then writing the test

The MCP tools are the test API in interactive form. Explore with them until each step works, then write the same steps as a test.

## TV traps

- **No click.** Nothing is clicked, tapped or typed into. Move focus with the D-pad, then `SELECT`.
- **Focus first.** Every interaction acts on the focused element. Read focus from `snapshot` before pressing, and assert it after.
- **Virtualized lists.** Items far offscreen often do not exist yet. Navigate toward them; do not expect `query` to find them up front.
- **Platform keys differ.** Only D-pad, `SELECT` and (usually) `BACK` are universal. Check `capabilities` before using media, color or numeric keys.
- **Assertions wait.** `assert` retries until its timeout, like `expect`. Never add sleeps; wait for a state.

## Loop

1. `launch`, then `snapshot` to see the start screen and where focus is.
2. Reach the element: `press_until_focused` a direction with its test ID (`navigate_to` when it is several directions away, `press` for single steps).
3. Activate with `press` `["SELECT"]`; `snapshot` again, screens change.
4. Check the outcome with `assert` (`toBeFocused`, `toBeVisible`, `toHaveText`).
5. Copy the `Code:` lines from the responses into the test.

When a test fails, the same loop reproduces it: `launch` with the test's `state`, repeat its steps and `assert` the failing matcher to read the same message.

## Example

Exploration (tool calls and the code they return):

```text
launch
  -> Focus: card_1 "Movie 1"
press_until_focused { key: "RIGHT", target: { testId: "card_2" } }
  -> Code: await app.focus.pressUntilFocused(Key.RIGHT, app.getByTestId('card_2'));
press { keys: ["SELECT"] }
  -> Code: await app.remote.press(Key.SELECT);
assert { target: { testId: "play" }, matcher: "toBeFocused" }
  -> PASS in 40ms: await expect(app.getByTestId('play')).toBeFocused();
```

The test:

```ts
import { expect, Key, test } from '@toets/test';

test('opens details from the popular rail', async ({ app }) => {
  await app.launch();
  await app.focus.pressUntilFocused(Key.RIGHT, app.getByTestId('card_2'));
  await app.remote.press(Key.SELECT);
  await expect(app.getByTestId('play')).toBeFocused();
});
```

Run it on every platform; if a selector or key differs per platform, fix the app's test IDs or gate the test with `requires`, never branch on platform in the test.
