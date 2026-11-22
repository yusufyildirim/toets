import { expect, Key, test } from '@dpad-tv/test';

test('reports a focus mismatch with a failure dump', { tag: '@failing' }, async ({ app }) => {
  await app.launch();
  await app.remote.press(Key.RIGHT);
  await expect(app.getByTestId('menu_settings')).toBeFocused({ timeout: 200 });
});

test('prints the code, hint and docs of a DpadError', { tag: '@failing' }, async ({ app }) => {
  await app.launch();
  await app.focus.navigateTo(app.getByTestId('no_such_element'));
});
