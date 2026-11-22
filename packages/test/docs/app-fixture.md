# The `app` fixture

Every test gets `app`, the app under test on the project's platform. It is the only fixture a dpad test needs.

```ts
import { test, expect, Key } from '@dpad-tv/test';

test('opens details', async ({ app }) => {
  await app.launch();
  await app.focus.navigateTo(app.getByTestId('card_1'));
  await app.remote.press(Key.SELECT);
  await expect(app.getByTestId('details_title')).toBeVisible();
});
```

## Lifecycle

- **Per worker:** the device lease, driver session, mock server and SDK host start on the first test that needs them and stop when the worker exits. Booting a device once per worker, not per test, is what keeps suites fast.
- **Per test:** the app is isolated: the SDK session is closed, the app is terminated if it was launched, mock handlers and recorded requests are reset, key and log buffers are cleared. Each test calls `app.launch()` itself.
- **Serial blocks share one app.** Tests in a `test.describe.serial` block run in order on the same app: no isolation between them, so step 2 continues where step 1 left off. The next test outside the block is isolated again.

```ts
test.describe.serial('onboarding', () => {
  test('pick a profile', async ({ app }) => {
    await app.launch(); /* ... */
  });
  test('then the home screen', async ({ app }) => {
    /* app is still running */
  });
});
```

## Principles

- **Launch explicitly.** `app.launch({ state, flags, clearData })` makes the starting point visible in the test.
- **Platform escape hatch.** `app.platformOnly('web', async (page) => { ... })` runs code with the driver's native handle (a Playwright `Page` on web) only on that platform, as a recorded step. Use it sparingly; it is not portable.

## TV trap: app state survives terminate

Terminating a TV app keeps its data: login, profile choice, onboarding flags. Use `launch({ clearData: true })` or `app.reset()` when a test needs a first-run experience.
