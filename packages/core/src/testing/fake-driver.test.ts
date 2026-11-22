import { describe, expect, it } from 'vitest';
import { Key } from '../keys.js';
import { FakeDriver } from './fake-driver.js';

const screen = {
  initialFocus: 'a',
  root: {
    testId: 'rail',
    children: [
      {
        id: 'a',
        testId: 'card-a',
        text: 'Alpha',
        focusable: true,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      },
      {
        id: 'b',
        testId: 'card-b',
        text: 'Beta',
        focusable: true,
        bounds: { x: 120, y: 0, width: 100, height: 100 },
      },
    ],
  },
};

describe('FakeDriver', () => {
  it('moves focus by geometry and queries by chain', async () => {
    const d = new FakeDriver(screen);
    expect((await d.focused())?.testId).toBe('card-a');
    await d.press(Key.RIGHT);
    expect((await d.focused())?.testId).toBe('card-b');
    const [rail] = await d.query([{ kind: 'testId', value: 'rail' }]);
    expect(rail?.focusWithin).toBe(true);
    expect((await d.query([{ kind: 'text', value: 'beta' }])).map((s) => s.testId)).toEqual([
      'card-b',
    ]);
  });
});
