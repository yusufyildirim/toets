# @toets/protocol

## 0.3.0

### Minor Changes

- d1ed8c3: Text input. `locator.fill(text)` and `app.keyboard` (`type`, `erase`, `submit`) enter text like a user: system text fields through the platform's text entry (new `text.input` capability: CDP `insertText` on web, UiAutomator2 on Android TV, XCUITest on tvOS), app-drawn keyboards declared with `defineKeyboard()` in the new `keyboards` option, typed key by key with the remote. New matchers `toHaveValue` and `expect(app.keyboard).toBeOpen()`; `{ mask: true }` hides secrets in reports. Snapshots show `editable`, `secure` and `value` and collapse declared keyboards to one line; failure dumps name the open keyboard. Protocol 1.1: nodes carry `editable`, `value` and `secure` (masked). MCP: `fill`, `type`, `erase` and `submit` tools. New error codes `NO_KEYBOARD`, `AMBIGUOUS_KEYBOARD`, `CHAR_NOT_ON_KEYBOARD`, `TEXT_NOT_ENTERED`, `KEYBOARD_ACTION_MISSING`, `NOT_EDITABLE`, `SECURE_FIELD`, `DUPLICATE_KEYBOARD`. With the SDK on, a native element holding focus without a framework focus event (a react-native-tvos `TextInput` on tvOS) counts as focused. Android TV sends D-pad keys and `SELECT` from the D-pad input source, like a remote, so focus leaves a focused `EditText`. Fixes the W3C element key the Android TV and tvOS drivers read.

## 0.2.0

### Minor Changes

- a6ff1a2: Focus is observed, never modeled. New `app.focus.pressUntilFocused(key, target)` presses one direction until the target holds focus, works with virtualized lists, and fails fast with `FOCUS_STUCK`, `FOCUS_LOOP` or `FOCUS_UNREACHABLE`; MCP gets `press_until_focused`. JS focus engines report focus with `reportFocus(target)` from `@toets/sdk` on every platform.

  Breaking: `focus.graph` (protocol, SDK, capability), the SDK `focusedElement`/`focusNeighbors` options, `focusChanged()`, the React Native `nativeFocus` option, the web driver `focus` selectors and `TARGET_NOT_FOCUSABLE` are removed. `navigateTo` aims by geometry and learned moves only.

## 0.1.0

### Minor Changes

- 9fbc939: Initial release.
