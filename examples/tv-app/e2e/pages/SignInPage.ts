import { expect, type App, type Locator } from '@toets/test';

/** Sign-in with native text fields: email, password and the sign-in button. */
export class SignInPage {
  readonly app: App;
  readonly screen: Locator;
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly status: Locator;

  constructor(app: App) {
    this.app = app;
    this.screen = app.getByTestId('screen_signin');
    this.email = app.getByTestId('signin_email');
    this.password = app.getByTestId('signin_password');
    this.submit = app.getByTestId('signin_submit');
    this.status = app.getByTestId('signin_status');
  }

  async waitUntilLoaded(): Promise<void> {
    await expect(this.screen).toBeVisible();
  }
}
