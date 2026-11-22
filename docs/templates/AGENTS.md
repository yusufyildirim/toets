# E2E tests (dpad)

TV end-to-end tests live in `e2e/` and run with dpad on Playwright Test.

- Fast loop: `npx playwright test --project=web`
- All platforms: `npx playwright test`
- Report: `npx playwright show-report`

<!-- Add how to build and start the app for each platform, e.g. `npm run web` on port 8080. -->

## Rules

- No click. Move focus with `app.focus.navigateTo(locator)` or `app.remote.press(Key.X)`, assert `toBeFocused()`, then press `Key.SELECT`.
- Locate by test ID (`app.getByTestId`). Add a missing test ID to the app instead of matching layout or volatile text.
- Never sleep or poll by hand: assertions retry. Anchor a negative assertion on a positive one first.
- Platform gaps are capabilities: `test(name, { requires: ['key.color'] }, fn)`, never `if (platform === ...)`.
- Page objects live in `e2e/pages/`, take `app`, expose locators and actions, and do not assert beyond waiting until loaded.
- Data-dependent tests mock the network with `app.network.use(...)` before `app.launch()`.
- When a test fails, read the error's hint, its docs link and the failure dump before changing the test.

## Docs

Installed dpad packages ship version-matched docs in `node_modules/@dpad-tv/*/docs/`. The docs site has the same pages plus `llms.txt` and `llms-full.txt`. The dpad agent skills cover setup, writing tests, debugging failures and migrating.
