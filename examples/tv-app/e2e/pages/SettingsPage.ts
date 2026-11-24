import { expect, Key, type App, type Locator } from '@toets/test';

/** Settings: the autoplay switch and diagnostics. */
export class SettingsPage {
  readonly app: App;
  readonly screen: Locator;
  readonly autoplay: Locator;
  readonly autoplayValue: Locator;
  readonly apiUrl: Locator;
  readonly mock: Locator;
  readonly platform: Locator;

  constructor(app: App) {
    this.app = app;
    this.screen = app.getByTestId('screen_settings');
    this.autoplay = app.getByTestId('settings_autoplay');
    this.autoplayValue = app.getByTestId('settings_autoplay_value');
    this.apiUrl = app.getByTestId('settings_api_url');
    this.mock = app.getByTestId('settings_mock');
    this.platform = app.getByTestId('settings_platform');
  }

  async waitUntilLoaded(): Promise<void> {
    await expect(this.screen).toBeVisible();
  }

  async toggleAutoplay(): Promise<void> {
    await this.app.focus.navigateTo(this.autoplay);
    await this.app.remote.press(Key.SELECT);
  }
}
