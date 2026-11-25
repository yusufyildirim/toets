import { expect, Key, requires, test } from '@toets/test';

test('lands on the rail and navigates with the remote', async ({ app }) => {
  await app.launch();
  await expect(app.getByTestId('payload_state')).toHaveText('payload: none');
  await expect(app.getByTestId('rail_item_1')).toBeFocused();

  const path = await app.focus.navigateTo(app.getByTestId('rail_item_3'));
  expect(path).toEqual(['right', 'right']);
  await expect(app.getByTestId('rail')).toHaveFocusWithin();
  await expect(app.getByTestId('disabled_button')).toBeDisabled();

  await app.focus.navigateTo(app.getByTestId('settings_button'));
  await expect(app.getByTestId('settings_button')).toBeFocused();
  expect(await app.snapshot()).toContain('settings_button');
});

test('opens details, long-presses for the context menu and restores focus on back', async ({
  app,
}) => {
  await app.launch();
  await app.focus.navigateTo(app.getByTestId('rail_item_2'));
  await app.remote.press(Key.SELECT);
  await expect(app.getByTestId('details_title')).toHaveText('Details Item 2');
  await expect(app.getByTestId('play_button')).toBeFocused();

  await app.remote.press(Key.RIGHT);
  await expect(app.getByTestId('like_button')).toBeFocused();
  await app.remote.longPress(Key.SELECT, 1500);
  await expect(app.getByTestId('context_reset')).toBeVisible();
  await app.remote.press(Key.BACK);
  await expect(app.getByTestId('context_reset')).toHaveCount(0);
  // tvOS drops presses until focus is back: assert it before the next press.
  await expect(app.getByTestId('like_button')).toBeFocused();

  await app.remote.press(Key.BACK);
  await expect(app.getByTestId('rail_item_2')).toBeFocused();
});

test('toggles the player with PLAY_PAUSE', async ({ app }) => {
  await app.launch();
  await expect(app.getByTestId('rail_item_1')).toBeFocused();
  await app.remote.press(Key.SELECT);
  await expect(app.getByTestId('play_button')).toBeFocused();
  await app.remote.press(Key.SELECT);
  await expect(app.getByTestId('player_state')).toHaveText('playing');
  await expect(app.getByTestId('player_toggle')).toBeFocused();
  await app.remote.press(Key.PLAY_PAUSE);
  await expect(app.getByTestId('player_state')).toHaveText('paused');
  await expect(app.getByTestId('player_title')).toBeInViewport();
});

test('skips keys the Siri Remote does not have', requires('key.color'), async ({ app }) => {
  await app.launch();
  await app.remote.press(Key.RED);
});
