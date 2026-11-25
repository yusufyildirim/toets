import { expect, type App, type Locator } from '@toets/test';

/** Search: a query field typed with the app's own keyboard, and the matching titles. */
export class SearchPage {
  readonly app: App;
  readonly screen: Locator;
  readonly query: Locator;
  readonly keyboard: Locator;
  readonly empty: Locator;
  readonly submitted: Locator;

  constructor(app: App) {
    this.app = app;
    this.screen = app.getByTestId('screen_search');
    this.query = app.getByTestId('search_query');
    this.keyboard = app.getByTestId('osk');
    this.empty = app.getByTestId('search_empty');
    this.submitted = app.getByTestId('search_submitted');
  }

  async waitUntilLoaded(): Promise<void> {
    await expect(this.screen).toBeVisible();
  }

  /** A result by catalog id (`trending-6`): a leaf, so it works without `tree.hierarchy` too. */
  result(id: string): Locator {
    return this.app.getByTestId(`search_result_${id}`);
  }
}
