---
description: Reference for every toets package - pages from each package's own docs, shipped offline in node_modules, plus the error code index.
---

# Reference

Each package documents itself in its own `docs/` folder. The same pages ship inside the npm package, so an installed version always has matching docs at `node_modules/@toets/<package>/docs/`. This section renders them.

| Package                                              | Role                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| [`@toets/test`](./test.md)                           | Main entry: `test`, `expect`, `Key`, `defineConfig`, `platforms`     |
| [`@toets/core`](./core.md)                           | Platform-neutral core: locators, matchers, focus, keys, capabilities |
| [`@toets/driver-web`](./driver-web.md)               | Web driver (Chromium through Playwright)                             |
| [`@toets/driver-android-tv`](./driver-android-tv.md) | Android TV driver (Appium UiAutomator2) and emulator management      |
| [`@toets/driver-tvos`](./driver-tvos.md)             | tvOS driver (Appium XCUITest) and simulator management               |
| [`@toets/mock`](./mock.md)                           | Host-side mock server with MSW handlers                              |
| [`@toets/protocol`](./protocol.md)                   | SDK protocol spec, host and conformance suite                        |
| [`@toets/sdk`](./sdk.md)                             | In-app SDK core and web adapter                                      |
| [`@toets/sdk-react-native`](./sdk-react-native.md)   | In-app SDK adapter for React Native                                  |
| [`@toets/mcp`](./mcp.md)                             | MCP server for agents                                                |
| [`@toets/eslint-plugin`](./eslint-plugin.md)         | Lint rules for toets tests and page objects                          |

Every error code a toets error can carry is listed in [Error codes](./core/docs/errors.md).

There is no generated API site yet: the type declarations each package ships (`dist/*.d.ts`) carry the TSDoc and are the API reference; editors and agents read them directly.
