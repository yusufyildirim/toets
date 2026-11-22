import { expect, Key, requires, test } from '@dpad-tv/test';

import { DetailsPage } from './pages/DetailsPage.js';
import { HomePage } from './pages/HomePage.js';

test('a card opens its details with Play focused', async ({ app }) => {
  const home = new HomePage(app);
  const details = new DetailsPage(app);
  await home.open();

  await home.openCard('new-3');
  await details.waitUntilLoaded();
  await expect(details.title).toHaveText('Low Tide');
  await expect(details.meta).toHaveText('2026 · Thriller · 1h 36m');
  await expect(home.rails).not.toBeVisible();
});

test(
  'back from details restores focus on the card that opened it',
  requires('key.back'),
  async ({ app }) => {
    const home = new HomePage(app);
    const details = new DetailsPage(app);
    await home.open();
    await home.openCard('documentaries-4');
    await details.waitUntilLoaded();

    await app.remote.press(Key.BACK);
    await expect(home.card('documentaries-4')).toBeFocused();
    await expect(home.heroTitle).toHaveText('Signals from Space');
    await expect(details.screen).not.toBeVisible();
  },
);

test('My List toggles from the details screen', async ({ app }) => {
  const home = new HomePage(app);
  const details = new DetailsPage(app);
  await home.open();
  await home.openCard('trending-2');
  await details.waitUntilLoaded();
  await expect(details.myListLabel).toHaveText('Add to My List');

  await details.toggleMyList();
  await expect(details.myListLabel).toHaveText('In My List');
  await expect(details.myList).toBeSelected();
  await expect(details.myList).toBeFocused();

  await app.remote.press(Key.SELECT);
  await expect(details.myListLabel).toHaveText('Add to My List');
  await expect(details.myList).not.toBeSelected();
});
