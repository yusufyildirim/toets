# Config

A dpad suite is a Playwright Test suite with one project per platform. `defineConfig` and `platforms.*` from `@dpad-tv/test` build it.

```ts
// playwright.config.ts
import { defineConfig, platforms, Key } from '@dpad-tv/test';

export default defineConfig({
  testDir: 'e2e',
  app: {
    web: { url: 'http://localhost:8080' },
    androidTV: { apk: 'build/app.apk', package: 'com.example.tv' },
    tvOS: { app: 'build/App.app', bundleId: 'com.example.tv' },
  },
  dpad: { sdk: true, mock: true },
  projects: [
    platforms.web(),
    platforms.androidTV({ model: 'tv_1080p', osVersion: '34' }),
    platforms.tvOS({ dpad: { keyOverrides: { FAST_FORWARD: { as: Key.RIGHT, holdMs: 800 } } } }),
  ],
});
```

## Principles

- **Everything Playwright stays Playwright.** `workers`, `retries`, `reporter`, `grep`, `expect.timeout`, UI mode and sharding work unchanged.
- **One project per platform.** A project name defaults to the platform (`web`, `android-tv`, `tvos`); add more projects for more devices of one platform.
- **Drivers load lazily by package name**: `@dpad-tv/driver-web`, `@dpad-tv/driver-android-tv`, `@dpad-tv/driver-tvos`. Install only the ones you use. `driver` overrides the module (a package or a path relative to the config file).
- **One flat options object per project.** `platforms.androidTV({ ... })` takes Playwright project fields (`name`, `retries`, `use`, ...), dpad's keys (`driver`, `app`, `model`, `osVersion`, `devices`, `dpad`) and the driver's options (e.g. `remote: 'fire-tv'`), typed by the driver package. A custom driver passes its type: `platforms.web<MyOptions>({ driver: './my-driver.ts', ... })`.
- **`model` and `osVersion`** tell the device provider what to boot or lease, e.g. `model: 'tv_1080p', osVersion: '34'`.
- **Relative app paths** (`apk`, `app`) resolve against the config file's directory.
- **Options merge** from the top-level `dpad` into each project's `dpad`. The `app` entry for the platform merges with the project's `app`.
- **The parity reporter is added** after your reporters; `parityReport: false` turns it off. Without a `reporter`, dpad uses `list` (`dot` in CI) and `html` (`open: 'never'`), so `npx playwright show-report` works.

| `dpad` option  | Meaning                                                                                |
| -------------- | -------------------------------------------------------------------------------------- |
| `sdk`          | Wait for the in-app SDK on launch (adds idle sync, focus graph, media, launch states). |
| `mock`         | Run a host-side mock server per worker (`network.mock`).                               |
| `keyOverrides` | How a semantic key is performed for this app. Flagged in reports.                      |
| `timeouts`     | `actionMs`, `sdkConnectMs`, `navigationSettleMs`. Assertions use `expect.timeout`.     |
| `remote`       | `intervalMs` between `repeat`/`sequence` presses (100), `longPressMs` (1000).          |
| `idle`         | `quietMs`, `budgetMs`: how long assertions wait for idle before polling.               |
| `steps`        | Attach a screenshot and/or text snapshot after every action (costly on devices).       |
| `video`        | `off`, `on`, `retain-on-failure`, where the driver supports `video`.                   |

## TV trap: one worker per device

Each worker drives one device. `workers` above the number of devices you can run (emulators are heavy; tvOS simulators need a Mac each) makes workers wait for or fail to get a device. Start with `workers: 1` on device projects.
