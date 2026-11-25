# MCP tools

Every device tool runs the toets core code its test API runs and answers with the matching test code, so what works in exploration pastes into a test. Elements are addressed with a **target**: `{ testId?, text?, exact?, nth? }`, the same selectors tests use (`app.getByTestId(id).getByText(text).nth(n)`). Prefer test IDs.

| Tool                  | Does                                                                                     | In a test                                               |
| --------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `launch`              | Starts or restarts the app on a target, optionally into a `state` with `flags`.          | `await app.launch({ state, flags })`                    |
| `snapshot`            | Text snapshot of the screen (or a subtree), byte for byte what a test gets.              | `await app.snapshot()`                                  |
| `press`               | Presses remote keys in order (key overrides applied); reports where focus landed.        | `app.remote.press / repeat / sequence`                  |
| `press_until_focused` | Presses one D-pad direction until a target holds focus; reports the presses.             | `await app.focus.pressUntilFocused(Key.RIGHT, locator)` |
| `navigate_to`         | Moves focus to an on-screen target with real D-pad presses; reports the path.            | `await app.focus.navigateTo(locator)`                   |
| `fill`                | Replaces a field's text with its keyboard (declared app keyboard or system); no submit.  | `await locator.fill(text, { mask })`                    |
| `type`                | Types at the end of the field on the keyboard in use.                                    | `await app.keyboard.type(text, { mask })`               |
| `erase`               | Deletes characters with the keyboard's backspace.                                        | `await app.keyboard.erase(count)`                       |
| `submit`              | Presses the keyboard's submit key (or the system action key).                            | `await app.keyboard.submit()`                           |
| `query`               | Lists current matches of a target with state and bounds.                                 | `app.getByTestId(...)`                                  |
| `assert`              | Any toets matcher, retried until timeout; passes and fails exactly like `expect`.        | `await expect(locator).toBeFocused()`                   |
| `screenshot`          | PNG of the screen or of one element.                                                     | `await app.screenshot()`, `locator.screenshot()`        |
| `capabilities`        | Platform, capabilities, keys, key overrides, keyboards, SDK and mocking status, targets. | `requires(...)`, `app.platform.has()`                   |
| `docs_search`         | Searches the docs shipped in installed `@toets/*` packages.                              |                                                         |

## Matchers

`assert` takes every toets matcher except the screenshot baseline: locator states (`toBeVisible`, `toBeInViewport`, `toBeFocused`, `toHaveFocusWithin`, `toBeEnabled`, `toBeDisabled`, `toBeSelected`, `toBeBusy`), `toHaveText`, `toContainText`, `toHaveValue`, `toHaveCount`, `toMatchTextSnapshot` (screen or `target`), media (`toBePlaying`, `toBePaused`, `toHaveMediaState`, `toHavePosition`), `toHaveRequested` and `toBeOpen` (on `app.keyboard`, no target). Any of them with `not`.

## Text entry

`fill`, `type`, `erase` and `submit` pick the keyboard like tests do; see [text input](../../core/docs/text-input.md). App keyboards come from the `keyboards` option of the test config (or `keyboards` in `toets.mcp.config.*`, top level or per target); `capabilities` lists them. Pass `mask: true` for PINs and passwords: the text never shows in the output, and the code line carries a placeholder to replace. System password fields mask on their own.

## Text snapshot

The [core text snapshot](../../core/docs/text-snapshots.md) format, so `snapshot` output pastes into `toMatchTextSnapshot`:

```yaml
- rail_popular:
    - card_1 "Movie 1" [focused]
    - card_2 "Movie 2"
```

System text fields show their value, and a declared app keyboard collapses to one line (`snapshot` with its `target` shows the keys):

```yaml
- email [editable] value="a@b.co"
- password [editable, secure] value="••••"
- 'osk [keyboard: search, layer: lower, focused: "m"]'
```

## Errors

Failures come back as tool errors with a code, a hint and a docs link, like every toets error. Common ones:

| Code                    | Meaning and fix                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `MCP_NOT_LAUNCHED`      | Call `launch` first.                                                                              |
| `MCP_NO_CONFIG`         | No test config with toets projects and no `toets.mcp.config.*`; see [setup](./setup.md).          |
| `KEY_UNSUPPORTED`       | The target lacks the key's capability; check `capabilities`. Nothing was pressed.                 |
| `CAPABILITY_MISSING`    | `state`, media or network checks need the SDK or mocking on.                                      |
| `ELEMENT_NOT_FOUND`     | Nothing matches. Virtualized lists only render items near focus: `press_until_focused` toward it. |
| `STRICT_MODE_VIOLATION` | The target matches several elements; use a test ID, `exact` or `nth`.                             |
| `FOCUS_STUCK`           | A `press_until_focused` press did not move focus: end of a row, a trap or a disabled target.      |
| `FOCUS_LOOP`            | Focus came back to an element it left: the target is not in that direction.                       |
| `NO_KEYBOARD`           | No declared keyboard lists the field and it is no system text field; add one to `keyboards`.      |
| `CHAR_NOT_ON_KEYBOARD`  | No key types the character on any layer reached; declare `layers`, `keys` or `space`.             |
| `FOCUS_UNREACHABLE`     | D-pad presses can not get there (focus trap, disabled path). The message says where focus is.     |

`assert` failing is also a tool error: `FAIL after 5000ms: <code>`, then the message `expect` would print.
