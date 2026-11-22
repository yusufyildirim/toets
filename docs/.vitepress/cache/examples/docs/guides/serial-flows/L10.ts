import { test, expect, Key } from '@dpad-tv/test';

test.describe.serial('first run', () => {
  test('accepts the terms', async ({ app }) => {
    await app.launch({ clearData: true });
    await app.focus.navigateTo(app.getByTestId('terms-accept'));
    await app.remote.press(Key.SELECT);
    await expect(app.getByTestId('profile-picker')).toBeVisible();
  });

  test('picks a profile and lands on home', async ({ app }) => {
    await app.focus.navigateTo(app.getByTestId('profile-0'));
    await app.remote.press(Key.SELECT);
    await expect(app.getByTestId('home-screen')).toBeVisible();
  });
});
