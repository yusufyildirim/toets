# @toets/driver-web

## 0.2.0

### Minor Changes

- a6ff1a2: Focus is observed, never modeled. New `app.focus.pressUntilFocused(key, target)` presses one direction until the target holds focus, works with virtualized lists, and fails fast with `FOCUS_STUCK`, `FOCUS_LOOP` or `FOCUS_UNREACHABLE`; MCP gets `press_until_focused`. JS focus engines report focus with `reportFocus(target)` from `@toets/sdk` on every platform.

  Breaking: `focus.graph` (protocol, SDK, capability), the SDK `focusedElement`/`focusNeighbors` options, `focusChanged()`, the React Native `nativeFocus` option, the web driver `focus` selectors and `TARGET_NOT_FOCUSABLE` are removed. `navigateTo` aims by geometry and learned moves only.

### Patch Changes

- Updated dependencies [a6ff1a2]
  - @toets/core@0.2.0
  - @toets/protocol@0.2.0

## 0.1.0

### Minor Changes

- 9fbc939: Initial release.

### Patch Changes

- Updated dependencies [9fbc939]
  - @toets/core@0.1.0
  - @toets/protocol@0.1.0
