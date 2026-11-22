---
description: Install dpad, configure platforms and run a first cross-platform TV test.
---

# Install and first test

::: warning Pre-alpha
dpad is not published yet. This page describes the intended setup; APIs may still change.
:::

dpad is a set of [Playwright Test](https://playwright.dev/docs/intro) fixtures for TV apps. Every platform is a Playwright project, and every test receives one fixture, `app`: the app under test on the current platform. You keep Playwright's runner, reporters, UI mode, retries and sharding.

## Requirements

| Platform             | Host                     | Needs                                       |
| -------------------- | ------------------------ | ------------------------------------------- |
| Web                  | any                      | Chromium, installed through Playwright      |
| Android TV / Fire TV | macOS, or Linux with KVM | Android SDK with an Android TV system image |
| tvOS                 | macOS                    | Xcode with a tvOS simulator runtime         |

Node 24 or later. Appium, emulators and simulators are started and reset by dpad; see the [platform pages](../platforms/web.md) for details.

## 1. Install

```sh
npm install --save-dev @dpad-tv/test @playwright/test
# one driver per platform you target
npm install --save-dev @dpad-tv/driver-web @dpad-tv/driver-android-tv @dpad-tv/driver-tvos
npx playwright install chromium
```

Drivers load on demand, so install only the platforms you test.

## 2. Configure

`playwright.config.ts`:

```ts
import { defineConfig, platforms } from '@dpad-tv/test';

export default defineConfig({
  testDir: './e2e',
  app: {
    web: { url: 'http://localhost:8080' },
    androidTV: { apk: './build/app-debug.apk', package: 'com.example.tv' },
    tvOS: { app: './build/Example.app', bundleId: 'com.example.tv' },
  },
  projects: [
    platforms.web(),
    platforms.androidTV({ avd: 'tv_1080p', api: 34 }),
    platforms.tvOS({ runtime: '18' }),
  ],
});
```

`app` says how to start your app on each platform; `projects` says where tests run. Drop the platforms you do not target. App-specific flows (login, waiting for your splash screen) belong in your own fixtures, not in this file: see [Writing tests](../guides/writing-tests.md).

## 3. Give elements test IDs

dpad finds elements by test ID or text. The test ID is `data-testid` on web, the resource ID on Android and the accessibility identifier on tvOS; React Native's `testID` sets all three. See [Locators and assertions](../concepts/locators-and-assertions.md).

## 4. Write a test

`e2e/home.spec.ts`:

```ts
import { test, expect, Key } from '@dpad-tv/test';

test('opens details from the first rail', async ({ app }) => {
  await app.launch();

  const card = app.getByTestId('rail-0-card-0');
  await app.focus.navigateTo(card);
  await expect(card).toBeFocused();

  await app.remote.press(Key.SELECT);
  await expect(app.getByTestId('details-screen')).toBeVisible();
});
```

There is no click. Focus moves with real remote presses, then `SELECT` activates the focused element. See [Focus](../concepts/focus.md).

## 5. Run

```sh
npx playwright test --project=web   # fastest loop
npx playwright test                 # every platform
npx playwright show-report          # steps, screenshots, logs, parity matrix
```

## Next

- [Concepts](../concepts/locators-and-assertions.md): the few ideas dpad is built on.
- [Working with agents](./agents.md): skills, `AGENTS.md` template and docs for coding agents.
- [CI recipes](../ci/index.md).
