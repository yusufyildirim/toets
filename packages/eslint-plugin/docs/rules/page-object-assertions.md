# page-object-assertions

In page object files, allows only **stability matchers**: `toBeVisible`, `toBeInViewport`, `toBeFocused`, `toHaveFocusWithin`, `toBeBusy` (with or without `.not`).

## Why

A page object describes how to reach and operate a screen. Stability matchers belong there because they wait until the screen is ready to be driven. Behavior checks (`toHaveText`, `toBePlaying`, `toHaveCount`, ...) belong in the test: hidden in a page object they make tests pass or fail for reasons the test does not show, and they get re-run by every test that reuses the page object.

```ts
// Bad: e2e/pages/home.ts
async open() {
  await this.app.launch();
  await expect(this.title).toHaveText('Home');
}

// Good: e2e/pages/home.ts
async open() {
  await this.app.launch();
  await expect(this.rail).toBeVisible();
}

// e2e/home.spec.ts
await home.open();
await expect(home.title).toHaveText('Home');
```

## Options

- `files` (`string[]`): globs (relative to the ESLint working directory) that identify page objects. Default: `**/pages/**`, `**/page-objects/**`, `**/pageObjects/**`, `**/*.page.*`, `**/*-page.*`, `**/*Page.*`. Other files are ignored by this rule.
- `allowedMatchers` (`string[]`): matchers allowed in page objects. Default: the stability matchers above.

```js
'@dpad-tv/page-object-assertions': ['error', { files: ['e2e/screens/**'] }]
```

The default globs also match app code such as `HomePage.tsx`; scope the plugin to your E2E folder (see [setup](../setup.md)).
