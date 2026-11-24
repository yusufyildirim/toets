---
description: The tvOS platform drives apps on Apple TV simulators through Appium XCUITest. The Siri Remote has few buttons, so many keys are capability-gated.
---

# tvOS

Runs the app on Apple TV simulators through Appium XCUITest. toets manages the Appium server and, by default, the simulators: one per worker, reset between tests. Package: [`@toets/driver-tvos`](../reference/driver-tvos.md).

```ts
import { defineConfig, platforms } from '@toets/test';

export default defineConfig({
  app: { tvOS: { app: './build/Example.app', bundleId: 'com.example.tv' } },
  projects: [platforms.tvOS({ osVersion: '18' })],
});
```

**Host:** macOS with Xcode and a tvOS simulator runtime. The `.app` must be built for the simulator (`-sdk appletvsimulator`). See [tvOS on macOS](../ci/tvos.md) for CI.

| Aspect    | tvOS                                                                                    |
| --------- | --------------------------------------------------------------------------------------- |
| Test ID   | `accessibilityIdentifier`                                                               |
| Focus     | the element with focus, or the SDK's focus when connected                               |
| Keys      | Siri Remote buttons only                                                                |
| Launch    | launch payload as the `-__toets` launch argument; the simulator shares the host network |
| Artifacts | simulator logs, screen recording (`toets.video`)                                        |

`osVersion` is a tvOS version prefix (`18` matches 18.x); `model` an Apple TV device type name. Options: [tvOS setup](../reference/driver-tvos/docs/setup.md) and [simulators](../reference/driver-tvos/docs/simulators.md).

## Keys

The remote has up, down, left, right, select, back (the Menu button), play/pause and home, and buttons can be held. So `key.back`, `key.home`, `key.media.toggle` and `key.longpress` are available; color, numeric, channel, info, menu, discrete media, seek and track keys are not. Tests that need them are skipped here with a reason. If your app implements, say, fast-forward as "hold right", declare a [key override](../concepts/remote-and-keys.md#overrides).

## Traps

- **The focus engine is strict.** tvOS only focuses elements the app marks focusable, and moves by its own geometry rules. A test that passes on web can fail here for real reasons.
- **First run builds WebDriverAgent.** It takes about a minute once per Xcode version (cached in `~/Library/Caches/toets/tvos-wda`); cache that folder in CI.
- **`BACK` on the home screen leaves the app.** As on a real Apple TV.
