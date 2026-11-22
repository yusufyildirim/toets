import { test, expect, Key } from '@dpad-tv/test';
import { http, HttpResponse } from '@dpad-tv/mock';

test('shows the empty state when the watchlist is empty', async ({ app }) => {
  app.network.use(http.get('*/api/watchlist', () => HttpResponse.json([])));
  await app.launch();

  const tab = app.getByTestId('menu-watchlist');
  await app.focus.navigateTo(tab);
  await expect(tab).toBeFocused();
  await app.remote.press(Key.SELECT);

  await expect(app.getByTestId('watchlist-empty')).toBeVisible();
});
