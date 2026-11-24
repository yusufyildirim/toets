import { describe, expect, it } from 'vitest';
import type { DirectionKey, ToetsError } from '../src/index.js';
import { Key, type ActionInfo } from '../src/index.js';
import { rankDirections } from '../src/runtime/focus.js';
import type { FakeDriver, FakeNodeSpec, FakeScreen } from '../src/testing/index.js';
import { setup } from './fixtures.js';

const box = (
  id: string,
  x: number,
  y: number,
  extra: Partial<FakeNodeSpec> = {},
): FakeNodeSpec => ({
  id,
  testId: id,
  focusable: true,
  bounds: { x, y, width: 100, height: 100 },
  ...extra,
});

/**
 * A virtualized row of `total` items: only the focused item and its neighbors exist. With
 * `fixedSlots`, three slots keep their ids while the items scroll through them (focus stays in
 * the middle slot), like a carousel with a fixed focus position on a driver with positional refs.
 */
function virtualRow(total: number, opts: { fixedSlots?: boolean } = {}) {
  const screen = (index: number): FakeScreen => {
    const items = [index - 1, index, index + 1].filter((i) => i >= 0 && i < total);
    return {
      initialFocus: opts.fixedSlots ? `slot${index - Math.max(0, index - 1)}` : `item_${index}`,
      root: {
        id: 'root',
        children: items.map((i, slot) =>
          box(opts.fixedSlots ? `slot${slot}` : `item_${i}`, slot * 120, 0, {
            testId: `item_${i}`,
            text: `Item ${i}`,
          }),
        ),
      },
    };
  };
  return {
    screen: screen(0),
    /** Re-renders the window around the focused item after every RIGHT press. */
    attach(driver: FakeDriver) {
      let index = 0;
      const press = driver.press.bind(driver);
      driver.press = async (key, opts) => {
        if (key !== Key.RIGHT) return press(key, opts);
        driver.presses.push({ key, opts });
        if (index < total - 1) driver.setScreen(screen(++index));
      };
    },
  };
}

describe('rankDirections', () => {
  const r = (x: number, y: number) => ({ x, y, width: 100, height: 100 });
  it('moves horizontally within a row and vertically within a column', () => {
    expect(rankDirections(r(0, 0), r(300, 20))[0]).toBe('right');
    expect(rankDirections(r(0, 0), r(10, 400))[0]).toBe('down');
  });
  it('prefers vertical first across rows, then horizontal, then detours', () => {
    expect(rankDirections(r(500, 500), r(0, 0))).toEqual(['up', 'left', 'down', 'right']);
  });
});

describe('focus.navigateTo', () => {
  it('reaches a card in another row with real presses and returns the path', async () => {
    const steps: string[] = [];
    const { app, driver } = setup({
      runtime: { hooks: { step: (i: ActionInfo, run) => (steps.push(i.title), run()) } },
    });
    const path = await app.focus.navigateTo(app.getByTestId('new_3'));
    expect(await app.focus.current().testId()).toBe('new_3');
    expect(path).toEqual(driver.presses.map((p) => p.key.toLowerCase()));
    expect(path.at(-1)).toBe('right');
    expect(steps[0]).toBe("navigateTo getByTestId('new_3')");
    expect(steps.slice(1).every((s) => s.startsWith('press '))).toBe(true);
  });

  it('returns an empty path when already there, and accepts containers', async () => {
    const { app, driver } = setup();
    expect(await app.focus.navigateTo(app.getByTestId('menu_home'))).toEqual([]);
    expect(await app.focus.navigateTo(app.getByTestId('side_menu'))).toEqual([]);
    await app.focus.navigateTo(app.getByTestId('rail_new'));
    expect(await app.getByTestId('rail_new').isVisible()).toBe(true);
    expect((await driver.focused())?.testId).toMatch(/^new_/);
  });

  it('recovers from dead ends using detours', async () => {
    const { app } = setup({
      screen: {
        initialFocus: 'a',
        root: {
          children: [
            // b sits right of a, but a's RIGHT is blocked; the route is DOWN, RIGHT, UP.
            {
              id: 'a',
              testId: 'a',
              focusable: true,
              bounds: { x: 0, y: 0, width: 100, height: 100 },
              neighbors: { right: 'a' },
            },
            {
              id: 'b',
              testId: 'b',
              focusable: true,
              bounds: { x: 200, y: 0, width: 100, height: 100 },
            },
            {
              id: 'c',
              testId: 'c',
              focusable: true,
              bounds: { x: 0, y: 200, width: 100, height: 100 },
            },
            {
              id: 'd',
              testId: 'd',
              focusable: true,
              bounds: { x: 200, y: 200, width: 100, height: 100 },
            },
          ],
        },
      },
    });
    const path = await app.focus.navigateTo(app.getByTestId('b'));
    expect(path).toEqual(['right', 'up', 'down', 'up', 'down', 'right', 'up']);
    expect(await app.focus.current().testId()).toBe('b');
  });

  it('fails with the path tried when the target is unreachable', async () => {
    const { app } = setup({
      screen: {
        initialFocus: 'a',
        root: {
          children: [
            {
              id: 'a',
              testId: 'a',
              focusable: true,
              bounds: { x: 0, y: 0, width: 100, height: 100 },
            },
            {
              id: 'b',
              testId: 'b',
              focusable: true,
              enabled: false,
              bounds: { x: 200, y: 0, width: 100, height: 100 },
            },
          ],
        },
      },
    });
    const err = (await app.focus
      .navigateTo(app.getByTestId('b'))
      .catch((e: unknown) => e)) as ToetsError;
    expect(err.code).toBe('FOCUS_UNREACHABLE');
    expect(err.message).toBe(
      "Could not move focus to getByTestId('b'): no untried direction is left. Focus is on a. Path: right, up, down, left.",
    );
    expect(err.hint).toContain('focus trap');
  });

  it('honors maxPresses', async () => {
    const { app } = setup();
    await expect(app.focus.navigateTo(app.getByTestId('new_3'), { maxPresses: 1 })).rejects.toThrow(
      /gave up after 1 presses/,
    );
  });

  it('fails when no press reaches a target that never takes focus', async () => {
    const { app } = setup();
    await expect(
      app.focus.navigateTo(app.getByText('Trending', { exact: true })),
    ).rejects.toMatchObject({ code: 'FOCUS_UNREACHABLE' });
  });

  it('points to pressUntil when the target is not on screen', async () => {
    const { app } = setup();
    await expect(app.focus.navigateTo(app.getByTestId('trending_99'))).rejects.toMatchObject({
      code: 'ELEMENT_NOT_FOUND',
      hint: expect.stringContaining('app.focus.pressUntil(key, target)'),
    });
  });

  it('learns moves by element, not by ref, when refs are tree positions', async () => {
    const row = virtualRow(6, { fixedSlots: true });
    const { app, driver } = setup({ screen: row.screen });
    row.attach(driver);
    // item_2 is on screen (slot 2) once item_1 holds focus.
    await app.focus.pressUntil(Key.RIGHT, app.getByTestId('item_1'));
    expect(await app.focus.navigateTo(app.getByTestId('item_2'))).toEqual(['right']);
    expect(await app.focus.current().testId()).toBe('item_2');
  });
});

describe('focus.pressUntil', () => {
  it('presses one direction until the target holds focus and returns the presses', async () => {
    const steps: string[] = [];
    const { app, driver } = setup({
      runtime: { hooks: { step: (i: ActionInfo, run) => (steps.push(i.title), run()) } },
    });
    expect(await app.focus.pressUntil(Key.RIGHT, app.getByTestId('trending_3'))).toBe(3);
    expect(await app.focus.current().testId()).toBe('trending_3');
    expect(driver.presses.map((p) => p.key)).toEqual(['RIGHT', 'RIGHT', 'RIGHT']);
    expect(steps).toEqual([
      "pressUntil RIGHT getByTestId('trending_3')",
      'press RIGHT',
      'press RIGHT',
      'press RIGHT',
    ]);
  });

  it('presses nothing when the target already holds focus, and accepts containers', async () => {
    const { app, driver } = setup();
    expect(await app.focus.pressUntil(Key.DOWN, app.getByTestId('menu_home'))).toBe(0);
    expect(await app.focus.pressUntil(Key.DOWN, app.getByTestId('side_menu'))).toBe(0);
    expect(await app.focus.pressUntil(Key.RIGHT, app.getByTestId('rail_trending'))).toBe(1);
    expect(driver.presses).toHaveLength(1);
  });

  it('reaches items of a virtualized list that do not exist yet', async () => {
    const row = virtualRow(30);
    const { app, driver } = setup({ screen: row.screen });
    row.attach(driver);
    expect(await app.getByTestId('item_20').count()).toBe(0);
    expect(await app.focus.pressUntil(Key.RIGHT, app.getByTestId('item_20'))).toBe(20);
    expect(await app.focus.current().testId()).toBe('item_20');
  });

  it('follows items scrolling under a fixed focus position', async () => {
    const row = virtualRow(10, { fixedSlots: true });
    const { app, driver } = setup({ screen: row.screen });
    row.attach(driver);
    expect(await app.focus.pressUntil(Key.RIGHT, app.getByTestId('item_7'))).toBe(7);
    expect(await app.focus.current().testId()).toBe('item_7');
  });

  it('works with the SDK connected (idle accelerates every press)', async () => {
    const { app, host } = setup({ sdk: true });
    await app.launch();
    expect(await app.focus.pressUntil(Key.RIGHT, app.getByTestId('trending_2'))).toBe(2);
    expect(host!.session!.requests.some((r) => r.method === 'sync.waitForIdle')).toBe(true);
  });

  it('fails fast when a press does not move focus', async () => {
    const { app } = setup();
    const err = (await app.focus
      .pressUntil(Key.UP, app.getByTestId('trending_1'))
      .catch((e: unknown) => e)) as ToetsError;
    expect(err.code).toBe('FOCUS_STUCK');
    expect(err.message).toBe(
      'Pressed UP once toward getByTestId(\'trending_1\'): focus stayed on menu_home "Home" for 30ms after the last press. Path: menu_home "Home".',
    );
    expect(err.hint).toContain('Focus cannot move UP from here');
  });

  it('fails fast when focus comes back to an element it left', async () => {
    const { app } = setup({
      screen: {
        initialFocus: 'a',
        root: {
          children: [
            box('a', 0, 0),
            box('b', 120, 0),
            box('c', 240, 0, { neighbors: { right: 'a' } }),
            box('d', 0, 200),
          ],
        },
      },
    });
    const err = (await app.focus
      .pressUntil(Key.RIGHT, app.getByTestId('d'))
      .catch((e: unknown) => e)) as ToetsError;
    expect(err.code).toBe('FOCUS_LOOP');
    expect(err.message).toBe(
      "Pressed RIGHT 3 times toward getByTestId('d'): focus came back to a, so RIGHT cycles without reaching the target. Path: a → b → c → a.",
    );
  });

  it('honors maxPresses and keeps the path short', async () => {
    const row = virtualRow(30);
    const { app, driver } = setup({ screen: row.screen });
    row.attach(driver);
    const err = (await app.focus
      .pressUntil(Key.RIGHT, app.getByTestId('item_25'), { maxPresses: 12 })
      .catch((e: unknown) => e)) as ToetsError;
    expect(err.code).toBe('FOCUS_UNREACHABLE');
    expect(err.message).toMatch(
      /^Pressed RIGHT 12 times toward getByTestId\('item_25'\) and gave up after maxPresses \(12\)\. Path: … → item_3 "Item 3" → .* → item_12 "Item 12"\.$/,
    );
  });

  it('fails when focus leaves the app', async () => {
    const { app } = setup({
      screen: {
        initialFocus: 'a',
        root: { children: [box('a', 0, 0, { neighbors: { right: 'gone' } }), box('b', 300, 0)] },
      },
    });
    await expect(app.focus.pressUntil(Key.RIGHT, app.getByTestId('b'))).rejects.toMatchObject({
      code: 'NO_FOCUS',
    });
  });

  it('rejects ambiguous targets, non-direction keys and bad maxPresses', async () => {
    const { app } = setup();
    await expect(
      app.focus.pressUntil(Key.RIGHT, app.getByText(/^Trending \d$/)),
    ).rejects.toMatchObject({ code: 'STRICT_MODE_VIOLATION' });
    await expect(
      app.focus.pressUntil(Key.SELECT as DirectionKey, app.getByTestId('trending_1')),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      app.focus.pressUntil(Key.RIGHT, app.getByTestId('trending_1'), { maxPresses: 0 }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('focus.waitForChange', () => {
  it('resolves when focus moves and fails with a hint when it does not', async () => {
    const { app } = setup();
    await app.focus.waitForChange(() => app.remote.press(Key.DOWN));
    await expect(app.focus.waitForChange(async () => {})).rejects.toMatchObject({
      code: 'FOCUS_UNCHANGED',
      message: 'Focus stayed on menu_settings "Settings" for 300ms after the action.',
    });
  });
});
