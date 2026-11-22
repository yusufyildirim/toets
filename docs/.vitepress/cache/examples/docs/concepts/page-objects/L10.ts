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
