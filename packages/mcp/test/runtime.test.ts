import type { UINode } from '@dpad-tv/core';
import { FakeDriver } from '@dpad-tv/core/testing';
import { describe, expect, it } from 'vitest';
import { rankDirections } from '../src/runtime/navigate.js';
import { DriverRuntime } from '../src/runtime/runtime.js';
import { targetToCode } from '../src/runtime/target.js';
import { renderTextSnapshot } from '../src/runtime/text-snapshot.js';

const box = (x: number, y: number) => ({ x, y, width: 100, height: 100 });

describe('navigateTo (local)', () => {
  it('ranks directions by the larger gap and treats overlap as neutral', () => {
    expect(rankDirections(box(0, 0), box(500, 120))).toEqual(['right', 'down']);
    expect(rankDirections(box(0, 0), box(0, 400))).toEqual(['down', 'right', 'left']);
    expect(rankDirections(box(300, 300), box(0, 0))).toEqual(['left', 'up']);
  });

  it('detours around a blocked direction', async () => {
    const driver = new FakeDriver({
      initialFocus: 'a',
      root: {
        children: [
          { id: 'a', testId: 'a', focusable: true, bounds: box(0, 0), neighbors: { right: 'a' } },
          { id: 'b', testId: 'b', focusable: true, bounds: box(0, 200) },
          { id: 'd', testId: 'd', focusable: true, bounds: box(400, 200) },
          { id: 'c', testId: 'c', focusable: true, bounds: box(400, 0) },
        ],
      },
    });
    const result = await new DriverRuntime(driver).navigateTo({ testId: 'c' }, { maxPresses: 20 });
    expect(result.path).toEqual(['down', 'right', 'up']);
    expect(result.presses).toBe(4);
    expect(result.focused.testId).toBe('c');
  });

  it('stops at the press budget', async () => {
    const row = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      testId: `c${i}`,
      focusable: true,
      bounds: box(i * 120, 0),
    }));
    const driver = new FakeDriver({ initialFocus: 'c0', root: { children: row } });
    await expect(
      new DriverRuntime(driver).navigateTo({ testId: 'c9' }, { maxPresses: 3 }),
    ).rejects.toMatchObject({
      code: 'MCP_UNREACHABLE',
      hint: expect.stringContaining('maxPresses'),
    });
  });
});

describe('text snapshot (local)', () => {
  const node = (over: Partial<UINode>, children: UINode[] = []): UINode => ({
    ref: Math.random().toString() as UINode['ref'],
    testId: null,
    text: null,
    label: null,
    bounds: box(0, 0),
    visible: true,
    inViewport: true,
    focusable: false,
    focused: false,
    focusWithin: false,
    enabled: true,
    selected: false,
    busy: false,
    children,
    ...over,
  });

  it('collapses anonymous wrappers, folds leaf text and quotes odd test IDs', () => {
    const tree = node({}, [
      node({}, [
        node({ testId: 'tab bar', selected: true, busy: true }, [
          node({ focusable: true, label: 'Search' }),
          node({ text: 'Shows' }, [node({ text: 'Shows' })]),
        ]),
      ]),
      node({ text: 'Hidden', visible: false }),
      node({}),
    ]);
    expect(renderTextSnapshot(tree)).toBe(
      [
        '- view [testId="tab bar", selected, busy]:',
        '  - focusable: "Search"',
        '  - text: "Shows"',
      ].join('\n'),
    );
    expect(renderTextSnapshot(node({ visible: false }))).toBe('# nothing visible');
  });
});

describe('targetToCode', () => {
  it('writes the locator a test would use', () => {
    expect(targetToCode({ testId: 'rail', text: "Kid's", exact: true, nth: 0 })).toBe(
      "app.getByTestId('rail').getByText('Kid\\'s', { exact: true }).first()",
    );
  });
});
