import { expect, Key, requires, test } from '@toets/test';

import { HomePage } from './pages/HomePage.js';
import { SettingsPage } from './pages/SettingsPage.js';

test.describe('rails', () => {
  test('right moves along a rail and the hero follows focus', async ({ app }) => {
    const home = new HomePage(app);
    await home.open();

    await app.remote.repeat(Key.RIGHT, 2);
    await expect(home.card('trending-3')).toBeFocused();
    await expect(home.heroTitle).toHaveText('Paper Planes');
    await expect(home.heroMeta).toHaveText('2025 · Comedy');
  });

  test('each rail remembers its focused card', async ({ app }) => {
    const home = new HomePage(app);
    await home.open();

    await app.remote.repeat(Key.RIGHT, 2);
    await expect(home.card('trending-3')).toBeFocused();
    // First visit of a rail: its first card.
    await app.remote.press(Key.DOWN);
    await expect(home.card('new-1')).toBeFocused();
    await app.remote.press(Key.RIGHT);
    await expect(home.card('new-2')).toBeFocused();
    // Back up and down again: each rail restores its own card, not the nearest one.
    await app.remote.press(Key.UP);
    await expect(home.card('trending-3')).toBeFocused();
    await app.remote.press(Key.DOWN);
    await expect(home.card('new-2')).toBeFocused();
  });

  test('up from the first rail keeps focus in the rails', async ({ app }) => {
    const home = new HomePage(app);
    await home.open();

    await app.remote.press(Key.UP);
    // Proves the press did not move focus: the next move starts from the same card.
    await app.remote.press(Key.RIGHT);
    await expect(home.card('trending-2')).toBeFocused();
  });

  test('pressUntilFocused walks down to a rail, then along it', async ({ app }) => {
    const home = new HomePage(app);
    await home.open();

    expect(await app.focus.pressUntilFocused(Key.DOWN, home.rail('family'))).toBe(3);
    expect(await app.focus.pressUntilFocused(Key.RIGHT, home.card('family-3'))).toBe(2);
    await expect(home.card('family-3')).toBeFocused();
    await expect(home.heroTitle).toHaveText('Moon Bakery');
  });

  test('pressUntilFocused fails fast when focus cannot move that way', async ({ app }) => {
    const home = new HomePage(app);
    await home.open();

    // Up from the first rail goes nowhere: the first press that leaves focus in place fails.
    await expect(app.focus.pressUntilFocused(Key.UP, home.menu.settings)).rejects.toMatchObject({
      code: 'FOCUS_STUCK',
    });
    await expect(home.card('trending-1')).toBeFocused();
  });

  test('navigateTo reaches a card in a lower rail', async ({ app }) => {
    const home = new HomePage(app);
    await home.open();

    await app.focus.navigateTo(home.card('family-3'));
    await expect(home.card('family-3')).toBeFocused();
    await expect(home.rail('family')).toHaveFocusWithin();
    await expect(home.card('family-3')).toBeInViewport();
    await expect(home.heroTitle).toHaveText('Moon Bakery');
  });
});

test.describe('side menu', () => {
  test('left from the first card enters the menu, right returns to the same card', async ({
    app,
  }) => {
    const home = new HomePage(app);
    await home.open();
    await app.remote.press(Key.DOWN);
    await expect(home.card('new-1')).toBeFocused();

    await app.remote.press(Key.LEFT);
    await expect(home.menu.home).toBeFocused();
    await app.remote.press(Key.RIGHT);
    await expect(home.card('new-1')).toBeFocused();
  });

  test(
    'opens settings and back returns to the home menu item',
    requires('key.back'),
    async ({ app }) => {
      const home = new HomePage(app);
      const settings = new SettingsPage(app);
      await home.open();

      await home.menu.open('settings');
      await settings.waitUntilLoaded();
      await expect(home.menu.settings).toBeSelected();
      await expect(home.screen).not.toBeVisible();

      await app.remote.press(Key.BACK);
      await expect(home.menu.home).toBeFocused();
      await expect(home.menu.home).toBeSelected();
      await expect(home.rails).toBeVisible();
    },
  );
});
