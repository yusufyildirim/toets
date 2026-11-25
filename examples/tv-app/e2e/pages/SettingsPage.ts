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
  readonly pin: Locator;
  readonly pinStatus: Locator;
  readonly pinValue: Locator;
  readonly pinError: Locator;

  constructor(app: App) {
    this.app = app;
    this.screen = app.getByTestId('screen_settings');
    this.autoplay = app.getByTestId('settings_autoplay');
    this.autoplayValue = app.getByTestId('settings_autoplay_value');
    this.apiUrl = app.getByTestId('settings_api_url');
    this.mock = app.getByTestId('settings_mock');
    this.platform = app.getByTestId('settings_platform');
    this.pin = app.getByTestId('settings_pin');
    this.pinStatus = app.getByTestId('settings_pin_status');
    this.pinValue = app.getByTestId('pin_value');
    this.pinError = app.getByTestId('pin_error');
  }

  async waitUntilLoaded(): Promise<void> {
    await expect(this.screen).toBeVisible();
  }

  /** Opens the parental PIN dialog. */
  async openPin(): Promise<void> {
    await this.app.focus.navigateTo(this.pin);
    await this.app.remote.press(Key.SELECT);
    await expect(this.pinValue).toBeVisible();
  }

  async toggleAutoplay(): Promise<void> {
    await this.app.focus.navigateTo(this.autoplay);
    await this.app.remote.press(Key.SELECT);
  }
}
