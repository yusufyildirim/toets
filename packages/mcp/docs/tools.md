# MCP tools

Every device tool maps to a dpad test API and answers with the matching test code, so what works in exploration pastes into a test. Elements are addressed with a **target**: `{ testId?, text?, exact?, nth? }`, the same selectors tests use (`app.getByTestId(id).getByText(text)`). Prefer test IDs.

| Tool           | Does                                                                                | In a test                               |
| -------------- | ----------------------------------------------------------------------------------- | --------------------------------------- |
| `launch`       | Starts or restarts the app on a target. Needed first.                               | `await app.launch()`                    |
| `snapshot`     | YAML text snapshot of the screen (or a subtree), focus-aware.                       | `await app.snapshot()`                  |
| `press`        | Presses remote keys in order; reports where focus landed.                           | `app.remote.press / repeat / sequence`  |
| `navigate_to`  | Moves focus to a target with real D-pad presses; reports the path.                  | `await app.focus.navigateTo(locator)`   |
| `query`        | Lists current matches of a target with state and bounds.                            | `app.getByTestId(...)`                  |
| `assert`       | `toBeVisible`, `toBeFocused`, `toHaveText`, `toContainText`, retried until timeout. | `await expect(locator).toBeFocused()`   |
| `screenshot`   | PNG of the screen (or one element with `screenshot.element`).                       | `await app.screenshot()`                |
| `capabilities` | Platform, capabilities, supported keys, configured targets.                         | `requires: [...]`, `app.platform.has()` |
| `docs_search`  | Searches the docs shipped in installed `@dpad-tv/*` packages.                       |                                         |

## Text snapshot

```yaml
- view [testId=home, focus-within]:
    - text: 'Popular'
    - view [testId=rail_popular, focus-within]:
        - focusable [testId=card_1, focused]: 'Movie 1'
        - focusable [testId=card_2]: 'Movie 2'
        - focusable [testId=card_9, offscreen]: 'Movie 9'
```

Kinds: `focusable`, `view` (has a test ID), `text`. States: `focused`, `focus-within`, `selected`, `disabled`, `busy`, `offscreen` (visible but outside the viewport). Hidden elements and anonymous wrappers are left out; bounds are left out so snapshots compare across platforms (`query` shows bounds).

## Errors

Failures come back as tool errors with a code, a hint and a docs slug, like every dpad error. Common ones:

| Code                    | Meaning and fix                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `MCP_NOT_LAUNCHED`      | Call `launch` first.                                                                                  |
| `MCP_NO_CONFIG`         | No `dpad.mcp.config.*`; see [setup](./setup.md).                                                      |
| `KEY_UNSUPPORTED`       | The target lacks the key's capability; check `capabilities`.                                          |
| `ELEMENT_NOT_FOUND`     | Nothing matches. Virtualized lists only render items near focus: move toward it.                      |
| `STRICT_MODE_VIOLATION` | The target matches several elements; use a test ID, `exact` or `nth`.                                 |
| `MCP_UNREACHABLE`       | Focus can not get there (disabled, not focusable, focus trap). The message says where focus is stuck. |

`assert` failing is also a tool error: `FAIL after 5000ms: <code>` plus what was received.
