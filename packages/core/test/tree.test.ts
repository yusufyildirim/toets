import { describe, expect, it } from 'vitest';
import type { SelectorChain } from '../src/index.js';
import { evaluateChain, matchText, normalizeText, protocolToTree } from '../src/index.js';
import { FakeDriver } from '../src/testing/index.js';
import { homeScreen } from './fixtures.js';

describe('matchText', () => {
  it('defaults to case-insensitive substring over normalized text', () => {
    expect(matchText('  Big   Buck Bunny ', 'buck bunny', undefined)).toBe(true);
    expect(matchText('Big Buck Bunny', 'Buck  Bunny', true)).toBe(false);
    expect(matchText('Big Buck Bunny', 'Big Buck Bunny', true)).toBe(true);
    expect(matchText(null, 'x', undefined)).toBe(false);
  });

  it('tests regexes against normalized text, ignoring the global flag state', () => {
    const re = /buck/gi;
    expect(matchText('Big Buck', re, undefined)).toBe(true);
    expect(matchText('Big Buck', re, undefined)).toBe(true);
  });

  it('normalizes empty text to null', () => {
    expect(normalizeText('  \n ')).toBeNull();
  });
});

describe('evaluateChain', () => {
  const chains: SelectorChain[] = [
    [{ kind: 'testId', value: 'rail_new' }],
    [{ kind: 'text', value: 'trending' }],
    [{ kind: 'text', value: 'Trending', exact: true }],
    [
      { kind: 'testId', value: 'rail_trending' },
      { kind: 'text', value: /^Trending \d$/ },
    ],
    [
      { kind: 'testId', value: 'rail_trending' },
      { kind: 'text', value: 'trending' },
      { kind: 'nth', index: 2 },
    ],
    [{ kind: 'focused' }],
    [{ kind: 'testId', value: 'nope' }],
    [
      { kind: 'testId', value: 'side_menu' },
      { kind: 'testId', value: 'side_menu' },
    ],
  ];

  it.each(
    chains.map((c) => [JSON.stringify(c, (_k, v) => (v instanceof RegExp ? String(v) : v)), c]),
  )('matches FakeDriver.query for %s', async (_name, chain) => {
    const driver = new FakeDriver(homeScreen());
    const fromDriver = await driver.query(chain);
    const fromTree = evaluateChain(await driver.tree(), chain);
    expect(fromTree.map((s) => s.ref)).toEqual(fromDriver.map((s) => s.ref));
  });

  it('returns the deepest text matches, not their ancestors', async () => {
    const driver = new FakeDriver(homeScreen());
    const matches = evaluateChain(await driver.tree(), [{ kind: 'text', value: 'New 2' }]);
    expect(matches.map((m) => m.testId)).toEqual(['new_2']);
  });
});

describe('protocolToTree', () => {
  it('concatenates visible descendant text and propagates focus and busy', () => {
    const tree = protocolToTree({
      id: 'root',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      visible: true,
      focusable: false,
      focused: false,
      enabled: true,
      selected: false,
      busy: false,
      children: [
        {
          id: 'a',
          testId: 'a',
          text: 'Hello',
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          visible: true,
          focusable: true,
          focused: true,
          enabled: true,
          selected: false,
          busy: false,
          children: [],
        },
        {
          id: 'b',
          text: 'Hidden',
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          visible: false,
          focusable: false,
          focused: false,
          enabled: true,
          selected: false,
          busy: true,
          children: [],
        },
        {
          id: 'c',
          text: 'Far',
          bounds: { x: 500, y: 0, width: 10, height: 10 },
          visible: true,
          focusable: false,
          focused: false,
          enabled: true,
          selected: false,
          busy: false,
          children: [],
        },
      ],
    });
    expect(tree.viewport).toEqual({ width: 100, height: 100 });
    expect(tree.root.text).toBe('Hello Far');
    expect(tree.root.focusWithin).toBe(true);
    expect(tree.root.busy).toBe(true);
    expect(tree.root.children[1]?.visible).toBe(false);
    expect(tree.root.children[2]?.inViewport).toBe(false);
  });

  it('agrees with the driver tree for the fake screen', async () => {
    const driver = new FakeDriver(homeScreen());
    const sdk = protocolToTree(driver.protocolTree());
    const chain: SelectorChain = [{ kind: 'testId', value: 'rail_trending' }];
    const [a] = evaluateChain(sdk, chain);
    const [b] = await driver.query(chain);
    expect(a?.text).toBe(b?.text);
    expect(evaluateChain(sdk, [{ kind: 'focused' }])[0]?.testId).toBe('menu_home');
  });
});
