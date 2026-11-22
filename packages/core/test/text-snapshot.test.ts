import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { normalizeTextSnapshot, renderTextSnapshot } from '../src/index.js';
import { FakeDriver } from '../src/testing/index.js';
import { homeScreen } from './fixtures.js';

describe('text snapshots', () => {
  it('render the visible, in-viewport screen with focus and hoisted wrappers', async () => {
    const driver = new FakeDriver(homeScreen());
    expect(renderTextSnapshot(await driver.tree())).toBe(
      [
        '- side_menu:',
        '  - menu_home "Home" [focused]',
        '  - menu_settings "Settings"',
        '- rail_trending:',
        '  - text "Trending"',
        '  - trending_1 "Trending 1"',
        '  - trending_2 "Trending 2"',
        '  - trending_3 "Trending 3"',
        '  - trending_4 "Trending 4"',
        '  - trending_5 "Trending 5"',
        '- rail_new:',
        '  - text "New"',
        '  - new_1 "New 1"',
        '  - new_2 "New 2"',
        '  - new_3 "New 3"',
      ].join('\n'),
    );
  });

  it('show states, quote unsafe entries and stay valid YAML', async () => {
    const bounds = { x: 0, y: 0, width: 5, height: 5 };
    const driver = new FakeDriver({
      initialFocus: 'x',
      root: {
        children: [
          {
            id: 'x',
            testId: '#weird',
            text: 'Season 1: Pilot',
            focusable: true,
            selected: true,
            bounds,
          },
          { testId: 'off', enabled: false, focusable: true, bounds },
          { children: [{ busy: true, bounds }] },
          { text: 'It\'s "quoted"', bounds },
        ],
      },
    });
    const snap = renderTextSnapshot(await driver.tree());
    expect(snap).toBe(
      [
        `- '#weird "Season 1: Pilot" [focused, selected]'`,
        '- off [disabled]',
        '- element [busy]',
        `- text "It's \\"quoted\\""`,
      ].join('\n'),
    );
    expect(parse(snap)).toEqual([
      '#weird "Season 1: Pilot" [focused, selected]',
      'off [disabled]',
      'element [busy]',
      'text "It\'s \\"quoted\\""',
    ]);
    expect(parse(renderTextSnapshot(await new FakeDriver(homeScreen()).tree()))).toBeInstanceOf(
      Array,
    );
  });

  it('render an empty screen as an empty list', async () => {
    expect(renderTextSnapshot(await new FakeDriver({ root: {} }).tree())).toBe('[]');
  });

  it('normalize indentation and blank edges', () => {
    expect(normalizeTextSnapshot('\n    - a:\n      - b  \n\n')).toBe('- a:\n  - b');
  });
});
