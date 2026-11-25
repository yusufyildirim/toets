import { Key, type App, type Locator } from '@toets/test';

type Item = 'home' | 'search' | 'signin' | 'settings';

/** The side menu shown next to every screen. */
export class SideMenu {
  readonly app: App;
  readonly root: Locator;
  readonly home: Locator;
  readonly search: Locator;
  readonly signin: Locator;
  readonly settings: Locator;

  constructor(app: App) {
    this.app = app;
    this.root = app.getByTestId('side_menu');
    this.home = app.getByTestId('menu_home');
    this.search = app.getByTestId('menu_search');
    this.signin = app.getByTestId('menu_signin');
    this.settings = app.getByTestId('menu_settings');
  }

  /** Opens a menu entry with the remote. */
  async open(item: Item): Promise<void> {
    await this.app.focus.navigateTo(this[item]);
    await this.app.remote.press(Key.SELECT);
  }
}
