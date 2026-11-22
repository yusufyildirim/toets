import { expect, failure, HttpResponse, http, Key, requires, test } from '@dpad-tv/test';

import { PICK_1, picksApi } from './data/catalog.js';
import { DetailsPage } from './pages/DetailsPage.js';
import { HomePage } from './pages/HomePage.js';

test.describe('network mocking', requires('network.mock'), () => {
  test('home renders the mocked catalog', async ({ app }) => {
    const home = new HomePage(app);
    app.network.use(...picksApi);
    await home.open();

    await expect(home.railTitle('picks')).toHaveText('Test picks');
    await expect(home.card('pick-1')).toBeFocused();
    await expect(home.card('trending-1')).toHaveCount(0);
    await expect(app.network).toHaveRequested({ method: 'GET', url: '/api/catalog' }, { times: 1 });
  });

  test('details request the selected item once', async ({ app }) => {
    const home = new HomePage(app);
    const details = new DetailsPage(app);
    app.network.use(...picksApi);
    await home.open();

    await home.openCard('pick-1');
    await details.waitUntilLoaded();
    await expect(details.description).toHaveText(PICK_1.description);
    await expect(details.meta).toHaveText('2020 · Drama · 1h 15m');
    await expect(app.network).toHaveRequested({ url: '/api/items/pick-1' }, { times: 1 });
  });

  test('a failing catalog shows the error, retry recovers', async ({ app }) => {
    const home = new HomePage(app);
    app.network.use(failure({ url: '*/api/catalog', status: 503, times: 1 }));
    await app.launch();

    await expect(home.error).toBeVisible();
    await expect(home.errorMessage).toContainText('HTTP 503');
    await expect(home.retry).toBeFocused();

    await app.remote.press(Key.SELECT);
    await expect(home.card('trending-1')).toBeFocused();
    await expect(home.error).not.toBeVisible();
    await expect(app.network).toHaveRequested({ url: '/api/catalog' }, { times: 2 });
  });

  test('a missing title shows the details error', async ({ app }) => {
    const home = new HomePage(app);
    const details = new DetailsPage(app);
    app.network.use(
      http.get('*/api/items/:id', () => HttpResponse.json({ error: 'gone' }, { status: 404 })),
    );
    await home.open();

    await home.openCard('trending-1');
    await expect(details.error).toBeVisible();
    await expect(details.retry).toBeFocused();
    await expect(app.network).toHaveRequested({ url: '/api/items/trending-1' });
  });
});
