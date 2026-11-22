import { test, expect, Key } from '@dpad-tv/test';

test('toggles playback from the remote', async ({ app }) => {
  await app.launch();
  await app.focus.navigateTo(app.getByTestId('play-button'));
  await app.remote.press(Key.SELECT);
  await expect(app.media).toBePlaying();

  await app.remote.press(Key.PLAY_PAUSE);
  await expect(app.media).toBePaused();
});
