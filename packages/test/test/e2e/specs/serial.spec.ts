import { expect, test, type App } from '@toets/test';

const launched = async (app: App): Promise<boolean> => {
  let value = false;
  // The fake driver is the escape-hatch handle on both platforms.
  for (const platform of ['web', 'tvos'] as const) {
    await app.platformOnly(platform, async (driver) => {
      value = (driver as { launched: boolean }).launched;
    });
  }
  return value;
};

test.describe.serial('a serial flow shares one app', () => {
  test('step 1: launch and move', async ({ app }) => {
    await app.launch();
    await app.focus.navigateTo(app.getByTestId('card_3'));
  });

  test('step 2: still there', async ({ app }) => {
    expect(await launched(app)).toBe(true);
    await expect(app.getByTestId('card_3')).toBeFocused();
  });
});

test('a test after the serial block starts isolated', async ({ app }) => {
  expect(await launched(app)).toBe(false);
});
