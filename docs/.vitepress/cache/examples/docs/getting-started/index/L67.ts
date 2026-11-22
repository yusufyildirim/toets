import { test, expect, Key } from '@dpad-tv/test';

test('opens details from the first rail', async ({ app }) => {
  await app.launch();

  const card = app.getByTestId('rail-0-card-0');
  await app.focus.navigateTo(card);
  await expect(card).toBeFocused();

  await app.remote.press(Key.SELECT);
  await expect(app.getByTestId('details-screen')).toBeVisible();
});
