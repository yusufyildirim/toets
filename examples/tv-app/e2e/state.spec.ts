import { expect, Key, requires, test } from '@dpad-tv/test';

import { DetailsPage } from './pages/DetailsPage.js';
import { HomePage } from './pages/HomePage.js';
import { PlayerPage } from './pages/PlayerPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

// Launch states are preconditions, not shortcuts around what a test verifies (state names are
// the app's: see `launchStateActions` in src/navigation/navigation.ts).
test.describe('launch states and flags', requires('app.state'), () => {
  test('launches straight into details', async ({ app }) => {
    const details = new DetailsPage(app);
    await app.launch({ state: 'details:new-2' });

    await details.waitUntilLoaded();
    await expect(details.title).toHaveText('Ironwood');
  });

  test('a player launch keeps back navigation intact', requires('key.back'), async ({ app }) => {
    const details = new DetailsPage(app);
    const player = new PlayerPage(app);
    await app.launch({ state: 'player:trending-1' });
    await player.waitUntilLoaded();
    await expect(player.state).toHaveText('Playing');

    await app.remote.press(Key.BACK);
    await expect(details.play).toBeFocused();
    await expect(details.title).toHaveText('Northern Lights');
  });

  test('the autoplay flag turns autoplay off', async ({ app }) => {
    const player = new PlayerPage(app);
    await app.launch({ state: 'player:trending-1', flags: { autoplay: false } });

    await player.waitUntilLoaded();
    await expect(player.state).toHaveText('Paused');
    await expect(player.playPauseLabel).toHaveText('Play');
  });

  test('flags alone apply on the home screen', async ({ app }) => {
    const home = new HomePage(app);
    const settings = new SettingsPage(app);
    await home.open({ flags: { autoplay: false } });

    await home.menu.open('settings');
    await expect(settings.autoplayValue).toHaveText('Off');
  });
});
