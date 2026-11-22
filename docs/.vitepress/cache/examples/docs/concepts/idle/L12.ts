import { test, expect, Key } from '@dpad-tv/test';

test('closing the menu leaves no overlay behind', async ({ app }) => {
  await app.launch();
  await app.remote.press(Key.LEFT);
  await expect(app.getByTestId('side-menu')).toHaveFocusWithin();

  await app.remote.press(Key.RIGHT);
  await expect(app.getByTestId('home-screen')).toHaveFocusWithin();
  await expect(app.getByTestId('side-menu')).not.toBeVisible();
});
