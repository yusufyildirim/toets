/**
 * Selector parity: the web driver evaluates chains in the page for speed, so it must agree with
 * the core's `evaluateChain` (what the SDK path, Appium drivers and FakeDriver use) on every
 * chain, including `nth` on the document scope and the empty chain.
 */
import {
  evaluateChain,
  type ElementSnapshot,
  type Selector,
  type SelectorChain,
} from '@dpad-tv/core';
import { FakeDriver, type FakeScreen } from '@dpad-tv/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWebDriver, type WebDriver } from '../src/index.js';
import { serveFixtures, type FixtureServer } from './server.js';

/** Mirrors `fixtures/parity.html` node for node (the root is `<body>`). */
const PARITY_SCREEN: FakeScreen = {
  initialFocus: 'c2',
  root: {
    id: 'body',
    children: [
      {
        id: 'screen',
        testId: 'screen',
        children: [
          {
            id: 'rail1',
            testId: 'rail',
            children: [
              {
                id: 'c1',
                testId: 'card',
                focusable: true,
                children: [
                  { id: 'c1a', text: 'Alpha' },
                  { id: 'c1b', text: 'One' },
                ],
              },
              {
                id: 'c2',
                testId: 'card',
                focusable: true,
                children: [{ id: 'c2a', text: 'Beta' }],
              },
              {
                id: 'c3',
                testId: 'card',
                focusable: true,
                text: 'Gamma',
                children: [{ id: 'c3a', text: 'Beta' }],
              },
            ],
          },
          {
            id: 'rail2',
            testId: 'rail',
            children: [
              { id: 'c4', testId: 'card', children: [{ id: 'c4a', text: 'Beta Max' }] },
              {
                id: 'inner',
                testId: 'inner',
                children: [{ id: 'c5', testId: 'card', text: 'Delta' }],
              },
            ],
          },
          { id: 'p', text: 'alpha one' },
        ],
      },
    ],
  },
};

const testId = (value: string): Selector => ({ kind: 'testId', value });
const text = (value: string | RegExp, exact?: boolean): Selector =>
  exact === undefined ? { kind: 'text', value } : { kind: 'text', value, exact };
const nth = (index: number): Selector => ({ kind: 'nth', index });
const focused: Selector = { kind: 'focused' };

const CHAINS: readonly SelectorChain[] = [
  [],
  [nth(0)],
  [nth(1)],
  [nth(0), testId('card')],
  [nth(0), nth(0)],
  [testId('screen')],
  [testId('card')],
  [testId('card'), nth(2)],
  [testId('card'), nth(9)],
  [testId('rail'), testId('card')],
  [testId('rail'), nth(1), testId('card')],
  [testId('rail'), testId('card'), nth(0)],
  [testId('screen'), testId('rail'), testId('card')],
  [testId('inner'), testId('card')],
  [testId('card'), testId('card')],
  [testId('nope')],
  [testId('nope'), nth(0)],
  [text('beta')],
  [text('Beta', true)],
  [text('BETA', true)],
  [text('alpha one')],
  [text('  alpha   ONE ')],
  [text('')],
  [text(/^beta/i)],
  [text(/a$/g)],
  [text(/gamma beta/i)],
  [testId('rail'), text('beta')],
  [testId('screen'), testId('rail'), testId('card'), text('beta')],
  [text('beta'), nth(1)],
  [focused],
  [testId('rail'), focused],
  [testId('card'), focused],
  [focused, nth(0)],
];

const signature = (el: ElementSnapshot) => `${el.testId ?? '-'} ${JSON.stringify(el.text)}`;
const describeChain = (chain: SelectorChain) =>
  JSON.stringify(chain, (_k, v: unknown) => (v instanceof RegExp ? String(v) : v));

describe('selector parity with the core', () => {
  let server: FixtureServer;
  let driver: WebDriver;
  const fake = new FakeDriver(PARITY_SCREEN);

  beforeAll(async () => {
    server = await serveFixtures();
    driver = createWebDriver({}, { app: { url: `${server.url}parity.html` } });
    await driver.start();
    await driver.launch({ payload: { v: 1 } });
    await driver.escapeHatch().focus('#c2');
  });

  afterAll(async () => {
    await driver.stop();
    await server.close();
  });

  it('mirrors the fake screen', async () => {
    const tree = await driver.tree();
    const fakeTree = await fake.tree();
    expect(evaluateChain(tree, [text('')]).map(signature)).toEqual(
      evaluateChain(fakeTree, [text('')]).map(signature),
    );
  });

  for (const chain of CHAINS) {
    it(`agrees on ${describeChain(chain)}`, async () => {
      const inPage = await driver.query(chain);
      // Same elements as the core evaluating the driver's own tree...
      const overTree = evaluateChain(await driver.tree(), chain);
      expect(inPage.map((el) => el.ref)).toEqual(overTree.map((el) => el.ref));
      // ...and as FakeDriver (core semantics) on the equivalent screen.
      const viaFake = await fake.query(chain);
      expect(inPage.map(signature)).toEqual(viaFake.map(signature));
    });
  }
});
