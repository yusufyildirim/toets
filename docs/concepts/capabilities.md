---
description: Platforms declare what they can do as capabilities. Tests declare what they need with requires; unmet requirements skip with a reason and show in the parity matrix.
---

# Capabilities and parity

toets's promise is that a test means the same thing on every platform. Where a platform can not do something, it says so through a **capability** instead of approximating it. Tests declare the capabilities they need; on platforms without them the test is **skipped with a reason**, never silently changed.

```ts run
import { test, expect, Key, requires } from '@toets/test';

test('the red key opens the guide', requires('key.color'), async ({ app }) => {
  await app.launch();
  await app.remote.press(Key.RED);
  await expect(app.getByTestId('guide')).toBeVisible();
});
```

## Where capabilities come from

A target's capabilities are the union of its **driver's** (what the platform and its automation can do) and those granted by the [in-app SDK](./sdk.md) when connected (`tree.hierarchy`, `sync.idle`, `media.state`, `app.state`, `logs`).

| Capability           | Means                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `key.*`              | the remote has the key, see [Remote and keys](./remote-and-keys.md)                                                            |
| `key.longpress`      | keys can be held                                                                                                               |
| `tree.hierarchy`     | the tree nests like the app's views (a whole-screen [text snapshot](./text-snapshots.md) has the same shape everywhere)        |
| `text.input`         | system text fields take text: `fill` and `app.keyboard` on them, see [Text input](./text-input.md)                             |
| `deeplink.launch`    | `app.launch({ deepLink })` starts the app from a link, see [Deep links](./deep-links.md)                                       |
| `deeplink.open`      | `app.openDeepLink(url)` delivers a link to the running app                                                                     |
| `sync.idle`          | the app reports when it is idle, see [Idle](./idle.md)                                                                         |
| `media.state`        | player state can be read: `expect(app.media)`                                                                                  |
| `app.state`          | `app.launch({ state })` can start in a named state                                                                             |
| `network.mock`       | [network mocking](./network-mocking.md) is available                                                                           |
| `screenshot.element` | screenshots of a single element                                                                                                |
| `platform.events`    | `app.platform.emit('suspend' \| 'resume' \| 'network-lost' \| 'network-restored')`; a lost network is restored after each test |
| `logs`, `video`      | device logs and screen recording are attached to results                                                                       |

Each platform's set: [web](../reference/driver-web/docs/capabilities.md), [Android TV](../reference/driver-android-tv/docs/capabilities.md), [tvOS](../reference/driver-tvos/docs/capabilities.md). For `requires`, SDK capabilities count as present when `toets.sdk` is on (the app only connects at launch), and `network.mock` when `toets.mock` is on.

`requires(...)` also works on a `test.describe` (`test.describe('guide', requires('key.color'), () => ...)`) and merges with other details: `{ ...requires('media.state'), tag: '@smoke' }`. Reference: [`requires`](../reference/test/docs/requires.md).

## Parity matrix

Every run writes `toets-report/parity.md`: which test ran on which platform, and why each skip happened. A gap is visible, not a silent difference. See [reporting](../reference/test/docs/reporting.md).

## Traps

- **Do not branch on the platform.** `if (app.platform.name === 'tvos')` hides a gap inside a passing test. Declare `requires`, or split the test.
- **`app.platform.has(capability)`** exists for page objects and fixtures that adapt how they do something, not for tests deciding whether to check it.
- **The escape hatch is a last resort.** `app.platformOnly(platform, handle => ...)` runs code against the underlying tool (Playwright `Page`, WebdriverIO browser) on one platform and is a no-op elsewhere. It is marked in reports and flagged by the ESLint plugin. Prefer asking for a capability.
