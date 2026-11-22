import { expect, test } from '@dpad-tv/test';

test('home looks right', async ({ app }) => {
  await app.launch();
  await expect(app).toMatchTextSnapshot({ name: 'home.yml' });
  await expect(app).toMatchScreenshot({ name: 'home.png', mask: [app.getByTestId('card_3')] });
  await expect(app.getByTestId('side_menu')).toMatchScreenshot();
});
