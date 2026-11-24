import { describe, expect, it } from 'vitest';
import { ToetsError, Key } from '../src/index.js';
import { setup } from './fixtures.js';

describe('locators', () => {
  it('are lazy and describe themselves', async () => {
    const { app, driver } = setup();
    const loc = app
      .getByTestId('rail_new')
      .getByText(/new \d/i)
      .nth(1);
    expect(String(loc)).toBe("getByTestId('rail_new').getByText(/new \\d/i).nth(1)");
    expect(String(app.getByText('Home', { exact: true }).first())).toBe(
      "getByText('Home', { exact: true }).first()",
    );
    expect(String(app.getByText("it's\nnew\\"))).toBe("getByText('it\\'s\\nnew\\\\')");
    expect(await loc.text()).toBe('New 2');
    driver.focus('new_2');
    expect(await loc.isFocused()).toBe(true);
  });

  it('count, isVisible and testId read current state', async () => {
    const { app } = setup();
    expect(await app.getByText('trending').count()).toBe(7);
    expect(await app.getByTestId('hidden_banner').isVisible()).toBe(false);
    expect(await app.getByTestId('missing').isVisible()).toBe(false);
    expect(await app.getByText('Settings').testId()).toBe('menu_settings');
  });

  it('enforce strictness for single-element reads', async () => {
    const { app } = setup();
    const err = await app
      .getByText(/^Trending \d$/)
      .text()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToetsError);
    expect((err as ToetsError).code).toBe('STRICT_MODE_VIOLATION');
    expect((err as ToetsError).message).toContain('resolved to 6 elements');
    expect((err as ToetsError).message).toContain('- trending_1 "Trending 1"');
  });

  it('time out with a hint when nothing matches', async () => {
    const { app } = setup();
    await expect(app.getByTestId('nope').text()).rejects.toMatchObject({
      code: 'ELEMENT_NOT_FOUND',
      message: "getByTestId('nope') matched no element within 300ms.",
    });
  });

  it('focus.current() follows focus', async () => {
    const { app } = setup();
    expect(await app.focus.current().testId()).toBe('menu_home');
    await app.remote.press(Key.DOWN);
    expect(await app.focus.current().testId()).toBe('menu_settings');
    expect(String(app.focus.current())).toBe('focus.current()');
  });

  it('snapshot() renders the element subtree', async () => {
    const { app } = setup();
    expect(await app.getByTestId('side_menu').snapshot()).toBe(
      ['- side_menu:', '  - menu_home "Home" [focused]', '  - menu_settings "Settings"'].join('\n'),
    );
  });
});
