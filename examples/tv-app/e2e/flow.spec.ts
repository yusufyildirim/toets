import { expect, Key, requires, test } from '@toets/test';

import { DetailsPage } from './pages/DetailsPage.js';
import { HomePage } from './pages/HomePage.js';
import { PlayerPage } from './pages/PlayerPage.js';

// One journey, checkpoint by checkpoint, on one running app: My List state set in step 2 must
// survive playback and back navigation. Steps share the app; a failure skips the rest.
test.describe.serial('save and watch a documentary', requires('key.back'), () => {
  test('browse to the title', async ({ app }) => {
    const home = new HomePage(app);
    await home.open();
    await app.focus.pressUntilFocused(Key.DOWN, home.rail('documentaries'));
    await app.focus.pressUntilFocused(Key.RIGHT, home.card('documentaries-2'));
    await expect(home.heroTitle).toHaveText('Made by Hand');
  });

  test('add it to My List', async ({ app }) => {
    const details = new DetailsPage(app);
    await app.remote.press(Key.SELECT);
    await details.waitUntilLoaded();
    await details.toggleMyList();
    await expect(details.myListLabel).toHaveText('In My List');
  });

  test('play it', async ({ app }) => {
    const details = new DetailsPage(app);
    const player = new PlayerPage(app);
    await details.startPlayback();
    await player.waitUntilLoaded();
    await expect(player.state).toHaveText('Playing');
  });

  test('back on details, it is still in My List', async ({ app }) => {
    const details = new DetailsPage(app);
    await app.remote.press(Key.BACK);
    await expect(details.play).toBeFocused();
    await expect(details.myListLabel).toHaveText('In My List');
  });

  test('back home, focus is on the title again', async ({ app }) => {
    const home = new HomePage(app);
    await app.remote.press(Key.BACK);
    await expect(home.card('documentaries-2')).toBeFocused();
  });
});
