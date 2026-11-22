# Android TV performance

Every state read is one UiAutomator2 page-source fetch, mapped to snapshots on the host. `query`, `focused` and `tree` never make per-element round trips, so their cost does not grow with the number of matches or chain steps.

## Measured latency

Host-side wall time per driver call, measured by the integration test (`test/integration.test.ts` writes `latency.json`). Apple M4 Pro, macOS 26.7, `tv_1080p` API 33 arm64 emulator, fixture app home screen (~40 elements):

| Action                                           | p50     | p90    |
| ------------------------------------------------ | ------- | ------ |
| `query` / `focused`                              | 16 ms   | 24 ms  |
| `tree`                                           | 24 ms   | 44 ms  |
| `press`                                          | 37 ms   | 51 ms  |
| `screenshot` (viewport, PNG)                     | 195 ms  | 218 ms |
| `screenshot` (element)                           | ~120 ms | -      |
| `press` with `holdMs: 500`                       | 1.5 s   | 1.6 s  |
| `launch` (force-stop + start, `am start -W`)     | 0.6 s   | 0.8 s  |
| `reset` (`pm clear`)                             | 0.16 s  | -      |
| `start` (Appium server + session, app installed) | 6 s     | -      |

The first `start` on a fresh emulator also installs the UiAutomator2 server APKs (tens of seconds). A hold costs about 1 s on top of `holdMs` because the helper JVM starts per hold.

## What dpad changes in UiAutomator2

`waitForIdleTimeout: 0`: UiAutomator otherwise waits up to 10 s for the UI to settle before every command, and TV screens with video or focus animations may never settle. dpad retries assertions in the core instead. `allowInvisibleElements: true` keeps not-displayed elements in the tree so they report `visible: false`. Override with `appium.settings`.

## Trap

Polling `focused()` after a `press` is cheap (~20 ms), but focus moves asynchronously: the press returns when the event is injected, not when the app has moved focus. Assert with retrying matchers (`toBeFocused`), never read once.
