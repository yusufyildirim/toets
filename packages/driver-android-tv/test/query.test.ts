import type { SelectorChain } from '@dpad-tv/core';
import { FakeDriver, type FakeScreen } from '@dpad-tv/core/testing';
import { describe, expect, it } from 'vitest';
import { queryTree } from '../src/query.js';

/**
 * Parity check: `queryTree` over a snapshot tree must answer exactly like `FakeDriver`, the
 * reference implementation of the selector semantics every driver shares.
 */
const screen: FakeScreen = {
  initialFocus: 'card_1',
  root: {
    id: 'root',
    children: [
      {
        testId: 'menu',
        children: [
          { testId: 'menu_home', text: 'Home', focusable: true },
          { testId: 'menu_settings', text: 'Settings', focusable: true },
        ],
      },
      {
        testId: 'rail',
        children: [
          { id: 'card_0', testId: 'card', text: 'Item 0', focusable: true },
          { id: 'card_1', testId: 'card', text: 'Item 1', focusable: true },
          {
            id: 'card_2',
            testId: 'card',
            focusable: true,
            children: [{ testId: 'title', text: 'Item 2' }, { text: 'Comedy' }],
          },
        ],
      },
      { testId: 'footer', text: 'item' },
    ],
  },
};

const chains: Record<string, SelectorChain> = {
  testId: [{ kind: 'testId', value: 'card' }],
  missing: [{ kind: 'testId', value: 'nope' }],
  nth: [
    { kind: 'testId', value: 'card' },
    { kind: 'nth', index: 2 },
  ],
  nthOutOfRange: [
    { kind: 'testId', value: 'card' },
    { kind: 'nth', index: 7 },
  ],
  textSubstring: [{ kind: 'text', value: 'item' }],
  textExact: [{ kind: 'text', value: 'Item 2', exact: true }],
  textExactCase: [{ kind: 'text', value: 'item 2', exact: true }],
  textRegex: [{ kind: 'text', value: /^Item \d$/ }],
  textDeepest: [{ kind: 'text', value: 'Comedy' }],
  textAcrossChildren: [{ kind: 'text', value: 'Item 2 Comedy' }],
  scoped: [
    { kind: 'testId', value: 'rail' },
    { kind: 'text', value: 'item' },
  ],
  scopedNth: [
    { kind: 'testId', value: 'rail' },
    { kind: 'testId', value: 'card' },
    { kind: 'nth', index: 0 },
  ],
  focused: [{ kind: 'focused' }],
  focusedInScope: [{ kind: 'testId', value: 'rail' }, { kind: 'focused' }],
  focusedOutOfScope: [{ kind: 'testId', value: 'menu' }, { kind: 'focused' }],
  emptyChain: [],
};

describe('queryTree parity with FakeDriver', () => {
  for (const [name, chain] of Object.entries(chains)) {
    it(name, async () => {
      const fake = new FakeDriver(screen);
      const expected = (await fake.query(chain)).map((s) => s.ref);
      const actual = queryTree((await fake.tree()).root, chain).map((s) => s.ref);
      expect(actual).toEqual(expected);
    });
  }

  it('is not affected by the lastIndex of global regexes', async () => {
    // FakeDriver reuses `RegExp.test` state here and skips matches; queryTree must not.
    const fake = new FakeDriver(screen);
    const chain: SelectorChain = [{ kind: 'text', value: /Item/g }];
    const root = (await fake.tree()).root;
    expect(queryTree(root, chain).map((s) => s.ref)).toEqual(['card_0', 'card_1', 'title']);
    expect(queryTree(root, chain).map((s) => s.ref)).toEqual(['card_0', 'card_1', 'title']);
  });

  it('returns plain snapshots in document order', async () => {
    const fake = new FakeDriver(screen);
    const result = queryTree((await fake.tree()).root, chains.textRegex!);
    expect(result.map((s) => s.ref)).toEqual(['card_0', 'card_1', 'title']);
    for (const s of result) expect(s).not.toHaveProperty('children');
  });
});
