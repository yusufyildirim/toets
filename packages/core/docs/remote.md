# Remote

`app.remote` sends real key events, the same way a user's remote does. Keys are semantic (`Key.SELECT`, `Key.BACK`, `Key.PLAY_PAUSE`); each driver maps them to its platform.

```ts nocheck
await app.remote.press(Key.DOWN);
await app.remote.repeat(Key.RIGHT, 3);
await app.remote.sequence([Key.DOWN, Key.SELECT]);
await app.remote.longPress(Key.SELECT, 800);
```

## Principles

- **Capabilities, not platform checks.** D-pad and `SELECT` work everywhere. Other keys need a capability (`BACK` needs `key.back`, color keys need `key.color`, ...). Pressing an unsupported key fails with `KEY_UNSUPPORTED`; `repeat` and `sequence` check every key before the first press, so they never stop half-way. Declare it with `requires('key.color')` so the test is skipped on platforms without it.
- **Key overrides describe the app, not the platform.** When an app maps a semantic key to another gesture, configure it once instead of branching in tests:

  ```ts nocheck
  dpad: { keyOverrides: { FAST_FORWARD: { as: Key.RIGHT, holdMs: 800 } } }
  ```

  The step reads `press FAST_FORWARD (override: hold RIGHT 800ms)` and the parity report flags the test, so overrides never hide silently.

- **Every press is a step** in the Playwright report, and the last keys appear in failure dumps.

## TV trap: tvOS has no BACK

The Siri Remote's back button is `MENU`, and there are no color or numeric keys. Write `Key.BACK` and let the tvOS driver map it, or override it for your app; do not branch on the platform.
