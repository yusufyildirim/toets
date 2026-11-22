# requires

`requires(...capabilities)` declares what a test needs. On a platform without it, the test is skipped with the reason instead of failing, and the parity report shows where and why.

```ts run
import { test, expect, requires, Key } from '@dpad-tv/test';

test('green key opens the guide', requires('key.color'), async ({ app }) => {
  await app.launch();
  await app.remote.press(Key.GREEN);
  await expect(app.getByTestId('guide')).toBeVisible();
});

test.describe('player', requires('media.state'), () => {
  test('toggles playback', async ({ app }) => {
    /* ... */
  });
});

test('tagged', { ...requires('key.numeric'), tag: '@smoke' }, async ({ app }) => {
  /* ... */
});
```

## Principles

- **It is a Playwright annotation** (`{ type: 'requires' }`), so it works on tests and `describe` blocks and keeps test locations, UI mode and reporters intact.
- **Skip reason format:** `requires key.color: not available on tvos`; when only a dpad option is missing: `requires media.state: not available on web (dpad.sdk off)`.
- **The check is against declared capabilities:** the driver's, plus SDK capabilities when `sdk` is on (the app connects only at launch), plus `network.mock` when `mock` is on.
- **Declare what the test uses, not the platform it targets.** `requires('key.color')` stays correct when a new platform gains color keys; skipping on `tvos` does not.

## TV trap: overrides are not requirements

A key override (`FAST_FORWARD` performed as a long `RIGHT`) means the app supports the action differently, so the test runs, and the parity report flags it. Use `requires` only when the platform truly cannot do it.
