---
'@toets/core': minor
'@toets/test': minor
'@toets/protocol': minor
'@toets/sdk': minor
'@toets/sdk-react-native': minor
'@toets/driver-web': minor
'@toets/mcp': minor
---

Focus is observed, never modeled. New `app.focus.pressUntil(key, target)` presses one direction until the target holds focus, works with virtualized lists, and fails fast with `FOCUS_STUCK`, `FOCUS_LOOP` or `FOCUS_UNREACHABLE`; MCP gets `press_until`. JS focus engines report focus with `reportFocus(target)` from `@toets/sdk` on every platform.

Breaking: `focus.graph` (protocol, SDK, capability), the SDK `focusedElement`/`focusNeighbors` options, `focusChanged()`, the React Native `nativeFocus` option, the web driver `focus` selectors and `TARGET_NOT_FOCUSABLE` are removed. `navigateTo` aims by geometry and learned moves only.
