import { expect, Key, type App, type Locator } from '@toets/test';

import { SideMenu } from './SideMenu.js';

/** Home: a hero for the focused card and rails of cards. */
export class HomePage {
  readonly app: App;
  readonly menu: SideMenu;
  readonly screen: Locator;
  readonly loading: Locator;
  readonly error: Locator;
  readonly errorMessage: Locator;
  readonly retry: Locator;
  readonly hero: Locator;
  readonly heroTitle: Locator;
  readonly heroMeta: Locator;
  readonly rails: Locator;

  constructor(app: App) {
    this.app = app;
    this.menu = new SideMenu(app);
    this.screen = app.getByTestId('screen_home');
    this.loading = app.getByTestId('home_loading');
    this.error = app.getByTestId('home_error');
    this.errorMessage = app.getByTestId('home_error_message');
    this.retry = app.getByTestId('home_retry');
    this.hero = app.getByTestId('home_hero');
    this.heroTitle = app.getByTestId('home_hero_title');
    this.heroMeta = app.getByTestId('home_hero_meta');
    this.rails = app.getByTestId('home_rails');
  }

  rail(id: string): Locator {
    return this.app.getByTestId(`rail_${id}`);
  }

  railTitle(id: string): Locator {
    return this.app.getByTestId(`rail_${id}_title`);
  }

  card(id: string): Locator {
    return this.app.getByTestId(`card_${id}`);
  }

  /** Launches the app and waits for the catalog: the rails hold focus. */
  async open(options?: Parameters<App['launch']>[0]): Promise<void> {
    await this.app.launch(options);
    await this.waitUntilLoaded();
  }

  async waitUntilLoaded(): Promise<void> {
    await expect(this.rails).toHaveFocusWithin();
  }

  /** Moves focus to a card with the remote and opens its details. */
  async openCard(id: string): Promise<void> {
    await this.app.focus.navigateTo(this.card(id));
    await this.app.remote.press(Key.SELECT);
  }
}
