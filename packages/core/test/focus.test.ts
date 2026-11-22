import { describe, expect, it } from 'vitest';
import { DpadError, Key, type ActionInfo } from '../src/index.js';
import { rankDirections, nextStepInGraph } from '../src/runtime/focus.js';
import { setup } from './fixtures.js';

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

describe('nextStepInGraph', () => {
  it('returns the first step of a shortest path', () => {
    const graph = [
      { id: 'a', right: 'b', down: 'c' },
      { id: 'b', down: 'd' },
      { id: 'c', left: 'a' },
      { id: 'd' },
    ];
    expect(nextStepInGraph(graph, 'a', new Set(['d']))).toBe('right');
    expect(nextStepInGraph(graph, 'a', new Set(['c']))).toBe('down');
    expect(nextStepInGraph(graph, 'd', new Set(['a']))).toBeNull();
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
      .catch((e: unknown) => e)) as DpadError;
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

  it('refuses targets with nothing focusable', async () => {
    const { app } = setup();
    await expect(
      app.focus.navigateTo(app.getByText('Trending', { exact: true })),
    ).rejects.toMatchObject({
      code: 'TARGET_NOT_FOCUSABLE',
    });
  });

  it('follows the SDK focus graph when available', async () => {
    const { app, host } = setup({ sdk: true });
    await app.launch();
    const graphRequests = () =>
      host!.session!.requests.filter((r) => r.method === 'focus.graph').length;
    await app.focus.navigateTo(app.getByTestId('trending_2'));
    expect(graphRequests()).toBeGreaterThan(0);
    expect(await app.focus.current().testId()).toBe('trending_2');
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
