---
'@toets/core': minor
'@toets/test': minor
'@toets/protocol': minor
'@toets/sdk': minor
'@toets/sdk-react-native': minor
'@toets/driver-web': minor
'@toets/driver-android-tv': minor
'@toets/driver-tvos': minor
'@toets/mcp': minor
---

Text input. `locator.fill(text)` and `app.keyboard` (`type`, `erase`, `submit`) enter text like a user: system text fields through the platform's text entry (new `text.input` capability: CDP `insertText` on web, UiAutomator2 on Android TV, XCUITest on tvOS), app-drawn keyboards declared with `defineKeyboard()` in the new `keyboards` option, typed key by key with the remote. New matchers `toHaveValue` and `expect(app.keyboard).toBeOpen()`; `{ mask: true }` hides secrets in reports. Snapshots show `editable`, `secure` and `value` and collapse declared keyboards to one line; failure dumps name the open keyboard. Protocol 1.1: nodes carry `editable`, `value` and `secure` (masked). MCP: `fill`, `type`, `erase` and `submit` tools. New error codes `NO_KEYBOARD`, `AMBIGUOUS_KEYBOARD`, `CHAR_NOT_ON_KEYBOARD`, `TEXT_NOT_ENTERED`, `KEYBOARD_ACTION_MISSING`, `NOT_EDITABLE`, `SECURE_FIELD`, `DUPLICATE_KEYBOARD`. Navigation keeps pressing while an arrow moves a text field's caret instead of focus. Android TV sends D-pad keys and `SELECT` from the D-pad input source, like a remote, so focus leaves a focused `EditText`. Fixes the W3C element key the Android TV and tvOS drivers read.
