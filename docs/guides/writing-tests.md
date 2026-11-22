---
description: How to write dpad tests that pass for the right reason on every platform - shape, principles, app-specific fixtures and the fast loop.
---

# Writing tests

A good dpad test drives the app the way a user does with a remote, checks what the user would see, and means the same thing on every platform.

## Shape

1. **Arrange**: mock the data, launch (into a named state if the SDK provides one).
2. **Act**: move focus and press keys.
3. **Assert**: focus, visibility, text, media state. After every navigation step, assert where focus landed.

## Principles

- **One behavior per test.** Name it after the behavior: `'remembers focus when returning to a rail'`.
- **Independent tests.** Each test sets up what it needs. Share state only through [serial flows](./serial-flows.md), and only when it is the point.
- **Navigate like a user.** Focus and keys only; there is no click. Use [`navigateTo`](../concepts/focus.md) to get somewhere, explicit presses when navigation is the behavior.
- **Locate by test ID.** Text for user-facing copy only. See [Locators and assertions](../concepts/locators-and-assertions.md).
- **Let assertions wait.** Never sleep, never poll by hand. Anchor negative assertions on a positive one. See [Idle](../concepts/idle.md).
- **Make data deterministic** with [network mocking](../concepts/network-mocking.md).
- **Declare platform needs** with `requires`, never with `if (platform)`. See [Capabilities](../concepts/capabilities.md).
- **Name screens with [page objects](../concepts/page-objects.md)** once more than one test touches them.

## App-specific setup belongs in your fixtures

dpad knows nothing about your splash screen, sign-in or consent dialogs. Put that in a Playwright fixture in your project and build tests on it:

```ts
import { test as base, expect, type App } from '@dpad-tv/test';

/** The app launched and past the splash screen. */
export const test = base.extend<{ home: App }>({
  home: async ({ app }, use) => {
    await app.launch();
    await expect(app.getByTestId('home-screen')).toBeVisible({ timeout: 30_000 });
    await use(app);
  },
});

test('home shows the featured rail first', async ({ home }) => {
  await expect(home.getByTestId('rail-0')).toHaveFocusWithin();
});
```

## The fast loop

Develop against web (`--project=web`): it starts in seconds and has full Playwright traces. Then run every project before you finish; a test is done when it passes, or is skipped with a reason, everywhere.

```sh
npx playwright test e2e/home.spec.ts --project=web
npx playwright test e2e/home.spec.ts
```

Enable the [ESLint plugin](../reference/eslint-plugin.md): it rejects sleeps, raw keycodes, assertions in page objects and unmarked escape hatches.

## Traps

- **Passing on web is not passing.** Emulators are slower, focus engines differ and some keys do not exist. Run all platforms.
- **A test that never fails is not testing.** After writing an assertion, break the condition once (wrong test ID, wrong expected text) and see it fail with a useful message.
- **Do not reach for `platformOnly`.** If a test needs it, the gap is a missing capability or an app testability issue; fix that instead.
