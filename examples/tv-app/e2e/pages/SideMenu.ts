import { Key, type App, type Locator } from '@dpad-tv/test';

/** The side menu shown next to Home and Settings. */
export class SideMenu {
  readonly app: App;
  readonly root: Locator;
  readonly home: Locator;
  readonly settings: Locator;

  constructor(app: App) {
    this.app = app;
    this.root = app.getByTestId('side_menu');
    this.home = app.getByTestId('menu_home');
    this.settings = app.getByTestId('menu_settings');
  }

  /** Opens a menu entry with the remote. */
  async open(item: 'home' | 'settings'): Promise<void> {
    await this.app.focus.navigateTo(item === 'home' ? this.home : this.settings);
    await this.app.remote.press(Key.SELECT);
  }
}
