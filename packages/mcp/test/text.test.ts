import { defineKeyboard, Key, type DriverModule } from '@toets/core';
import { FakeDriver, type FakeNodeSpec, type FakeScreen } from '@toets/core/testing';
import { describe, expect, it } from 'vitest';
import { connect, FAST_TIMEOUTS } from './helpers.js';

const box = (x: number, y: number, width = 80, height = 60) => ({ x, y, width, height });

/** A sign-in form (system fields) and a PIN pad drawn by the app. */
function signInModule(): { module: DriverModule<never>; driver: () => FakeDriver } {
  let instance: FakeDriver | undefined;
  const pin = { value: '', submitted: null as string | null };
  const digit = (d: string, i: number): FakeNodeSpec => ({
    id: `pin_${d}`,
    testId: `pin_${d}`,
    text: d,
    focusable: true,
    bounds: box(100 + (i % 3) * 90, 400 + Math.floor(i / 3) * 70),
  });
  const screen = (focus: string): FakeScreen => ({
    initialFocus: focus,
    root: {
      testId: 'sign_in',
      bounds: box(0, 0, 1920, 1080),
      children: [
        { testId: 'email', focusable: true, editable: true, bounds: box(100, 100, 400) },
        {
          testId: 'password',
          focusable: true,
          editable: true,
          secure: true,
          bounds: box(100, 200, 400),
        },
        { testId: 'pin_value', text: '•'.repeat(pin.value.length), bounds: box(600, 300, 200) },
        ...(pin.submitted === null ? [] : [{ testId: 'pin_done', text: 'PIN ok' }]),
        {
          testId: 'pin_pad',
          bounds: box(90, 390, 300, 300),
          children: [
            ...'123456789'.split('').map(digit),
            { ...digit('0', 10) },
            {
              id: 'pin_del',
              testId: 'pin_del',
              text: 'del',
              focusable: true,
              bounds: box(100, 610),
            },
            { id: 'pin_ok', testId: 'pin_ok', text: 'OK', focusable: true, bounds: box(280, 610) },
          ],
        },
      ],
    },
  });
  return {
    driver: () => {
      if (!instance) throw new Error('driver not created yet');
      return instance;
    },
    module: {
      platform: 'web',
      async createDriver() {
        const d = new FakeDriver(screen('email'), ['key.back', 'text.input']);
        d.keyHandlers.set(Key.SELECT, (focused, drv) => {
          if (focused === 'pin_del') pin.value = pin.value.slice(0, -1);
          else if (focused === 'pin_ok') pin.submitted = pin.value;
          else if (focused?.startsWith('pin_')) pin.value += focused.slice(4);
          drv.setScreen(screen(focused ?? 'email'));
        });
        instance = d;
        return d;
      },
    },
  };
}

const pinPad = defineKeyboard({
  name: 'pin',
  root: { testId: 'pin_pad' },
  fields: [{ testId: 'pin_value' }],
  backspace: { testId: 'pin_del' },
  submit: { testId: 'pin_ok' },
});

async function harness() {
  const fake = signInModule();
  const h = await connect({
    config: {
      keyboards: [pinPad],
      targets: { web: { driver: fake.module, toets: { timeouts: FAST_TIMEOUTS } } },
    },
  });
  await h.ok('launch');
  return { ok: h.ok, err: h.err, driver: fake.driver() };
}

describe('text tools', () => {
  it('fills a system field and reports the code', async () => {
    const h = await harness();
    const out = await h.ok('fill', { target: { testId: 'email' }, text: 'a@b.co' });
    expect(out).toContain(`Filled getByTestId('email') with "a@b.co" (system).`);
    expect(out).toContain(`Code: await app.getByTestId('email').fill('a@b.co');`);
    expect(h.driver.valueOf('email')).toBe('a@b.co');
    expect(
      await h.ok('assert', {
        matcher: 'toHaveValue',
        target: { testId: 'email' },
        expected: 'a@b.co',
      }),
    ).toContain(`await expect(app.getByTestId('email')).toHaveValue('a@b.co');`);
  });

  it('masks secure fields everywhere', async () => {
    const h = await harness();
    const out = await h.ok('fill', { target: { testId: 'password' }, text: 'hunter2' });
    expect(out).not.toContain('hunter2');
    expect(out).toContain('"•••••••" (system)');
    expect(out).toContain('{ mask: true }');
    expect(h.driver.valueOf('password')).toBe('hunter2');
    expect(await h.ok('snapshot')).toContain(
      '- password [focused, editable, secure] value="•••••••"',
    );
    expect(
      await h.err('assert', {
        matcher: 'toHaveValue',
        target: { testId: 'password' },
        expected: 'x',
      }),
    ).toContain('SECURE_FIELD');
  });

  it('types on a declared keyboard, erases and submits', async () => {
    const h = await harness();
    await h.ok('navigate_to', { target: { testId: 'pin_1' } });
    const typed = await h.ok('type', { text: '2580', mask: true });
    expect(typed).toMatch(/Typed "••••" \(keyboard: pin, \d+ presses\)\./);
    expect(typed).not.toContain('2580');
    expect(await h.ok('erase', { count: 1 })).toContain('Code: await app.keyboard.erase(1);');
    expect(await h.ok('snapshot', { target: { testId: 'pin_value' } })).toBe('- pin_value "•••"');
    expect(await h.ok('submit')).toContain('Code: await app.keyboard.submit();');
    expect(await h.ok('query', { target: { testId: 'pin_done' } })).toContain('PIN ok');
  });

  it('asserts toBeOpen on app.keyboard and lists keyboards in capabilities', async () => {
    const h = await harness();
    expect(await h.ok('assert', { matcher: 'toBeOpen' })).toContain(
      'await expect(app.keyboard).toBeOpen();',
    );
    expect(await h.ok('capabilities')).toContain(
      `Keyboards: pin (fields: getByTestId('pin_value')); system text fields: yes (text.input)`,
    );
  });

  it('fails with NO_KEYBOARD on a field nothing types into', async () => {
    const h = await harness();
    expect(await h.err('fill', { target: { testId: 'sign_in' }, text: 'x' })).toContain(
      'NO_KEYBOARD',
    );
  });
});
