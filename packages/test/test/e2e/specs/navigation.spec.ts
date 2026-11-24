import { expect, Key, requires, test } from '@toets/test';

test('opens details from the rail', async ({ app }) => {
  await app.launch();
  await expect(app.getByTestId('menu_home')).toBeFocused();

  expect(await app.focus.pressUntil(Key.RIGHT, app.getByTestId('card_2'))).toBe(2);
  await expect(app.getByTestId('rail')).toHaveFocusWithin();
  await expect(app.getByText('Movie', { exact: false })).toHaveCount(3);

  await app.remote.press(Key.SELECT);
  await expect(app.getByTestId('details_title')).toHaveText('Movie 2');
  await expect(app.getByTestId('rail')).not.toBeVisible();
  await expect(app).toMatchTextSnapshot(`
    - details_title "Movie 2"
    - play "Play" [focused]
  `);

  await app.remote.press(Key.BACK);
  await expect(app.getByTestId('rail')).toBeVisible();
});

test('color keys work', requires('key.color'), async ({ app }) => {
  await app.launch();
  await app.remote.press(Key.RED);
});

test.describe('player', requires('media.state'), () => {
  test('toggles playback', async ({ app }) => {
    await app.launch();
    await app.remote.press(Key.PLAY_PAUSE);
    await expect(app.media).toBePlaying();
    await expect(app.media).toHavePosition(3);
    await app.remote.press(Key.PLAY_PAUSE);
    await expect(app.media).toBePaused();
  });
});

test('loads home through the mock server', requires('network.mock'), async ({ app }) => {
  await app.launch();
  await expect(app.network).toHaveRequested({ url: '/api/home' }, { times: 1 });
});

test('fast forward', async ({ app }) => {
  await app.launch();
  await app.focus.navigateTo(app.getByTestId('card_1'));
  // tvOS performs it as "hold RIGHT" through the project's key override.
  await app.remote.press(Key.FAST_FORWARD);
  await app.platformOnly('tvos', async () => {
    await expect(app.getByTestId('card_2')).toBeFocused();
  });
});

test('launches into a state with the SDK', requires('app.state'), async ({ app }) => {
  await app.launch({ state: 'details' });
  await expect(app.getByTestId('details_title')).toBeVisible();
});
