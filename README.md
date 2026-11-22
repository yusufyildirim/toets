# dpad

Cross-platform E2E testing for TV apps. Write one test, run it on web, Android TV / Fire TV and tvOS, and trust that it tests the same thing everywhere.

Focus and the remote are the primitives; there is no click. Built on Playwright Test, Appium and MSW.

> **Pre-alpha.** Nothing is published yet and APIs will change. See [VISION.md](./VISION.md) for goals and decisions.

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

## Docs

- [Install and first test](./docs/getting-started/index.md)
- [Concepts](./docs/concepts/locators-and-assertions.md): focus, remote and keys, capabilities, idle, mocking, page objects, the SDK
- [Guides](./docs/guides/writing-tests.md), [platforms](./docs/platforms/web.md) and [CI recipes](./docs/ci/index.md)
- [Working with agents](./docs/getting-started/agents.md): skills in [`skills/`](./skills), an `AGENTS.md` template, `llms.txt`

Run the docs site locally with `pnpm docs:dev`.

## Contributing

Read [AGENTS.md](./AGENTS.md), [VISION.md](./VISION.md) and [PLAN.md](./PLAN.md) first. `pnpm check` runs format, lint, typecheck, TSDoc validation (`pnpm docs:api`, TypeDoc: broken links and unexported types fail) and tests; `pnpm docs:check` checks docs examples and skills.

## License

[MIT](./LICENSE)
