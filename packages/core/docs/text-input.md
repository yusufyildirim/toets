# Text input

`locator.fill()` and `app.keyboard` put text into fields through a keyboard: the platform's system text entry for system text fields, or an app-drawn keyboard declared with `defineKeyboard()`, typed key by key with the remote. Concepts and traps: the `concepts/text-input` page of the docs site.

```ts nocheck
await app.getByTestId('search-input').fill('matrix');
await app.keyboard.type(' 2');
await app.keyboard.erase(2);
await app.keyboard.submit();

await expect(app.getByTestId('email')).toHaveValue('ada@example.com');
await expect(app.keyboard).toBeOpen();
await app.getByTestId('pin-value').fill('2580', { mask: true });
```

## Declaring app keyboards

```ts nocheck
// keyboards.ts: imports only defineKeyboard, so the config can load it.
import { defineKeyboard } from '@toets/test';

export const keyboards = [
  defineKeyboard({
    name: 'search',
    root: { testId: 'osk' },
    fields: [{ testId: 'search-input' }],
    layers: [{ testId: 'osk-shift' }, { testId: 'osk-symbols' }],
    space: { testId: 'osk-space' },
    backspace: { testId: 'osk-del' },
    clear: { testId: 'osk-clear' },
    submit: { testId: 'osk-go' },
  }),
];
```

Pass them with `defineConfig({ keyboards })`, `platforms.*({ keyboards })` or `test.use({ keyboards })`. Each level replaces the one above. Names must be unique (`DUPLICATE_KEYBOARD`).

Each target is `{ testId?, text?, exact?, nth? }`, the selector chain `getByTestId(testId).getByText(text, { exact }).nth(nth)`.

| Field       | Resolves from | Meaning                                                                                                                        |
| ----------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `name`      |               | Shown in step titles, snapshots and errors.                                                                                    |
| `root`      | screen        | The keyboard's container. The keyboard is open while it is visible.                                                            |
| `fields`    | screen        | The fields it types into. `fill` on one of them uses this keyboard, opening it with `SELECT` when it is closed.                |
| `keys`      | `root`        | Character keys. Default: every focusable element in `root` whose text is one character. Multi-character keys (`.com`) need it. |
| `layers`    | `root`        | Toggles that switch layers (Shift, `?123`, `ABC`).                                                                             |
| `space`     | `root`        | The space key, when its text is not `' '` (usually `space` or an icon).                                                        |
| `backspace` | `root`        | Deletes one character. `erase()` needs it; `fill` uses it to clear when there is no `clear`.                                   |
| `clear`     | `root`        | Clears the field at once.                                                                                                      |
| `submit`    | `root`        | Search, Go, Done. `submit()` needs it.                                                                                         |

A key types its text. When `keys` is set, it replaces the default; list the one-character keys too.

## Which keyboard

`locator.fill(text)`:

1. A declared keyboard whose `fields` match the field (the field, an element inside it, or the focusable element holding it). Closed: toets moves focus to the field, presses `SELECT`, and waits up to `timeouts.actionMs` for `root`.
2. Else system text entry, when the field is a system text field (`editable` in the snapshot). Needs `text.input`.
3. Else `NO_KEYBOARD`.

`app.keyboard`:

1. The declared keyboard holding focus.
2. Else system text entry, when the focused element is a system text field.
3. Else the only declared keyboard on screen.
4. Else `NO_KEYBOARD` (none) or `AMBIGUOUS_KEYBOARD` (several on screen, none focused).

## How text goes in

**System text fields.** Focus moves to the field with real D-pad presses, then the driver replaces its text the way the platform's own text entry does. `fill` closes a system keyboard it opened, and checks the value afterwards.

| Platform   | `fill`                                     | `type`         | `erase`          | `submit`            |
| ---------- | ------------------------------------------ | -------------- | ---------------- | ------------------- |
| web        | select all, CDP `Input.insertText`         | `insertText`   | `delete` command | `Enter`             |
| Android TV | UiAutomator2 clear + set text (unicode)    | `mobile: type` | `KEYCODE_DEL`    | IME action (`done`) |
| tvOS       | XCUITest clear + `typeText`, `Menu` closes | `typeText`     | `typeText('\b')` | `typeText('\n')`    |

`expect(app.keyboard).toBeOpen()` passes while a declared keyboard's `root` is visible, or while the system keyboard is open: on Android TV the IME is shown, on tvOS the keyboard screen is up, and on web (no on-screen keyboard) a text field holds focus.

**App keyboards.** `fill` clears the field first (`clear`, else `backspace` once per character), types, then checks that the field shows exactly the text (`TEXT_NOT_ENTERED` otherwise). For each character, toets:

1. Reads the keyboard from one tree and picks the key: the longest key text that starts the remaining text (`.com` before `.`), or `space` for a space.
2. When no key on the current layer matches, presses the declared `layers` toggles until one does. Layers are not tracked: toets explores the toggles (each one at most once per layer it reaches) and fails with `CHAR_NOT_ON_KEYBOARD`, listing the layers it saw.
3. Plans the walk to the key from the keys' geometry, presses it at once, and checks where focus landed. A missed prediction falls back to step-by-step navigation from there.
4. Presses `SELECT` and waits until the field text (or, for a toggle, the keys) changes.

Each key is one `key` step inside the action's step.

## Values and masking

The snapshot shows a system field's value, masked when the field is secure. A declared keyboard collapses to one line: its name, its layer (named from its keys: `lower`, `upper`, `mixed`, `digits`, `symbols`) and the focused key. Snapshot the keyboard's root to see the keys.

```yaml
- email [editable] value="ada@example.com"
- password [editable, secure] value="•••••••••"
- 'osk [keyboard: search, layer: lower, focused: "m"]'
```

`toHaveValue` reads system fields only: elsewhere it fails with `NOT_EDITABLE`, and on secure fields with `SECURE_FIELD`. Text typed into an app keyboard's field is its text: use `toHaveText`.

`{ mask: true }` (automatic for secure system fields) masks the text in step titles, errors and MCP output. App keyboards do not know a field is secret: pass `mask` for PINs and passwords.

## Reports

| Step title                                                 | Annotation  |
| ---------------------------------------------------------- | ----------- |
| `fill getByTestId('search-input') "ma" (keyboard: search)` | `9 presses` |
| `fill getByTestId('email') "ada@example.com" (system)`     | `2 presses` |
| `type "••••" (keyboard: pin)`                              | `7 presses` |
| `erase 2 (keyboard: search)`, `submit (system)`            |             |

The press count arrives once the step ends, so it is a `toets` annotation on the step in the HTML report, not part of the title. The failure dump has a `keyboard:` line: the open keyboard, `system`, or `none`.

## Capabilities

| Capability   | web | Android TV | tvOS | Without it                                                            |
| ------------ | --- | ---------- | ---- | --------------------------------------------------------------------- |
| `text.input` | yes | yes        | yes  | system text fields fail with `CAPABILITY_MISSING`; app keyboards work |

App keyboards need nothing beyond the D-pad and `SELECT`. With the SDK on, the SDK reports `editable`, `value` and `secure` (protocol 1.1). Text never goes through the SDK: it is entered the way users enter it.

## Errors

| Code                      | When                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `NO_KEYBOARD`             | No declared keyboard lists the field and it is no system text field; or `SELECT` did not open the keyboard; or `app.keyboard` finds none open. |
| `AMBIGUOUS_KEYBOARD`      | Several declared keyboards are on screen and none holds focus.                                                                                 |
| `CHAR_NOT_ON_KEYBOARD`    | No key types the character on any layer reached.                                                                                               |
| `TEXT_NOT_ENTERED`        | After typing, the field does not show the text (a key typed something else, or the app rejected it).                                           |
| `KEYBOARD_ACTION_MISSING` | `erase`, `submit` or clearing need a key the keyboard does not declare or show.                                                                |
| `NOT_EDITABLE`            | `toHaveValue` on an element that is not a system text field.                                                                                   |
| `SECURE_FIELD`            | `toHaveValue` on a secure field.                                                                                                               |
| `DUPLICATE_KEYBOARD`      | Two keyboards share a name.                                                                                                                    |

All codes: [errors](./errors.md).
