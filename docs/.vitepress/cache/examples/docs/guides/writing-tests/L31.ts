import { test as base, expect, type App } from '@dpad-tv/test';

/** The app launched and past the splash screen. */
export const test = base.extend<{ home: App }>({
  home: async ({ app }, use) => {
    await app.launch();
    await expect(app.getByTestId('home-screen')).toBeVisible({ timeout: 30_000 });
    await use(app);
  },
});

test('home shows the featured rail first', async ({ home }) => {
  await expect(home.getByTestId('rail-0')).toHaveFocusWithin();
});
