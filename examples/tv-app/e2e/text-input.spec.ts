import { expect, Key, requires, test } from '@toets/test';

import { HomePage } from './pages/HomePage.js';
import { SearchPage } from './pages/SearchPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { SignInPage } from './pages/SignInPage.js';

// The app keyboards are declared in keyboards.ts and passed to defineConfig({ keyboards }).

test.describe('the search keyboard', () => {
  test('fill types across layers and narrows the results', async ({ app }) => {
    const home = new HomePage(app);
    const search = new SearchPage(app);
    await home.open();
    await home.menu.open('search');
    await search.waitUntilLoaded();

    await search.query.fill('Night');
    await expect(search.query).toHaveText('Night');
    await expect(app.keyboard).toBeOpen();
    await expect(search.result('trending-6')).toHaveText('Night Market');
    await expect(search.result('documentaries-8')).toHaveText('Night Shift');

    await app.keyboard.type(' m');
    await expect(search.result('trending-6')).toHaveText('Night Market');
    await expect(search.result('documentaries-8')).not.toBeVisible();

    await app.keyboard.erase(2);
    await expect(search.query).toHaveText('Night');
    await app.keyboard.submit();
    await expect(search.submitted).toHaveText('Results for "Night"');
    await expect(app.keyboard).not.toBeOpen();
    await expect(search.query).toBeFocused();
  });

  test('fill replaces the query, with symbols', async ({ app }) => {
    const home = new HomePage(app);
    const search = new SearchPage(app);
    await home.open();
    await home.menu.open('search');
    await search.waitUntilLoaded();

    await search.query.fill('wild');
    await search.query.fill("it's 2026!");
    await expect(search.query).toHaveText("it's 2026!");
    await expect(search.empty).toHaveText('No results');
  });

  test('the snapshot collapses the keyboard to one line', async ({ app }) => {
    const home = new HomePage(app);
    const search = new SearchPage(app);
    await home.open();
    await home.menu.open('search');
    await search.query.fill('a');

    expect(await app.snapshot()).toContain(
      `- 'osk [keyboard: search, layer: lower, focused: "a"]'`,
    );
    expect(await search.keyboard.snapshot()).toContain('- osk_shift:');
  });

  test('BACK closes it', requires('key.back'), async ({ app }) => {
    const home = new HomePage(app);
    const search = new SearchPage(app);
    await home.open();
    await home.menu.open('search');
    await search.query.fill('ab');
    await expect(app.keyboard).toBeOpen();

    await app.remote.press(Key.BACK);
    await expect(search.keyboard).not.toBeVisible();
    await expect(search.query).toBeFocused();
  });
});

test('signs in with the system keyboard', requires('text.input'), async ({ app }) => {
  const home = new HomePage(app);
  const signIn = new SignInPage(app);
  await home.open();
  await home.menu.open('signin');
  await signIn.waitUntilLoaded();

  await signIn.email.fill('ada@example.com');
  await expect(signIn.email).toHaveValue('ada@example.com');
  await signIn.password.fill('tv-pass-1'); // a password field: masked in the report
  await expect(signIn.password).toHaveText('•••••••••');

  await app.focus.navigateTo(signIn.submit);
  await app.remote.press(Key.SELECT);
  await expect(signIn.status).toHaveText('Signed in as ada@example.com');
});

test('the keyboard action key signs in', requires('text.input'), async ({ app }) => {
  const home = new HomePage(app);
  const signIn = new SignInPage(app);
  await home.open();
  await home.menu.open('signin');
  await signIn.waitUntilLoaded();

  await signIn.password.fill('tv-pass-1');
  await signIn.email.fill('ada@example.co');
  await app.keyboard.type('mm');
  await app.keyboard.erase(1);
  await expect(signIn.email).toHaveValue('ada@example.com');
  await app.keyboard.submit();
  await expect(signIn.status).toHaveText('Signed in as ada@example.com');
});

test('the parental PIN unlocks with the PIN pad', async ({ app }) => {
  const home = new HomePage(app);
  const settings = new SettingsPage(app);
  await home.open();
  await home.menu.open('settings');
  await settings.waitUntilLoaded();
  await expect(settings.pinStatus).toHaveText('Locked');

  await settings.openPin();
  await settings.pinValue.fill('1111', { mask: true });
  await app.keyboard.submit();
  await expect(settings.pinError).toBeVisible();

  await settings.pinValue.fill('2580', { mask: true });
  await app.keyboard.submit();
  await expect(settings.pinStatus).toHaveText('Unlocked');
  await expect(app.keyboard).not.toBeOpen();
});
