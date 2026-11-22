import { test, expect, Key } from '@dpad-tv/test';

test('the red key opens the guide', { requires: ['key.color'] }, async ({ app }) => {
  await app.launch();
  await app.remote.press(Key.RED);
  await expect(app.getByTestId('guide')).toBeVisible();
});
