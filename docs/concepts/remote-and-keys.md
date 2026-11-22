---
description: Semantic remote keys that each platform maps honestly, with capability gating for keys a remote does not have and app-level overrides.
---

# Remote and keys

Tests press **semantic keys** (`Key.SELECT`, `Key.PLAY_PAUSE`), never platform keycodes. Each driver maps a key to real input on its platform: an Android keycode, an Apple TV remote button, a browser keyboard event. Input is always real platform input, never an event injected into the app, so the app's own focus engine and key handling are what get tested.

```ts
import { test, expect, Key } from '@dpad-tv/test';

test('toggles playback from the remote', async ({ app }) => {
  await app.launch();
  await app.focus.navigateTo(app.getByTestId('play-button'));
  await app.remote.press(Key.SELECT);
  await expect(app.media).toBePlaying();

  await app.remote.press(Key.PLAY_PAUSE);
  await expect(app.media).toBePaused();
});
```

## API

- `press(key)`: one press. `press(key, { holdMs })` holds it.
- `longPress(key, holdMs?)`: a long press (`key.longpress`).
- `repeat(key, times, { intervalMs })`: the same key several times.
- `sequence(keys, { intervalMs })`: several keys in order.

## Keys and capabilities

D-pad (`UP`, `DOWN`, `LEFT`, `RIGHT`) and `SELECT` exist everywhere. Every other key needs a [capability](./capabilities.md):

| Keys                                         | Capability                                     |
| -------------------------------------------- | ---------------------------------------------- |
| `BACK`, `HOME`, `MENU`, `INFO`               | `key.back`, `key.home`, `key.menu`, `key.info` |
| `PLAY_PAUSE`                                 | `key.media.toggle`                             |
| `PLAY`, `PAUSE`, `STOP`                      | `key.media.discrete`                           |
| `FAST_FORWARD`, `REWIND`, `NEXT`, `PREVIOUS` | `key.media.transport`                          |
| `RED`, `GREEN`, `YELLOW`, `BLUE`             | `key.color`                                    |
| `DIGIT_0` ... `DIGIT_9`                      | `key.numeric`                                  |
| `CHANNEL_UP`, `CHANNEL_DOWN`                 | `key.channel`                                  |

Pressing a key the platform lacks throws an error naming the capability. Tests that need such a key declare it with `requires` and are skipped, with a reason, where it is missing.

## Overrides

Some apps define their own gesture for a key the remote lacks, for example "hold right to fast-forward" on Apple TV. Declare it once in the config instead of branching in tests; overridden presses are flagged in the report.

```ts pending
import { defineConfig, platforms, Key } from '@dpad-tv/test';

export default defineConfig({
  app: { tvOS: { app: './build/Example.app', bundleId: 'com.example.tv' } },
  projects: [
    platforms.tvOS({
      keyOverrides: { FAST_FORWARD: { key: Key.RIGHT, holdMs: 800 } },
    }),
  ],
});
```

## Traps

- **`PLAY`, `PAUSE` and `PLAY_PAUSE` are different keys.** Most remotes only have the toggle. Use `PLAY_PAUSE` unless the test is about discrete play or pause.
- **`BACK` is the Menu button on Apple TV.** The driver maps it; tests stay semantic.
- **Fixed key sequences are brittle.** `repeat(Key.RIGHT, 7)` encodes today's layout. Use [`navigateTo`](./focus.md) unless the sequence itself is under test.
- **Key timing is realistic.** Presses have human-like spacing so focus animations and debouncing behave as on a device. Do not add sleeps between presses.
