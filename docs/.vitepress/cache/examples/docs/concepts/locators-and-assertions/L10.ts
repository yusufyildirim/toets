import { test, expect, Key } from '@dpad-tv/test';

test('saves a title to the watchlist', async ({ app }) => {
  await app.launch();

  const rail = app.getByTestId('rail-popular');
  const card = rail.getByTestId('card').nth(2);
  await app.focus.navigateTo(card);
  await app.remote.press(Key.SELECT);

  await expect(app.getByText('Added to watchlist')).toBeVisible();
  await expect(app.getByTestId('watchlist-count')).toHaveText('1');
});
