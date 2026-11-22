import { expect, test } from '@dpad-tv/test';

import { HomePage } from './pages/HomePage.js';
import { SettingsPage } from './pages/SettingsPage.js';

test('launches on home with the first card of the first rail focused', async ({ app }) => {
  const home = new HomePage(app);
  await app.launch();

  await expect(home.card('trending-1')).toBeFocused();
  await expect(home.heroTitle).toHaveText('Northern Lights');
  await expect(home.heroMeta).toHaveText('2025 · Drama');
  await expect(home.menu.home).toBeSelected();
  await expect(home.railTitle('trending')).toHaveText('Trending now');
});

test('reports its platform and routes the API through the mock server', async ({ app }) => {
  const home = new HomePage(app);
  const settings = new SettingsPage(app);
  await home.open();

  await home.menu.open('settings');
  await settings.waitUntilLoaded();
  await expect(settings.platform).toHaveText(app.platform.name);
  await expect(settings.mock).toHaveText('On');
});
