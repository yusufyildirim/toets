# @toets/test

toets test runner: Playwright Test fixtures, config and matchers for cross-platform TV E2E tests.

```ts
import { test, expect, Key } from '@toets/test';

test('opens details', async ({ app }) => {
  await app.launch();
  await app.focus.pressUntil(Key.RIGHT, app.getByTestId('card_1'));
  await app.remote.press(Key.SELECT);
  await expect(app.getByTestId('details_title')).toBeVisible();
});
```

## Docs

- [Config](./docs/config.md)
- [The `app` fixture](./docs/app-fixture.md)
- [requires](./docs/requires.md)
- [Devices](./docs/devices.md)
- [Reporting](./docs/reporting.md)

Concepts shared by every platform (locators, assertions, focus, remote, snapshots, SDK, mocking) are in the [`@toets/core` docs](https://github.com/yusufyildirim/toets/tree/main/packages/core/docs) (offline: `node_modules/@toets/core/docs`).

Project overview: [toets](https://github.com/yusufyildirim/toets#readme).
