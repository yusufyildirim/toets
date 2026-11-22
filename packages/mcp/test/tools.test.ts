import { describe, expect, it } from 'vitest';
import { SERVER_INSTRUCTIONS } from '../src/server.js';
import { connect } from './helpers.js';

describe('dpad MCP tools over FakeDriver', () => {
  it('lists every tool with a description and sends instructions', async () => {
    const h = await connect();
    const { tools } = await h.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'assert',
      'capabilities',
      'docs_search',
      'launch',
      'navigate_to',
      'press',
      'query',
      'screenshot',
      'snapshot',
    ]);
    for (const tool of tools) expect(tool.description?.length).toBeGreaterThan(80);
    expect(h.client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
  });

  it('requires launch before device tools', async () => {
    const h = await connect();
    for (const tool of ['snapshot', 'press', 'screenshot']) {
      const args = tool === 'press' ? { keys: ['UP'] } : {};
      expect(await h.err(tool, args)).toContain('MCP_NOT_LAUNCHED');
    }
  });

  it('launches and reports focus', async () => {
    const h = await connect();
    const out = await h.ok('launch');
    expect(out).toContain('Launched on target "web" (web).');
    expect(out).toContain('Focus: focusable [testId=card_1, focused]: "Movie 1"');
    expect(h.driver.launched).toBe(true);
  });

  it('snapshots the screen as focus-aware YAML', async () => {
    const h = await connect();
    await h.ok('launch');
    expect(await h.ok('snapshot')).toBe(
      [
        '- view [testId=app, focus-within]:',
        '  - view [testId=menu]:',
        '    - focusable [testId=menu_home]: "Home"',
        '    - focusable [testId=menu_settings]: "Settings"',
        '  - text: "Welcome back"',
        '  - view [testId=rail_popular, focus-within]:',
        '    - focusable [testId=card_1, focused]: "Movie 1"',
        '    - focusable [testId=card_2]: "Movie 2"',
        '    - focusable [testId=card_3]: "Movie 3"',
        '    - focusable [testId=card_9, offscreen]: "Movie 9"',
        '  - view [testId=rail_new]:',
        '    - focusable [testId=new_1]: "New 1"',
        '    - focusable [testId=new_2]: "New 2"',
      ].join('\n'),
    );
    expect(await h.ok('snapshot', { target: { testId: 'rail_new' } })).toBe(
      [
        '- view [testId=rail_new]:',
        '  - focusable [testId=new_1]: "New 1"',
        '  - focusable [testId=new_2]: "New 2"',
      ].join('\n'),
    );
  });

  it('presses keys, reports focus and the test code', async () => {
    const h = await connect();
    await h.ok('launch');
    const out = await h.ok('press', { keys: ['RIGHT', 'RIGHT'] });
    expect(out).toContain('Focus: focusable [testId=card_3, focused]: "Movie 3"');
    expect(out).toContain('Code: await app.remote.repeat(Key.RIGHT, 2);');
    expect(h.driver.presses.map((p) => p.key)).toEqual(['RIGHT', 'RIGHT']);

    const seq = await h.ok('press', { keys: ['DOWN', 'SELECT'], snapshot: true });
    expect(seq).toContain('Code: await app.remote.sequence([Key.DOWN, Key.SELECT]);');
    expect(seq).toContain('- focusable [testId=new_2, focused]: "New 2"');
  });

  it('says when a D-pad press does not move focus', async () => {
    const h = await connect();
    await h.ok('launch');
    expect(await h.ok('press', { keys: ['UP'] })).toContain('Focus did not move');
  });

  it('refuses keys the target lacks, before pressing anything', async () => {
    const h = await connect({ capabilities: [] });
    await h.ok('launch');
    const out = await h.err('press', { keys: ['RIGHT', 'PLAY_PAUSE'] });
    expect(out).toContain('KEY_UNSUPPORTED');
    expect(out).toContain('key.media.toggle');
    expect(out).toContain("requires('key.media.toggle')");
    expect(h.driver.presses).toEqual([]);
    expect(await h.err('press', { keys: ['RIGHT'], holdMs: 500 })).toContain('key.longpress');
  });

  it('passes long presses through', async () => {
    const h = await connect();
    await h.ok('launch');
    const out = await h.ok('press', { keys: ['RIGHT'], holdMs: 800 });
    expect(out).toContain('Code: await app.remote.longPress(Key.RIGHT, 800);');
    expect(h.driver.presses).toEqual([{ key: 'RIGHT', opts: { holdMs: 800 } }]);
  });

  it('rejects invalid input with a schema error', async () => {
    const h = await connect();
    await h.ok('launch');
    expect(await h.err('press', { keys: ['ENTER'] })).toMatch(/keys/);
    expect(await h.err('query', { target: {} })).toContain('Give `testId` and/or `text`');
  });

  it('queries elements and suggests locators', async () => {
    const h = await connect();
    await h.ok('launch');
    const many = await h.ok('query', { target: { text: 'movie' } });
    expect(many).toContain("4 matches for app.getByText('movie'):");
    expect(many).toContain('[1] focusable [testId=card_2]: "Movie 2"  (bounds 520,100 200x120)');
    expect(many).toContain('ambiguous');

    const one = await h.ok('query', { target: { text: 'Movie 2', exact: true } });
    expect(one).toContain("Prefer the test ID: app.getByTestId('card_2')");

    const scoped = await h.ok('query', { target: { testId: 'rail_new', text: 'new', nth: 1 } });
    expect(scoped).toContain(
      "app.getByTestId('rail_new').getByText('new').nth(1) matches exactly one",
    );

    expect(await h.ok('query', { target: { testId: 'nope' } })).toContain('No element matches');
  });

  it('asserts like a test, retrying until the condition holds', async () => {
    const h = await connect();
    await h.ok('launch');
    expect(await h.ok('assert', { target: { testId: 'card_1' }, matcher: 'toBeFocused' })).toMatch(
      /^PASS in \d+ms: await expect\(app.getByTestId\('card_1'\)\).toBeFocused\(\);$/,
    );

    setTimeout(() => h.driver.focus('card_3'), 150);
    expect(
      await h.ok('assert', {
        target: { testId: 'card_3' },
        matcher: 'toBeFocused',
        timeoutMs: 2000,
      }),
    ).toContain('PASS');

    const fail = await h.err('assert', {
      target: { testId: 'card_1' },
      matcher: 'toBeFocused',
      timeoutMs: 100,
    });
    expect(fail).toContain('FAIL after');
    expect(fail).toContain('Received: not focused; focus is on focusable [testId=card_3, focused]');

    expect(
      await h.ok('assert', { target: { text: 'Secret' }, matcher: 'toBeVisible', not: true }),
    ).toContain('.not.toBeVisible();');
    expect(
      await h.ok('assert', {
        target: { testId: 'card_2' },
        matcher: 'toHaveText',
        expected: 'Movie 2',
      }),
    ).toContain("toHaveText('Movie 2')");
    expect(
      await h.err('assert', {
        target: { testId: 'card_2' },
        matcher: 'toContainText',
        expected: 'Series',
        timeoutMs: 0,
      }),
    ).toContain('Received: text "Movie 2"');
    expect(
      await h.err('assert', { target: { testId: 'card_2' }, matcher: 'toHaveText' }),
    ).toContain('MCP_BAD_INPUT');
    expect(await h.err('assert', { target: { text: 'movie' }, matcher: 'toBeVisible' })).toContain(
      'STRICT_MODE_VIOLATION',
    );
  });

  it('navigates focus with real presses and reports the path', async () => {
    const h = await connect();
    await h.ok('launch');
    const out = await h.ok('navigate_to', { target: { testId: 'new_2' } });
    expect(out).toMatch(/Focused after \d+ presses; path: /);
    expect(out).toContain('Focus: focusable [testId=new_2, focused]: "New 2"');
    expect(out).toContain("Code: await app.focus.navigateTo(app.getByTestId('new_2'));");
    expect((await h.driver.focused())?.testId).toBe('new_2');
    expect(h.driver.presses.every((p) => ['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(p.key))).toBe(
      true,
    );

    expect(await h.ok('navigate_to', { target: { testId: 'rail_new' } })).toContain(
      'Already focused',
    );
    const menu = await h.ok('navigate_to', { target: { text: 'Settings' } });
    expect(menu).toContain('menu_settings, focused');
  });

  it('explains unreachable and missing navigation targets', async () => {
    const h = await connect();
    await h.ok('launch');
    h.driver.setScreen({
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
            testId: 'island',
            focusable: false,
            bounds: { x: 500, y: 0, width: 100, height: 100 },
          },
        ],
      },
    });
    const out = await h.err('navigate_to', { target: { testId: 'island' } });
    expect(out).toContain('MCP_UNREACHABLE');
    expect(out).toContain('Focus is stuck on focusable [testId=a, focused]');
    expect(await h.err('navigate_to', { target: { testId: 'ghost' } })).toContain(
      'ELEMENT_NOT_FOUND',
    );
  });

  it('activates with SELECT and sees the new screen', async () => {
    const h = await connect();
    await h.ok('launch');
    await h.ok('navigate_to', { target: { testId: 'card_2' } });
    await h.ok('press', { keys: ['SELECT'] });
    expect(await h.ok('snapshot')).toBe(
      [
        '- view [testId=details, focus-within]:',
        '  - view [testId=details_title]: "Movie 2"',
        '  - focusable [testId=play, focused]: "Play"',
        '  - focusable [testId=trailer, disabled]: "Trailer"',
      ].join('\n'),
    );
    await h.ok('press', { keys: ['BACK'] });
    expect(
      await h.ok('assert', { target: { testId: 'rail_popular' }, matcher: 'toBeVisible' }),
    ).toContain('PASS');
  });

  it('returns screenshots as PNG image content', async () => {
    const h = await connect();
    await h.ok('launch');
    const result = await h.call('screenshot');
    expect(result.isError).toBeFalsy();
    expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(await h.err('screenshot', { target: { testId: 'card_1' } })).toContain(
      'screenshot.element',
    );
  });

  it('describes capabilities and keys without launching', async () => {
    const h = await connect();
    const out = await h.ok('capabilities');
    expect(out).toContain('Target: web (platform web), app not launched');
    expect(out).toContain('Capabilities: key.back, key.longpress');
    expect(out).toMatch(/Keys: UP DOWN LEFT RIGHT SELECT BACK\n/);
    expect(out).toContain('Unsupported keys: HOME MENU');
  });

  it('refuses state launches without app.state', async () => {
    const h = await connect();
    expect(await h.err('launch', { state: 'home' })).toContain('app.state');
  });

  it('serializes concurrent tool calls', async () => {
    const h = await connect();
    await h.ok('launch');
    const results = await Promise.all([
      h.ok('press', { keys: ['RIGHT'] }),
      h.ok('press', { keys: ['RIGHT'] }),
      h.ok('snapshot'),
    ]);
    expect(results[1]).toContain('card_3, focused');
    expect(results[2]).toContain('card_3, focused');
  });

  it('guides the agent when no config exists', async () => {
    const h = await connect({ config: null });
    const out = await h.err('launch');
    expect(out).toContain('MCP_NO_CONFIG');
    expect(out).toContain('dpad.mcp.config.ts');
  });
});
