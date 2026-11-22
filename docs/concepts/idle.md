---
description: Assertions always retry with a timeout. With the SDK, dpad also knows when the app is idle, which makes checks faster and negative assertions trustworthy. Idle is an accelerator, never a gate.
---

# Idle and synchronization

Every dpad assertion **retries until it passes or times out**. That alone makes tests correct without sleeps. When the [in-app SDK](./sdk.md) is enabled (`dpad: { sdk: true }`) and connected (`sync.idle`), dpad additionally knows when the app is **idle**, and evaluates checks at moments where the screen is settled.

The app is idle when it has had no tracked work for about 100 ms. Tracked work: network requests, animations, short timers (under about 1.5 s), focus and navigation transitions, and anything the app marks busy itself.

```ts run
import { test, expect, Key } from '@dpad-tv/test';

test('closing the menu leaves no overlay behind', async ({ app }) => {
  await app.launch();
  await app.remote.press(Key.LEFT);
  await expect(app.getByTestId('side-menu')).toHaveFocusWithin();

  await app.remote.press(Key.RIGHT);
  await expect(app.getByTestId('home-screen')).toHaveFocusWithin();
  await expect(app.getByTestId('side-menu')).not.toBeVisible();
});
```

## What idle changes

| Without idle                                   | With idle                                           |
| ---------------------------------------------- | --------------------------------------------------- |
| assertions poll until they pass                | assertions check when the app settles, then poll    |
| `.not` passes as soon as the element is absent | `.not` passes once the app is idle and it is absent |
| a timeout says what was expected               | a timeout also names what kept the app busy         |

## Never a gate

Idle only speeds things up. A video player, a clock or a polling request can keep an app busy forever; after `dpad.idle.budgetMs` (default 2000) dpad falls back to polling and names the busy resource in the failure message. Exclude known noise with the SDK's `idle.ignore`, and mark work the SDK cannot see with `markBusy()`: [idle tracking](../reference/sdk/docs/idle.md). Host-side options: [idle sync](../reference/core/docs/idle.md).

## Traps

- **Negative assertions pass too early.** Without idle, `not.toBeVisible()` passes before the element had a chance to appear. Anchor it on a positive assertion that proves the screen reached the state you mean, as in the example.
- **Never sleep.** A fixed wait is either too short on a slow emulator or wasted time everywhere else. If you need to wait for something, assert it.
- **Raising timeouts hides busy apps.** When an assertion times out with a busy resource named, the fix is usually in the app or the SDK noise configuration, not in the timeout.
