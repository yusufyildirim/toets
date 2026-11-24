# E2E tests (toets)

TV end-to-end tests live in `e2e/` and run with toets on Playwright Test.

- Fast loop: `npx playwright test --project=web`
- All platforms: `npx playwright test`
- Report: `npx playwright show-report`

<!-- Add how to build and start the app for each platform, e.g. `npm run web` on port 8080. -->

## Rules

- No click. Move focus with `app.focus.pressUntil(Key.X, locator)` (or `navigateTo`, `app.remote.press`), assert `toBeFocused()`, then press `Key.SELECT`.
- Locate by test ID (`app.getByTestId`). Add a missing test ID to the app instead of matching layout or volatile text.
- Never sleep or poll by hand: assertions retry. Anchor a negative assertion on a positive one first.
- Platform gaps are capabilities: `test(name, requires('key.color'), fn)`, never `if (platform === ...)`.
- Page objects live in `e2e/pages/`, take `app`, expose locators and actions, and do not assert beyond waiting until loaded.
- Data-dependent tests mock the network with `app.network.use(...)` before `app.launch()`.
- When a test fails, read the error's `Hint:`, its `Docs:` page and the failure dump before changing the test. Skipped platforms and their reasons are in `toets-report/parity.md`.

## Docs

Installed toets packages ship version-matched docs in `node_modules/@toets/*/docs/`; every error code is in `node_modules/@toets/core/docs/errors.md`. The docs site has the same pages plus `llms.txt` and `llms-full.txt`. The toets agent skills cover setup, writing tests, debugging failures and migrating.
