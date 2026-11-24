---
description: Serial flows run tests in order on one shared app instance, with Playwright's serial semantics on every platform. Use them only for journeys that can not be set up directly.
---

# Serial flows

By default every test is independent. A **serial flow** groups tests that run in order, in one worker, on **one shared `app`**: each test continues where the previous one left off. The semantics are Playwright's serial mode, identical on every platform.

```ts run
import { test, expect, Key } from '@toets/test';

test.describe.serial('first run', () => {
  test('accepts the terms', async ({ app }) => {
    await app.launch({ clearData: true });
    await app.focus.navigateTo(app.getByTestId('terms-accept'));
    await app.remote.press(Key.SELECT);
    await expect(app.getByTestId('profile-picker')).toBeVisible();
  });

  test('picks a profile and lands on home', async ({ app }) => {
    await app.focus.navigateTo(app.getByTestId('profile-0'));
    await app.remote.press(Key.SELECT);
    await expect(app.getByTestId('home-screen')).toBeVisible();
  });
});
```

## Semantics

- Tests in the group share one `app` and run in declaration order.
- When one fails, the rest of the group is skipped.
- Retries rerun the whole group from the start.

## When to use

For journeys whose steps are the subject of the test and can not be reached directly: first-run onboarding, a purchase that changes what later screens show. Each test is a checkpoint with its own name in the report.

Prefer independent tests otherwise. If the only reason for a serial flow is to skip setup, launch into a [named state](../concepts/sdk.md#named-states) instead.

## Traps

- **Serial flows hide dependencies.** A test in the middle can not run alone. Keep groups short and self-contained in one `describe`.
- **Order across files is not guaranteed.** Never rely on another file's tests having run.
- **A failure early skips everything after it.** Put the most important checks where they run first, or split the flow.
