import { describe, expect, it } from 'vitest';
import {
  defineKeyboard,
  Key,
  keyboardMatchers,
  locatorMatchers,
  type ActionInfo,
  type KeyboardDefinition,
  type ToetsError,
} from '../src/index.js';
import { layerName } from '../src/runtime/keyboard.js';
import { planRoute } from '../src/runtime/route.js';
import type { FakeDriver, FakeNodeSpec, FakeScreen } from '../src/testing/index.js';
import { ALL_KEYS, setup } from './fixtures.js';

const LAYERS: Record<string, readonly string[]> = {
  lower: ['abcdefg', 'hijklmn', 'opqrstu', "vwxyz-'"],
  upper: ['ABCDEFG', 'HIJKLMN', 'OPQRSTU', "VWXYZ-'"],
  symbols: ['1234567', '890.@_!', '?&#:/()'],
};

const key = (id: string, text: string, x: number, y: number, width = 72): FakeNodeSpec => ({
  id,
  testId: id,
  focusable: true,
  bounds: { x, y, width, height: 64 },
  children: [{ text, bounds: { x: x + 10, y: y + 10, width: 40, height: 40 } }],
});

/**
 * A search screen with an app-drawn keyboard like the example app's: SELECT on the field opens
 * it; Shift is one-shot, `?123`/`ABC` switches to symbols (Shift hidden there).
 */
function searchApp(driver: FakeDriver) {
  const state = { query: '', layer: 'lower', open: false, submitted: null as string | null };
  const render = (focus: string | null): FakeScreen => {
    const rows = LAYERS[state.layer] as readonly string[];
    const bottomY = 300 + rows.length * 74;
    const wide = (id: string, text: string, i: number) => key(id, text, 100 + i * 96, bottomY, 86);
    const bottom = [
      ...(state.layer === 'symbols' ? [] : [wide('osk_shift', 'Shift', 0)]),
      wide('osk_symbols', state.layer === 'symbols' ? 'ABC' : '?123', 1),
      wide('osk_space', 'space', 2),
      wide('osk_del', 'del', 3),
      wide('osk_clear', 'clear', 4),
      wide('osk_go', 'Go', 5),
    ];
    return {
      initialFocus: focus ?? 'search_query',
      root: {
        id: 'root',
        children: [
          {
            testId: 'search_query',
            focusable: true,
            bounds: { x: 100, y: 100, width: 600, height: 80 },
            ...(state.query ? { children: [{ text: state.query }] } : {}),
          },
          ...(state.submitted === null ? [] : [{ testId: 'submitted', text: state.submitted }]),
          ...(state.open
            ? [
                {
                  testId: 'osk',
                  bounds: { x: 90, y: 290, width: 700, height: 400 },
                  children: [
                    ...rows.flatMap((row, r) =>
                      [...row].map((c, i) =>
                        key(`osk_key_${r}_${i}`, c, 100 + i * 82, 300 + r * 74),
                      ),
                    ),
                    ...bottom,
                  ],
                },
              ]
            : []),
        ],
      },
    };
  };
  const rerender = (focus: string | null) => {
    const keep = focus && (focus !== 'osk_shift' || state.layer !== 'symbols') ? focus : null;
    driver.setScreen(render(keep ?? (state.open ? 'osk_key_0_0' : 'search_query')));
  };
  driver.keyHandlers.set(Key.SELECT, (focused) => {
    if (focused === 'search_query') state.open = true;
    else if (focused === 'osk_shift') state.layer = state.layer === 'upper' ? 'lower' : 'upper';
    else if (focused === 'osk_symbols')
      state.layer = state.layer === 'symbols' ? 'lower' : 'symbols';
    else if (focused === 'osk_space') state.query += ' ';
    else if (focused === 'osk_del') state.query = state.query.slice(0, -1);
    else if (focused === 'osk_clear') state.query = '';
    else if (focused === 'osk_go') {
      state.submitted = state.query;
      state.open = false;
    } else if (focused?.startsWith('osk_key_')) {
      const [r, c] = focused.slice('osk_key_'.length).split('_').map(Number);
      state.query += (LAYERS[state.layer] as readonly string[])[r as number]?.[c as number] ?? '';
      if (state.layer === 'upper') state.layer = 'lower';
    }
    rerender(state.open ? focused : 'search_query');
  });
  driver.keyHandlers.set(Key.BACK, () => {
    state.open = false;
    rerender('search_query');
  });
  driver.setScreen(render('search_query'));
  return state;
}

const search: KeyboardDefinition = defineKeyboard({
  name: 'search',
  root: { testId: 'osk' },
  fields: [{ testId: 'search_query' }],
  layers: [{ testId: 'osk_shift' }, { testId: 'osk_symbols' }],
  space: { testId: 'osk_space' },
  backspace: { testId: 'osk_del' },
  clear: { testId: 'osk_clear' },
  submit: { testId: 'osk_go' },
});

function osk(keyboards: readonly KeyboardDefinition[] = [search]) {
  const steps: ActionInfo[] = [];
  const env = setup({
    screen: { root: { id: 'root' } },
    runtime: {
      keyboards,
      hooks: {
        step: (info, run) => {
          steps.push(info);
          return run();
        },
      },
    },
  });
  const state = searchApp(env.driver);
  return { ...env, state, steps, titles: () => steps.map((s) => s.title) };
}

const field = (extra: Partial<FakeNodeSpec> = {}): FakeNodeSpec => ({
  testId: 'email',
  focusable: true,
  editable: true,
  bounds: { x: 100, y: 100, width: 400, height: 60 },
  ...extra,
});

function signIn(capabilities = [...ALL_KEYS, 'text.input' as const]) {
  const steps: ActionInfo[] = [];
  const env = setup({
    capabilities,
    screen: {
      initialFocus: 'menu',
      root: {
        id: 'root',
        children: [
          {
            testId: 'menu',
            text: 'Menu',
            focusable: true,
            bounds: { x: 0, y: 0, width: 80, height: 60 },
          },
          field(),
          field({
            testId: 'password',
            secure: true,
            bounds: { x: 100, y: 200, width: 400, height: 60 },
          }),
          { testId: 'title', text: 'Sign in', bounds: { x: 100, y: 20, width: 200, height: 40 } },
        ],
      },
    },
    runtime: {
      hooks: {
        step: (info, run) => {
          steps.push(info);
          return run();
        },
      },
    },
  });
  return { ...env, steps };
}

describe('defineKeyboard', () => {
  it('validates targets and freezes the definition', () => {
    expect(Object.isFrozen(search)).toBe(true);
    expect(() => defineKeyboard({ name: '', root: { testId: 'x' } })).toThrow(/non-empty name/);
    expect(() => defineKeyboard({ name: 'k', root: {} })).toThrow(/testId and\/or text/);
    expect(() =>
      defineKeyboard({
        name: 'k',
        root: { testId: 'x' },
        bogus: 1,
      } as unknown as KeyboardDefinition),
    ).toThrow(/unknown key 'bogus'/);
  });

  it('rejects duplicate names', () => {
    const { runtime } = setup();
    expect(() => runtime.setKeyboards([search, search])).toThrow(
      expect.objectContaining({ code: 'DUPLICATE_KEYBOARD' }),
    );
  });
});

describe('layerName', () => {
  it('names layers from their one-character keys', () => {
    expect(layerName(['a', 'b', 'Shift'])).toBe('lower');
    expect(layerName(['A', 'B', '-'])).toBe('upper');
    expect(layerName(['a', 'B'])).toBe('mixed');
    expect(layerName(['1', '2', '3'])).toBe('digits');
    expect(layerName(['1', '?', '&', '#'])).toBe('symbols');
  });
});

describe('planRoute', () => {
  const grid = [0, 1, 2].flatMap((r) =>
    [0, 1, 2].map((c) => ({
      id: `${r}${c}`,
      bounds: { x: c * 100, y: r * 100, width: 90, height: 90 },
    })),
  );
  it('walks a grid along the shortest path', () => {
    expect(planRoute(grid, '00', '22')).toHaveLength(4);
    expect(planRoute(grid, '11', '11')).toEqual([]);
    expect(planRoute(grid, '00', '01')).toEqual(['right']);
  });
  it('gives up on unknown elements', () => {
    expect(planRoute(grid, '00', 'zz')).toBeNull();
  });
});

describe('fill on an app keyboard', () => {
  it('opens the keyboard with SELECT, switches layers and checks the field', async () => {
    const { app, state, titles, steps } = osk();
    await app.getByTestId('search_query').fill('Ma1 x');
    expect(state.query).toBe('Ma1 x');
    expect(state.open).toBe(true);
    expect(titles()[0]).toBe(`fill getByTestId('search_query') "Ma1 x" (keyboard: search)`);
    expect(titles()).toContain('key "M"');
    expect(titles()).toContain('key "Shift"');
    const fill = steps[0] as ActionInfo;
    expect(fill.summary?.()).toMatch(/^\d+ presses$/);
  });

  it('clears what the field showed before', async () => {
    const { app, state, driver } = osk();
    await app.getByTestId('search_query').fill('abc');
    await app.getByTestId('search_query').fill('zz');
    expect(state.query).toBe('zz');
    expect(driver.presses.some((p) => p.key === Key.SELECT)).toBe(true);
  });

  it('masks the text in step titles', async () => {
    const { app, titles } = osk();
    await app.getByTestId('search_query').fill('ab', { mask: true });
    expect(titles()[0]).toBe(`fill getByTestId('search_query') "••" (keyboard: search)`);
    expect(titles()).toContain('key •');
    expect(titles().join('\n')).not.toMatch(/"a"|"b"/);
  });

  it('fails with CHAR_NOT_ON_KEYBOARD listing the layers seen', async () => {
    const { app } = osk();
    const error = (await app
      .getByTestId('search_query')
      .fill('a€')
      .catch((e: unknown) => e)) as ToetsError;
    expect(error.code).toBe('CHAR_NOT_ON_KEYBOARD');
    expect(error.message).toMatch(/lower/);
    expect(error.message).toMatch(/symbols/);
  });
});

describe('app.keyboard', () => {
  it('types, erases and submits on the keyboard holding focus', async () => {
    const { app, state } = osk();
    await app.getByTestId('search_query').fill('ma');
    await app.keyboard.type('trix');
    await app.keyboard.erase(2);
    expect(state.query).toBe('matr');
    await app.keyboard.submit();
    expect(state.submitted).toBe('matr');
    expect(state.open).toBe(false);
  });

  it('is open while a declared keyboard is on screen', async () => {
    const { app, runtime } = osk();
    const ctx = { isNot: false, timeoutMs: 50 };
    expect((await keyboardMatchers.toBeOpen(ctx, app.keyboard)).pass).toBe(false);
    await app.getByTestId('search_query').fill('a');
    expect((await keyboardMatchers.toBeOpen(ctx, app.keyboard)).pass).toBe(true);
    expect(await runtime.snapshot()).toContain(
      `- 'osk [keyboard: search, layer: lower, focused: "a"]'`,
    );
    const keys = await app.getByTestId('osk').snapshot();
    expect(keys.split('\n')[0]).toBe('- osk:');
    expect(keys).toContain('  - osk_key_0_0 [focused]:\n    - text "a"');
  });

  it('fails with NO_KEYBOARD when nothing is open', async () => {
    const { app } = osk();
    await expect(app.keyboard.type('a')).rejects.toMatchObject({ code: 'NO_KEYBOARD' });
  });

  it('fails with KEYBOARD_ACTION_MISSING without a declared key', async () => {
    const bare = defineKeyboard({
      name: 'search',
      root: { testId: 'osk' },
      fields: [{ testId: 'search_query' }],
    });
    const { app } = osk([bare]);
    await app
      .getByTestId('search_query')
      .fill('a')
      .catch(() => undefined);
    await expect(app.keyboard.submit()).rejects.toMatchObject({ code: 'KEYBOARD_ACTION_MISSING' });
  });

  it('fails with AMBIGUOUS_KEYBOARD when several are open and none holds focus', async () => {
    const pad = (id: string, x: number): FakeNodeSpec => ({
      testId: id,
      bounds: { x, y: 300, width: 200, height: 100 },
      children: [key(`${id}_a`, 'a', x, 300)],
    });
    const one = defineKeyboard({ name: 'one', root: { testId: 'one' } });
    const two = defineKeyboard({ name: 'two', root: { testId: 'two' } });
    const { app } = setup({
      runtime: { keyboards: [one, two] },
      screen: {
        initialFocus: 'menu',
        root: {
          id: 'root',
          children: [
            {
              testId: 'menu',
              text: 'Menu',
              focusable: true,
              bounds: { x: 0, y: 0, width: 80, height: 60 },
            },
            pad('one', 100),
            pad('two', 400),
          ],
        },
      },
    });
    const error = (await app.keyboard.type('a').catch((e: unknown) => e)) as ToetsError;
    expect(error.code).toBe('AMBIGUOUS_KEYBOARD');
    expect(error.message).toContain("'one', 'two'");
  });
});

describe('fill on a system text field', () => {
  it('navigates with the D-pad and replaces the text through the platform', async () => {
    const { app, driver, steps } = signIn();
    await app.getByTestId('email').fill('a@b.co');
    expect(driver.valueOf('email')).toBe('a@b.co');
    expect(driver.textCalls).toEqual(['replace:a@b.co']);
    expect(driver.presses.length).toBeGreaterThan(0);
    expect(steps[0]?.title).toBe(`fill getByTestId('email') "a@b.co" (system)`);
    const ctx = { isNot: false, timeoutMs: 50 };
    expect((await locatorMatchers.toHaveValue(ctx, app.getByTestId('email'), 'a@b.co')).pass).toBe(
      true,
    );
    expect((await keyboardMatchers.toBeOpen(ctx, app.keyboard)).pass).toBe(true);
  });

  it('masks password fields automatically', async () => {
    const { app, driver, steps, runtime } = signIn();
    await app.getByTestId('password').fill('hunter2');
    expect(driver.valueOf('password')).toBe('hunter2');
    expect(steps[0]?.title).toBe(`fill getByTestId('password') "•••••••" (system)`);
    expect(await runtime.snapshot()).toContain(
      '- password [focused, editable, secure] value="•••••••"',
    );
    await expect(
      locatorMatchers.toHaveValue(
        { isNot: false, timeoutMs: 50 },
        app.getByTestId('password'),
        'x',
      ),
    ).rejects.toMatchObject({ code: 'SECURE_FIELD' });
  });

  it('types, erases and submits with system text entry', async () => {
    const { app, driver } = signIn();
    let submitted: string | null = null;
    driver.onSubmit = (id) => (submitted = id);
    await app.getByTestId('email').fill('ma');
    await app.keyboard.type('trix');
    await app.keyboard.erase(2);
    await app.keyboard.submit();
    expect(driver.valueOf('email')).toBe('matr');
    expect(submitted).toBe('email');
  });

  it('needs text.input', async () => {
    const { app } = signIn([...ALL_KEYS]);
    await expect(app.getByTestId('email').fill('x')).rejects.toMatchObject({
      code: 'CAPABILITY_MISSING',
    });
  });

  it('fails with NO_KEYBOARD on other elements, and toHaveValue with NOT_EDITABLE', async () => {
    const { app } = signIn();
    await expect(app.getByTestId('title').fill('x')).rejects.toMatchObject({ code: 'NO_KEYBOARD' });
    await expect(
      locatorMatchers.toHaveValue({ isNot: false, timeoutMs: 50 }, app.getByTestId('title'), 'x'),
    ).rejects.toMatchObject({ code: 'NOT_EDITABLE' });
  });
});
