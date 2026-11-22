import { expect, Key, requires, test, type App } from '@dpad-tv/test';

import { DetailsPage } from './pages/DetailsPage.js';
import { HomePage } from './pages/HomePage.js';
import { PlayerPage } from './pages/PlayerPage.js';

/** Home, a card, Play: the way a viewer starts playback. Autoplay is on by default. */
async function openPlayer(app: App, item = 'trending-1'): Promise<PlayerPage> {
  const home = new HomePage(app);
  const details = new DetailsPage(app);
  const player = new PlayerPage(app);
  await home.open();
  await home.openCard(item);
  await details.waitUntilLoaded();
  await details.startPlayback();
  await player.waitUntilLoaded();
  return player;
}

test('Play on details starts playback', async ({ app }) => {
  const player = await openPlayer(app);
  await expect(player.title).toHaveText('Northern Lights');
  await expect(player.state).toHaveText('Playing');
  await expect(player.playPauseLabel).toHaveText('Pause');
});

test('select on the play/pause button pauses and resumes', async ({ app }) => {
  const player = await openPlayer(app);
  await expect(player.state).toHaveText('Playing');

  await app.remote.press(Key.SELECT);
  await expect(player.state).toHaveText('Paused');
  await expect(player.playPauseLabel).toHaveText('Play');

  await app.remote.press(Key.SELECT);
  await expect(player.state).toHaveText('Playing');
});

test('back from the player returns to Play on details', requires('key.back'), async ({ app }) => {
  const details = new DetailsPage(app);
  const player = await openPlayer(app, 'new-2');
  await expect(player.state).toHaveText('Playing');

  await app.remote.press(Key.BACK);
  await expect(details.play).toBeFocused();
  await expect(details.title).toHaveText('Ironwood');
  await expect(player.screen).not.toBeVisible();
});

test('the play/pause key toggles playback', requires('key.media.toggle'), async ({ app }) => {
  const player = await openPlayer(app);
  await expect(player.state).toHaveText('Playing');

  await app.remote.press(Key.PLAY_PAUSE);
  await expect(player.state).toHaveText('Paused');
  await app.remote.press(Key.PLAY_PAUSE);
  await expect(player.state).toHaveText('Playing');
});

test('discrete play and pause keys', requires('key.media.discrete'), async ({ app }) => {
  const player = await openPlayer(app);
  await expect(player.state).toHaveText('Playing');

  await app.remote.press(Key.PAUSE);
  await expect(player.state).toHaveText('Paused');
  // PAUSE is not a toggle: pressing it again keeps playback paused.
  await app.remote.press(Key.PAUSE);
  await app.remote.press(Key.PLAY);
  await expect(player.state).toHaveText('Playing');
});

test.describe('media state through the SDK', requires('media.state'), () => {
  test('reports playing and paused', async ({ app }) => {
    const player = await openPlayer(app);
    await expect(app.media).toBePlaying();

    await app.remote.press(Key.SELECT);
    await expect(app.media).toBePaused();
    await expect(player.state).toHaveText('Paused');
  });

  test(
    'fast forward and rewind seek by 10 seconds',
    requires('key.media.seek'),
    async ({ app }) => {
      await openPlayer(app);
      await expect(app.media).toBePlaying();
      await app.remote.press(Key.SELECT);
      await expect(app.media).toBePaused();
      const paused = (await app.media.get())?.position ?? 0;

      await app.remote.press(Key.FAST_FORWARD);
      await expect(app.media).toHavePosition(paused + 10);
      await app.remote.press(Key.REWIND);
      await expect(app.media).toHavePosition(paused);
    },
  );

  test('the seek buttons move the position', async ({ app }) => {
    const player = await openPlayer(app);
    await expect(app.media).toBePlaying();
    await app.remote.press(Key.SELECT);
    await expect(app.media).toBePaused();
    const paused = (await app.media.get())?.position ?? 0;

    await app.focus.navigateTo(player.seekForward);
    await app.remote.press(Key.SELECT);
    await expect(app.media).toHavePosition(paused + 10);
  });
});
