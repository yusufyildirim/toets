import { test, expect, Key } from '@dpad-tv/test';

test('remembers the focused card when returning to a rail', async ({ app }) => {
  await app.launch();

  const card = app.getByTestId('rail-0-card-3');
  await app.focus.navigateTo(card);
  await expect(card).toBeFocused();

  await app.remote.press(Key.DOWN);
  await expect(app.getByTestId('rail-1')).toHaveFocusWithin();

  await app.remote.press(Key.UP);
  await expect(card).toBeFocused();
});
