---
description: Text goes in through a keyboard, like a user types it. System text fields use the platform's text entry; keyboards the app draws itself are declared once and typed key by key with the remote.
---

# Text input

A TV has no keyboard. Users type with one of two kinds:

- **The system keyboard**, which the platform shows for its own text fields: an `<input>` on web, an `EditText` on Android TV, a `UITextField` on tvOS. toets enters text into these with the platform's text entry (`text.input` capability).
- **An app keyboard** (on-screen keyboard, OSK): a grid of focusable keys the app draws itself, common in search and PIN screens. Nothing on the platform knows it is a keyboard, so you **declare** it once with `defineKeyboard()`. toets then types each character the way a user does: D-pad presses to its key, then `SELECT`.

The test code is the same for both. toets picks the keyboard for each field.

```ts run
import { defineKeyboard, expect, Key, test } from '@toets/test';

// Usually in its own file, passed to defineConfig({ keyboards }).
const search = defineKeyboard({
  name: 'search',
  root: { testId: 'osk' },
  fields: [{ testId: 'search-input' }],
  layers: [{ testId: 'osk-layer' }],
  space: { testId: 'osk-space' },
  backspace: { testId: 'osk-del' },
  clear: { testId: 'osk-clear' },
  submit: { testId: 'osk-search' },
});

test.use({ keyboards: [search] });

test('searches with the app keyboard', async ({ app }) => {
  await app.launch();
  await app.focus.pressUntilFocused(Key.LEFT, app.getByTestId('menu-home'));
  await app.focus.pressUntilFocused(Key.DOWN, app.getByTestId('menu-search'));
  await app.remote.press(Key.SELECT);

  const query = app.getByTestId('search-input');
  await query.fill('big buck');
  await expect(query).toHaveText('big buck');
  await expect(app.keyboard).toBeOpen();

  await app.keyboard.type(' 2'); // switches to the digits layer for "2"
  await app.keyboard.erase(2);
  await app.keyboard.submit();
  await expect(app.getByTestId('search-results')).toHaveText('Results for "big buck"');
  await expect(app.keyboard).not.toBeOpen();
});

test('signs in with system text fields', async ({ app }) => {
  await app.launch();
  await app.focus.pressUntilFocused(Key.LEFT, app.getByTestId('menu-home'));
  await app.focus.pressUntilFocused(Key.DOWN, app.getByTestId('menu-sign-in'));
  await app.remote.press(Key.SELECT);

  const email = app.getByTestId('email');
  await email.fill('ada@example.com');
  await expect(email).toHaveValue('ada@example.com');
  await app.getByTestId('password').fill('tv-pass-1'); // reported as •••••••••
  await app.keyboard.submit();
  await expect(app.getByTestId('sign-in-status')).toHaveText('Signed in as ada@example.com');
});
```

## API

- `locator.fill(text, { mask })` replaces the field's text: focus moves to the field with real presses, then its keyboard enters the text. It never submits, and returns with no system keyboard covering the app.
- `app.keyboard` acts on the keyboard in use: `type(text, { mask })` types at the end, `erase(count)` deletes before the caret with the keyboard's backspace, `submit()` presses its submit key (the action key of the system keyboard: Search, Go, Done).
- `toHaveValue(text | RegExp)` asserts the value of a system text field. App keyboards type into ordinary elements: assert those with `toHaveText`.
- `expect(app.keyboard).toBeOpen()` asserts that a keyboard is open, with `.not` for closed.
- `mask: true` reports the text as `••••` in step titles, errors and MCP output. System password fields mask on their own.

There is no `locator.type`, `clear` or `close`: `fill` replaces, `type` appends to the field the keyboard holds, and keyboards close the way the app closes them (`submit()` or `Key.BACK`).

## Which keyboard

`fill` uses, in order:

1. The declared keyboard whose `fields` list the field. When it is closed, toets moves focus to the field, presses `SELECT` and tries again.
2. System text entry, when the field is a system text field.
3. Otherwise it fails with `NO_KEYBOARD`.

`app.keyboard` uses the declared keyboard holding focus, else system text entry on the focused system text field, else the only declared keyboard on screen.

Declarations, layers, speed and the step titles: [text input reference](../reference/core/docs/text-input.md).

## Traps

- **An app keyboard is not a system keyboard.** Typing a search OSK through the platform's text entry would skip the code under test (key handling, layer switching, the app's own field). Declare it, and toets types it with the remote like a user.
- **System text entry is not key events.** On web toets inserts text the way an IME does (`insertText`): `input` events fire, `keydown` per character does not. Apps that only listen for `keydown` on a system field see nothing; test that handler with `app.remote.press`.
- **Mask secrets.** Step titles, the HTML report, traces and MCP output keep the text. Pass `{ mask: true }` for PINs and passwords typed on app keyboards. `toHaveValue` refuses system password fields (`SECURE_FIELD`): their value is masked by the platform.
- **Web has no system keyboard.** There, `app.keyboard` counts as open while a text field holds focus: `fill` on web leaves focus in the field, so `expect(app.keyboard).toBeOpen()` passes until focus moves away. On Android TV and tvOS `fill` closes the system keyboard it opened.
- **Keep keyboard declarations free of test imports.** The config loads the `keyboards` file, so it may import only `defineKeyboard` from `@toets/test`. Importing page objects or fixtures from it pulls test code into the config.
- **`keyboards` levels replace, not merge.** `defineConfig({ keyboards })`, `platforms.*({ keyboards })` and `test.use({ keyboards })` each replace the level above: list every keyboard at the level you set.
- **Old SDKs hide system fields.** With the SDK on, the field's `editable` flag comes from the SDK (protocol 1.1). An older SDK reports none, and `fill` fails with `NO_KEYBOARD`: update the SDK.
