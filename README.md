# toets

[![npm](https://img.shields.io/npm/v/@toets/test?label=%40toets%2Ftest)](https://www.npmjs.com/package/@toets/test)
[![CI](https://github.com/yusufyildirim/toets/actions/workflows/ci.yml/badge.svg)](https://github.com/yusufyildirim/toets/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Cross-platform E2E testing for TV apps. Write one test, run it on web, Android TV / Google TV / Fire TV and tvOS (Apple TV), and trust that it tests the same thing everywhere.

Focus and the remote (D-pad) are the primitives; there is no click. Built on Playwright Test, Appium and MSW. Works with any app framework, with an optional in-app SDK for web and React Native TV (react-native-tvos, react-native-web).

> **Pre-alpha.** APIs will change. See [VISION.md](./VISION.md) for goals and decisions.

```sh
npm install --save-dev @toets/test @playwright/test @toets/driver-web
```

```ts
import { test, expect, Key } from '@toets/test';

test('opens details from the first rail', async ({ app }) => {
  await app.launch();
  const card = app.getByTestId('rail-0-card-2');
  await app.focus.pressUntilFocused(Key.RIGHT, card);
  await expect(card).toBeFocused();
  await app.remote.press(Key.SELECT);
  await expect(app.getByTestId('details-screen')).toBeVisible();
});
```

## Docs

- [Install and first test](./docs/getting-started/index.md)
- [Concepts](./docs/concepts/locators-and-assertions.md): focus, remote and keys, capabilities, idle, mocking, page objects, the SDK
- [Guides](./docs/guides/writing-tests.md), [platforms](./docs/platforms/web.md) and [CI recipes](./docs/ci/index.md)
- [Working with agents](./docs/getting-started/agents.md): skills in [`skills/`](./skills), an `AGENTS.md` template, `llms.txt`, an MCP server

Run the docs site locally with `pnpm docs:dev`.

## Packages

| Package                                                    | npm                                                                                                                     | What it is                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`@toets/test`](./packages/test)                           | [![npm](https://img.shields.io/npm/v/@toets/test)](https://www.npmjs.com/package/@toets/test)                           | Test runner: Playwright Test fixtures, config, matchers |
| [`@toets/driver-web`](./packages/driver-web)               | [![npm](https://img.shields.io/npm/v/@toets/driver-web)](https://www.npmjs.com/package/@toets/driver-web)               | Web and smart TV apps in Chromium (Playwright)          |
| [`@toets/driver-android-tv`](./packages/driver-android-tv) | [![npm](https://img.shields.io/npm/v/@toets/driver-android-tv)](https://www.npmjs.com/package/@toets/driver-android-tv) | Android TV, Google TV, Fire TV emulators (UiAutomator2) |
| [`@toets/driver-tvos`](./packages/driver-tvos)             | [![npm](https://img.shields.io/npm/v/@toets/driver-tvos)](https://www.npmjs.com/package/@toets/driver-tvos)             | tvOS simulators (XCUITest)                              |
| [`@toets/sdk`](./packages/sdk)                             | [![npm](https://img.shields.io/npm/v/@toets/sdk)](https://www.npmjs.com/package/@toets/sdk)                             | Optional in-app SDK: idle sync, app state, JS focus     |
| [`@toets/sdk-react-native`](./packages/sdk-react-native)   | [![npm](https://img.shields.io/npm/v/@toets/sdk-react-native)](https://www.npmjs.com/package/@toets/sdk-react-native)   | In-app SDK for react-native-tvos and react-native-web   |
| [`@toets/mock`](./packages/mock)                           | [![npm](https://img.shields.io/npm/v/@toets/mock)](https://www.npmjs.com/package/@toets/mock)                           | Network mocking with MSW, same on every platform        |
| [`@toets/mcp`](./packages/mcp)                             | [![npm](https://img.shields.io/npm/v/@toets/mcp)](https://www.npmjs.com/package/@toets/mcp)                             | MCP server: agents drive TV apps and read the docs      |
| [`@toets/eslint-plugin`](./packages/eslint-plugin)         | [![npm](https://img.shields.io/npm/v/@toets/eslint-plugin)](https://www.npmjs.com/package/@toets/eslint-plugin)         | Lint rules for toets tests                              |
| [`@toets/core`](./packages/core)                           | [![npm](https://img.shields.io/npm/v/@toets/core)](https://www.npmjs.com/package/@toets/core)                           | Platform-neutral core: driver contract, locators, focus |
| [`@toets/protocol`](./packages/protocol)                   | [![npm](https://img.shields.io/npm/v/@toets/protocol)](https://www.npmjs.com/package/@toets/protocol)                   | In-app SDK protocol, host server, conformance suite     |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Security issues: [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
