import { test, expect } from '@dpad-tv/test';
import { http, HttpResponse } from '@dpad-tv/mock';

test('shows an empty state without favorites', async ({ app }) => {
  app.network.use(http.get('*/api/favorites', () => HttpResponse.json([])));
  await app.launch();

  await expect(app.getByTestId('favorites-empty')).toBeVisible();
  await expect(app.network).toHaveRequested({ method: 'GET', url: /\/api\/favorites$/ });
});
