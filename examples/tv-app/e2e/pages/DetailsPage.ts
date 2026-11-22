import { expect, Key, type App, type Locator } from '@dpad-tv/test';

/** Details of one title, opened from a card. */
export class DetailsPage {
  readonly app: App;
  readonly screen: Locator;
  readonly loading: Locator;
  readonly error: Locator;
  readonly retry: Locator;
  readonly title: Locator;
  readonly meta: Locator;
  readonly description: Locator;
  readonly play: Locator;
  readonly myList: Locator;
  readonly myListLabel: Locator;

  constructor(app: App) {
    this.app = app;
    this.screen = app.getByTestId('screen_details');
    this.loading = app.getByTestId('details_loading');
    this.error = app.getByTestId('details_error');
    this.retry = app.getByTestId('details_retry');
    this.title = app.getByTestId('details_title');
    this.meta = app.getByTestId('details_meta');
    this.description = app.getByTestId('details_description');
    this.play = app.getByTestId('details_play');
    this.myList = app.getByTestId('details_my_list');
    this.myListLabel = app.getByTestId('details_my_list_label');
  }

  /** Details loaded: Play holds the initial focus. */
  async waitUntilLoaded(): Promise<void> {
    await expect(this.play).toBeFocused();
  }

  async toggleMyList(): Promise<void> {
    await this.app.focus.navigateTo(this.myList);
    await this.app.remote.press(Key.SELECT);
  }

  async startPlayback(): Promise<void> {
    await this.app.focus.navigateTo(this.play);
    await this.app.remote.press(Key.SELECT);
  }
}
