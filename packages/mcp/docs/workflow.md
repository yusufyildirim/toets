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
2. Reach the element: `navigate_to` with its test ID (or `press` single steps).
3. Activate with `press` `["SELECT"]`; `snapshot` again, screens change.
4. Check the outcome with `assert` (`toBeFocused`, `toBeVisible`, `toHaveText`).
5. Copy the `Code:` lines from the responses into the test.

## Example

Exploration (tool calls and the code they return):

```text
launch
  -> Focus: focusable [testId=card_1, focused]: "Movie 1"
navigate_to { target: { testId: "card_2" } }
  -> Code: await app.focus.navigateTo(app.getByTestId('card_2'));
press { keys: ["SELECT"] }
  -> Code: await app.remote.press(Key.SELECT);
assert { target: { testId: "play" }, matcher: "toBeFocused" }
  -> PASS in 40ms: await expect(app.getByTestId('play')).toBeFocused();
```

The test:

```ts
import { expect, Key, test } from '@dpad-tv/test';

test('opens details from the popular rail', async ({ app }) => {
  await app.launch();
  await app.focus.navigateTo(app.getByTestId('card_2'));
  await app.remote.press(Key.SELECT);
  await expect(app.getByTestId('play')).toBeFocused();
});
```

Run it on every platform; if a selector or key differs per platform, fix the app's test IDs or gate the test with `requires`, never branch on platform in the test.
