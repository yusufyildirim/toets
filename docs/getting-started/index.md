---
description: Install toets, configure platforms and run a first cross-platform TV test.
---

# Install and first test

toets is a set of [Playwright Test](https://playwright.dev/docs/intro) fixtures for TV apps. Every platform is a Playwright project, and every test receives one fixture, `app`: the app under test on the current platform. You keep Playwright's runner, reporters, UI mode, retries and sharding.

::: warning Pre-alpha
toets is not on npm yet and its APIs may change. Until the first release, install tarballs packed from a checkout of the toets repository:

```sh
# in the toets checkout: packs every package into /tmp/toets (absolute path)
pnpm install && pnpm build && pnpm pack:local /tmp/toets
# in your project, instead of the npm install below (add toets-tv-sdk for the in-app SDK)
npm install --save-dev /tmp/toets/toets-tv-{core,protocol,mock,test,driver-web}-0.0.0.tgz @playwright/test
```

Install tarballs, not `link:`s to the checkout: a link loads the checkout's own `@playwright/test` next to yours and fails with `Playwright Test did not expect test() to be called here`. With pnpm, also set `pnpm.overrides` for `@toets/core`, `@toets/protocol` and `@toets/mock` to their `file:` tarballs, or it looks them up on npm.

:::

## Requirements

| Platform             | Host                     | Needs                                       |
| -------------------- | ------------------------ | ------------------------------------------- |
| Web                  | any                      | Chromium, installed through Playwright      |
| Android TV / Fire TV | macOS, or Linux with KVM | Android SDK with an Android TV system image |
| tvOS                 | macOS                    | Xcode with a tvOS simulator runtime         |

Node 24 or later. toets starts Appium and boots, resets and shuts down emulators and simulators itself; see the [platform pages](../platforms/web.md).

## 1. Install

```sh
npm install --save-dev @toets/test @playwright/test
# one driver per platform you target
npm install --save-dev @toets/driver-web @toets/driver-android-tv @toets/driver-tvos
npx playwright install chromium
```

Drivers load when a project first needs them, so install only the platforms you test.

## 2. Configure

`playwright.config.ts`:

```ts
import { defineConfig, platforms } from '@toets/test';

export default defineConfig({
  testDir: './e2e',
  webServer: { command: 'npm run serve', url: 'http://localhost:8080' },
  app: {
    web: { url: 'http://localhost:8080' },
    androidTV: { apk: './build/app-debug.apk', package: 'com.example.tv' },
    tvOS: { app: './build/Example.app', bundleId: 'com.example.tv' },
  },
  projects: [
    platforms.web(),
    platforms.androidTV({ model: 'tv_1080p', osVersion: '34' }),
    platforms.tvOS({ osVersion: '18' }),
  ],
});
```

- `app` says how to start the app on each platform; `projects` says where tests run. Drop the platforms you do not target.
- toets does not serve or build the app. `webServer` (Playwright's option) serves the web build; the APK and `.app` come from your build.
- Project names are the platform names: `web`, `android-tv`, `tvos`.
- App-specific flows (sign-in, waiting for your splash screen) belong in your own fixtures, not here: see [Writing tests](../guides/writing-tests.md).

Every option: [`@toets/test` config](../reference/test/docs/config.md).

## 3. Give elements test IDs

toets finds elements by test ID or text. The test ID is `data-testid` on web, the resource ID on Android and the accessibility identifier on tvOS; React Native's `testID` sets all three. Elements also need to be focusable the way the platform expects (on web: a focusable element or `tabindex`). See [Locators and assertions](../concepts/locators-and-assertions.md).

## 4. Write a test

`e2e/home.spec.ts`:

```ts run
import { test, expect, Key } from '@toets/test';

test('opens details from the first rail', async ({ app }) => {
  await app.launch();

  const card = app.getByTestId('rail-0-card-2');
  await app.focus.pressUntil(Key.RIGHT, card);
  await expect(card).toBeFocused();

  await app.remote.press(Key.SELECT);
  await expect(app.getByTestId('details-screen')).toBeVisible();
});
```

There is no click. `pressUntil` presses `RIGHT` until the card holds focus, checking where focus landed after every press; then `SELECT` activates it. See [Focus](../concepts/focus.md).

## 5. Run

```sh
npx playwright test --project=web   # fastest loop
npx playwright test                 # every platform
npx playwright show-report          # steps, failure dumps, logs
```

A run ends with the parity summary; the full matrix (which test ran on which platform, and why any was skipped) is in `toets-report/parity.md`:

```text
  1 passed (1.3s)

toets parity (1 tests): web: 1 passed
Parity matrix: toets-report/parity.md
```

A failure prints the error with a `Hint:` and a `Docs:` page, and attaches a failure dump. See [Debugging failures](../guides/debugging-failures.md).

## Next

- [Concepts](../concepts/locators-and-assertions.md): the few ideas toets is built on.
- [Working with agents](./agents.md): skills, an `AGENTS.md` template and docs for coding agents.
- [CI recipes](../ci/index.md).
