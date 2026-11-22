import { expect, Key, test } from '@dpad-tv/test';

test('reports a focus mismatch with a failure dump', { tag: '@failing' }, async ({ app }) => {
  await app.launch();
  await app.remote.press(Key.RIGHT);
  await expect(app.getByTestId('menu_settings')).toBeFocused({ timeout: 200 });
});
