---
description: Page objects take app, expose locators and user-level actions, and leave assertions to tests. The ESLint plugin enforces the rules.
---

# Page objects

A **page object** names the parts of one screen and the actions a user takes on it, so tests read as intent and a layout change is fixed in one place. In dpad a page object is a plain class that takes `app`.

```ts
import { test, expect, Key, type App, type Locator } from '@dpad-tv/test';

class HomePage {
  readonly app: App;
  readonly screen: Locator;
  readonly menu: Locator;

  constructor(app: App) {
    this.app = app;
    this.screen = app.getByTestId('home-screen');
    this.menu = app.getByTestId('side-menu');
  }

  card(rail: number, index: number): Locator {
    return this.app.getByTestId(`rail-${rail}-card-${index}`);
  }

  async waitUntilLoaded(): Promise<void> {
    await expect(this.screen).toBeVisible();
  }

  async openCard(rail: number, index: number): Promise<void> {
    await this.app.focus.navigateTo(this.card(rail, index));
    await this.app.remote.press(Key.SELECT);
  }
}

test('opens details from home', async ({ app }) => {
  await app.launch();
  const home = new HomePage(app);
  await home.waitUntilLoaded();

  await home.openCard(0, 2);
  await expect(app.getByTestId('details-screen')).toBeVisible();
});
```

## Rules

- **Take `app`, nothing else from the runner.** The same page object then works on every platform and in serial flows.
- **Expose locators and actions, not assertions.** Tests decide what is checked. The one exception is waiting until the screen is ready to be driven (`waitUntilLoaded` above) with a stability matcher: `toBeVisible`, `toBeInViewport`, `toBeFocused`, `toHaveFocusWithin`, `toBeBusy`.
- **Actions are user intents.** `openCard`, `toggleSubtitles`; not `pressRightThreeTimes`.
- **No sleeps, no platform branches.** Adapt through capabilities (`app.platform.has(...)`) if a page object must do something differently.

The [ESLint plugin](../reference/eslint-plugin/docs/setup.md) enforces the assertion rule in page object files (by default anything under `pages/` or named `*Page.*`; see [`page-object-assertions`](../reference/eslint-plugin/docs/rules/page-object-assertions.md)) and rejects sleeps everywhere.

## Traps

- **Do not cache elements.** Store locators, which re-resolve on every use, never values read from the screen.
- **A page object per screen, not per platform.** If platforms need different page objects, the app's screens differ; make that explicit with capabilities or separate tests.
