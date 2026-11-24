# prefer-semantic-keys

Requires `Key` values in `remote.press`, `remote.longPress`, `remote.repeat` and `remote.sequence`. Reports numeric keycodes, string keys and template literals. Offers a suggestion to `Key.X` when the string is a key name or a known alias (`'ArrowUp'`, `'Enter'`, `'KEYCODE_DPAD_CENTER'`, ...).

## Why

Keycodes are platform-specific: `19` is D-pad up on Android only, `'ArrowUp'` is a web key, `menu` is a tvOS button that means back. toets drivers map each semantic `Key` to what the platform's remote really has, and refuse keys a platform lacks with a clear error. Raw values bypass both the mapping and the capability check.

```ts nocheck
// Bad
await app.remote.press(19);
await app.remote.press('ArrowUp');
await app.remote.press('UP');

// Good
import { Key } from '@toets/test';

await app.remote.press(Key.UP);
```

Only calls on an object named `remote` (or ending in `remote`, e.g. `app.remote`, `tvRemote`) are checked, so unrelated `press` methods are left alone.
