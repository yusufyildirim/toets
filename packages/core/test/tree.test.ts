import { describe, expect, it } from 'vitest';
import type { SelectorChain } from '../src/index.js';
import { evaluateChain, matchText, normalizeText, protocolToTree } from '../src/index.js';
import { FakeDriver, type FakeScreen } from '../src/testing/index.js';
import { homeScreen } from './fixtures.js';

describe('matchText', () => {
  it('defaults to case-insensitive substring over normalized text', () => {
    expect(matchText('  Big   Buck Bunny ', 'buck bunny', undefined)).toBe(true);
    expect(matchText('Big Buck Bunny', 'Buck  Bunny', true)).toBe(false);
    expect(matchText('Big Buck Bunny', 'Big Buck Bunny', true)).toBe(true);
    expect(matchText(null, 'x', undefined)).toBe(false);
  });

  it('tests regexes statelessly: lastIndex and the g/y flags have no effect', () => {
    const re = /buck/gi;
    expect(matchText('Big Buck', re, undefined)).toBe(true);
    expect(matchText('Big Buck', re, undefined)).toBe(true);
    const sticky = /Buck/y;
    expect(matchText('Big Buck', sticky, undefined)).toBe(true);
    expect(sticky.lastIndex).toBe(0);
  });

  it('normalizes empty text to null', () => {
    expect(normalizeText('  \n ')).toBeNull();
  });
});

describe('evaluateChain: the selector semantics of every driver and the SDK path', () => {
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
            { id: 'card_0', testId: 'card_0', text: 'Item 0', focusable: true },
            { id: 'card_1', testId: 'card_1', text: 'Item 1', focusable: true },
            {
              id: 'card_2',
              testId: 'card_2',
              focusable: true,
              children: [{ testId: 'title', text: 'Item 2' }, { text: 'Comedy' }],
            },
          ],
        },
        { testId: 'footer', text: 'item' },
      ],
    },
  };
  const cases: [string, SelectorChain, string[]][] = [
    ['testId', [{ kind: 'testId', value: 'card_0' }], ['card_0']],
    ['missing', [{ kind: 'testId', value: 'nope' }], []],
    [
      'substring, case-insensitive, deepest',
      [{ kind: 'text', value: 'item' }],
      ['card_0', 'card_1', 'title', 'footer'],
    ],
    ['exact', [{ kind: 'text', value: 'Item 2', exact: true }], ['title']],
    ['exact is case-sensitive', [{ kind: 'text', value: 'item 2', exact: true }], []],
    ['regex', [{ kind: 'text', value: /^Item \d$/ }], ['card_0', 'card_1', 'title']],
    ['text across children', [{ kind: 'text', value: 'Item 2 Comedy' }], ['card_2']],
    ['deepest only', [{ kind: 'text', value: 'Comedy' }], ['Comedy']],
    [
      'scoped',
      [
        { kind: 'testId', value: 'rail' },
        { kind: 'text', value: 'item' },
      ],
      ['card_0', 'card_1', 'title'],
    ],
    [
      'nth',
      [
        { kind: 'testId', value: 'rail' },
        { kind: 'text', value: 'item' },
        { kind: 'nth', index: 2 },
      ],
      ['title'],
    ],
    [
      'nth out of range',
      [
        { kind: 'text', value: 'item' },
        { kind: 'nth', index: 9 },
      ],
      [],
    ],
    ['focused', [{ kind: 'focused' }], ['card_1']],
    ['focused in scope', [{ kind: 'testId', value: 'rail' }, { kind: 'focused' }], ['card_1']],
    ['focused out of scope', [{ kind: 'testId', value: 'menu' }, { kind: 'focused' }], []],
    [
      'scopes are deduplicated',
      [
        { kind: 'testId', value: 'rail' },
        { kind: 'testId', value: 'card_2' },
        { kind: 'text', value: 'item' },
      ],
      ['title'],
    ],
  ];

  it.each(cases)('%s', async (_name, chain, expected) => {
    const tree = await new FakeDriver(screen).tree();
    const matches = evaluateChain(tree, chain);
    expect(matches.map((m) => m.testId ?? m.text)).toEqual(expected);
    for (const m of matches) expect(m).not.toHaveProperty('children');
  });

  it('is stateless for global and sticky regexes', async () => {
    const tree = await new FakeDriver(screen).tree();
    for (const value of [/Item/g, /Item/y]) {
      const chain: SelectorChain = [{ kind: 'text', value }];
      const first = evaluateChain(tree, chain).map((m) => m.testId);
      expect(first).toEqual(['card_0', 'card_1', 'title']);
      expect(evaluateChain(tree, chain).map((m) => m.testId)).toEqual(first);
      expect(value.lastIndex).toBe(0);
    }
  });

  it('is what FakeDriver.query answers', async () => {
    const driver = new FakeDriver(homeScreen());
    const chain: SelectorChain = [{ kind: 'text', value: 'New 2' }];
    expect((await driver.query(chain)).map((m) => m.testId)).toEqual(['new_2']);
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
