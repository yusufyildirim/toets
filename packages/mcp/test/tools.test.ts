import { AppRuntime, locatorMatchers } from '@toets/core';
import { FakeMockServer, FakeSdkHost } from '@toets/core/testing';
import { describe, expect, it } from 'vitest';
import { SERVER_INSTRUCTIONS } from '../src/server.js';
import { connect } from './helpers.js';

const HOME_SNAPSHOT = [
  '- app:',
  '  - menu:',
  '    - menu_home "Home"',
  '    - menu_settings "Settings"',
  '  - text "Welcome back"',
  '  - rail_popular:',
  '    - card_1 "Movie 1" [focused]',
  '    - card_2 "Movie 2"',
  '    - card_3 "Movie 3"',
  '  - rail_new:',
  '    - new_1 "New 1"',
  '    - new_2 "New 2"',
].join('\n');

/** A matcher message up to its call log (attempt counts and durations vary between runs). */
const stable = (message: string) => message.slice(0, message.indexOf('Call log:')).trimEnd();

describe('toets MCP tools over FakeDriver', () => {
  it('lists every tool with a description and sends instructions', async () => {
    const h = await connect();
    const { tools } = await h.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'assert',
      'capabilities',
      'docs_search',
      'erase',
      'fill',
      'launch',
      'navigate_to',
      'open_deep_link',
      'press',
      'press_until_focused',
      'query',
      'screenshot',
      'snapshot',
      'submit',
      'type',
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

  it('launches black-box and reports focus and the test code', async () => {
    const h = await connect();
    const out = await h.ok('launch');
    expect(out).toContain('Launched on target "web" (web).');
    expect(out).toContain('SDK: off (black-box)');
    expect(out).toContain('Focus: card_1 "Movie 1"');
    expect(out).toContain('Code: await app.launch();');
    expect(h.driver.launched).toBe(true);
  });

  it('snapshots byte for byte like app.snapshot() and locator.snapshot()', async () => {
    const h = await connect();
    await h.ok('launch');
    const app = new AppRuntime({ driver: h.driver }).app;
    const screen = await h.ok('snapshot');
    expect(screen).toBe(HOME_SNAPSHOT);
    expect(screen).toBe(await app.snapshot());
    const subtree = await h.ok('snapshot', { target: { testId: 'rail_new' } });
    expect(subtree).toBe(await app.getByTestId('rail_new').snapshot());
    expect(subtree).toBe(['- rail_new:', '  - new_1 "New 1"', '  - new_2 "New 2"'].join('\n'));
  });

  it('presses keys, reports focus and the test code', async () => {
    const h = await connect();
    await h.ok('launch');
    const out = await h.ok('press', { keys: ['RIGHT', 'RIGHT'] });
    expect(out).toContain('Focus: card_3 "Movie 3"');
    expect(out).toContain('Code: await app.remote.repeat(Key.RIGHT, 2);');
    expect(h.driver.presses.map((p) => p.key)).toEqual(['RIGHT', 'RIGHT']);

    const seq = await h.ok('press', { keys: ['DOWN', 'LEFT'], snapshot: true });
    expect(seq).toContain('Code: await app.remote.sequence([Key.DOWN, Key.LEFT]);');
    expect(seq).toContain('[focused]');
  });

  it('says when a D-pad press does not move focus', async () => {
    const h = await connect();
    await h.ok('launch');
    expect(await h.ok('press', { keys: ['UP'] })).toContain('Focus did not move');
  });

  it('refuses keys the target lacks before pressing anything', async () => {
    const h = await connect({ capabilities: [] });
    await h.ok('launch');
    const out = await h.err('press', { keys: ['RIGHT', 'PLAY_PAUSE'] });
    expect(out).toContain('KEY_UNSUPPORTED');
    expect(out).toContain('PLAY_PAUSE');
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

  it('applies key overrides from the config, like tests', async () => {
    const h = await connect({
      target: () => ({ toets: { keyOverrides: { FAST_FORWARD: { as: 'RIGHT', holdMs: 800 } } } }),
    });
    const caps = await h.ok('capabilities');
    expect(caps).toMatch(/Keys: .*FAST_FORWARD/);
    expect(caps).toContain('FAST_FORWARD = hold RIGHT 800ms');
    await h.ok('launch');
    const out = await h.ok('press', { keys: ['FAST_FORWARD'] });
    expect(out).toContain('Code: await app.remote.press(Key.FAST_FORWARD);');
    expect(h.driver.presses).toEqual([{ key: 'RIGHT', opts: { holdMs: 800 } }]);
  });

  it('rejects invalid input', async () => {
    const h = await connect();
    await h.ok('launch');
    expect(await h.err('press', { keys: ['ENTER'] })).toMatch(/keys/);
    expect(await h.err('query', { target: {} })).toContain('Give `testId` and/or `text`');
  });

  it('queries elements and suggests locators', async () => {
    const h = await connect();
    await h.ok('launch');
    const many = await h.ok('query', { target: { text: 'movie' } });
    expect(many).toContain("4 matches for app.getByText('movie')");
    expect(many).toContain('[0] card_1 "Movie 1" [focused]  (bounds 300,100 200x120)');
    expect(many).toContain('[3] card_9 "Movie 9" [offscreen]  (bounds 2000,100 200x120)');

    const one = await h.ok('query', { target: { text: 'Movie 2', exact: true } });
    expect(one).toContain("app.getByTestId('card_2')");
    expect(await h.ok('query', { target: { testId: 'nope' } })).toContain('No element matches');
  });

  it('asserts like a test, retrying until the condition holds', async () => {
    const h = await connect();
    await h.ok('launch');
    expect(await h.ok('assert', { target: { testId: 'card_1' }, matcher: 'toBeFocused' })).toMatch(
      /^PASS in \d+ms: await expect\(app\.getByTestId\('card_1'\)\)\.toBeFocused\(\);$/,
    );

    setTimeout(() => h.driver.focus('card_3'), 150);
    expect(
      await h.ok('assert', {
        target: { testId: 'card_3' },
        matcher: 'toBeFocused',
        timeoutMs: 2000,
      }),
    ).toContain("await expect(app.getByTestId('card_3')).toBeFocused({ timeout: 2000 });");

    const fail = await h.err('assert', {
      target: { testId: 'card_1' },
      matcher: 'toBeFocused',
      timeoutMs: 100,
    });
    expect(fail).toMatch(/^FAIL after \d+ms: /);
    expect(fail).toContain('expect(locator).toBeFocused() failed');
    expect(fail).toContain('Received: not focused');
    expect(fail).toContain('Focused:  card_3 "Movie 3"');

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
      await h.ok('assert', { target: { text: 'movie' }, matcher: 'toHaveCount', count: 4 }),
    ).toContain("await expect(app.getByText('movie')).toHaveCount(4);");
  });

  it('fails exactly like expect, with the same message', async () => {
    const h = await connect();
    await h.ok('launch');
    const runtime = new AppRuntime({ driver: h.driver });
    const ctx = { isNot: false, timeoutMs: 100 };
    const viaExpect = await locatorMatchers.toBeFocused(ctx, runtime.app.getByTestId('card_2'));
    expect(viaExpect.pass).toBe(false);
    const viaMcp = await h.err('assert', {
      target: { testId: 'card_2' },
      matcher: 'toBeFocused',
      timeoutMs: 100,
    });
    expect(viaMcp).toContain(stable(viaExpect.message()));

    // `.not` that holds in a test passes here; `.not` that fails in a test fails here.
    expect(
      await h.ok('assert', { target: { testId: 'card_2' }, matcher: 'toBeFocused', not: true }),
    ).toContain('PASS');
    expect(
      await h.err('assert', {
        target: { testId: 'card_1' },
        matcher: 'toBeFocused',
        not: true,
        timeoutMs: 0,
      }),
    ).toContain('FAIL');
  });

  it('validates matcher arguments', async () => {
    const h = await connect();
    await h.ok('launch');
    expect(
      await h.err('assert', { target: { testId: 'card_2' }, matcher: 'toHaveText' }),
    ).toContain('toHaveText needs `expected`');
    expect(await h.err('assert', { matcher: 'toBeVisible' })).toContain('needs `target`');
    expect(
      await h.err('assert', { target: { testId: 'card_2' }, matcher: 'toBeVisible', count: 1 }),
    ).toContain('toBeVisible does not take `count`');
    expect(await h.err('assert', { matcher: 'toHaveMediaState', expected: 'dancing' })).toContain(
      'Unknown media state',
    );
    expect(await h.err('assert', { target: { text: 'movie' }, matcher: 'toBeVisible' })).toContain(
      'STRICT_MODE_VIOLATION',
    );
  });

  it('round-trips text snapshots in the test format', async () => {
    const h = await connect();
    await h.ok('launch');
    const yaml = await h.ok('snapshot', { target: { testId: 'rail_new' } });
    const pass = await h.ok('assert', {
      matcher: 'toMatchTextSnapshot',
      target: { testId: 'rail_new' },
      expected: yaml,
    });
    expect(pass).toContain(
      [
        "await expect(app.getByTestId('rail_new')).toMatchTextSnapshot(`",
        '  - rail_new:',
        '    - new_1 "New 1"',
        '    - new_2 "New 2"',
        '`);',
      ].join('\n'),
    );
    await h.ok('press', { keys: ['DOWN'] });
    const fail = await h.err('assert', {
      matcher: 'toMatchTextSnapshot',
      target: { testId: 'rail_new' },
      expected: yaml,
      timeoutMs: 0,
    });
    expect(fail).toContain('FAIL');
    expect(fail).toContain('[focused]');
    expect(
      await h.ok('assert', { matcher: 'toMatchTextSnapshot', expected: await h.ok('snapshot') }),
    ).toContain('await expect(app).toMatchTextSnapshot(`');
  });

  it('navigates with core navigateTo and reports the path', async () => {
    const h = await connect();
    await h.ok('launch');
    const out = await h.ok('navigate_to', { target: { testId: 'new_2' } });
    expect(out).toMatch(/Focused after \d+ press(es)?: [a-z, ]+\./);
    expect(out).toContain('Focus: new_2 "New 2"');
    expect(out).toContain("Code: await app.focus.navigateTo(app.getByTestId('new_2'));");
    expect((await h.driver.focused())?.testId).toBe('new_2');

    expect(await h.ok('navigate_to', { target: { testId: 'rail_new' } })).toContain(
      'Already focused',
    );
    const menu = await h.ok('navigate_to', { target: { text: 'Settings' }, maxPresses: 20 });
    expect(menu).toContain('Focus: menu_settings "Settings"');
    expect(menu).toContain(
      "Code: await app.focus.navigateTo(app.getByText('Settings'), { maxPresses: 20 });",
    );
  });

  it('presses one direction with core pressUntilFocused and reports the presses', async () => {
    const h = await connect();
    await h.ok('launch');
    const start = (await h.driver.focused())?.testId;
    expect(
      await h.ok('press_until_focused', { key: 'RIGHT', target: { testId: start } }),
    ).toContain('Already focused');
    const out = await h.ok('press_until_focused', { key: 'RIGHT', target: { testId: 'card_3' } });
    expect(out).toMatch(/Focused after \d+ RIGHT press(es)?\./);
    expect(out).toContain('Focus: card_3 "Movie 3"');
    expect(out).toContain(
      "Code: await app.focus.pressUntilFocused(Key.RIGHT, app.getByTestId('card_3'));",
    );
    const stuck = await h.err('press_until_focused', {
      key: 'UP',
      target: { testId: 'card_1' },
      maxPresses: 5,
    });
    expect(stuck).toContain('FOCUS_STUCK');
    expect(
      await h.err('press_until_focused', { key: 'SELECT', target: { testId: 'card_1' } }),
    ).toContain('key');
  });

  it('explains unreachable and missing navigation targets', async () => {
    const h = await connect();
    await h.ok('launch');
    const box = (x: number) => ({ x, y: 0, width: 100, height: 100 });
    const walled = { up: null, down: null, left: null, right: null };
    h.driver.setScreen({
      initialFocus: 'a',
      root: {
        children: [
          { id: 'a', testId: 'a', focusable: true, bounds: box(0), neighbors: walled },
          { id: 'b', testId: 'b', focusable: true, bounds: box(300) },
          { testId: 'island', bounds: box(600) },
        ],
      },
    });
    expect(await h.err('navigate_to', { target: { testId: 'b' } })).toContain('FOCUS_UNREACHABLE');
    expect(await h.err('navigate_to', { target: { testId: 'island' } })).toContain(
      'FOCUS_UNREACHABLE',
    );
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
        '- details:',
        '  - details_title "Movie 2"',
        '  - play "Play" [focused]',
        '  - trailer "Trailer" [disabled]',
      ].join('\n'),
    );
    await h.ok('press', { keys: ['BACK'] });
    expect(
      await h.ok('assert', { target: { testId: 'rail_popular' }, matcher: 'toBeVisible' }),
    ).toContain('PASS');
  });

  it('returns screen and element screenshots as PNG image content', async () => {
    const h = await connect();
    await h.ok('launch');
    for (const args of [{}, { target: { testId: 'card_1' } }]) {
      const result = await h.call('screenshot', args);
      expect(result.isError).toBeFalsy();
      expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    }
  });

  it('describes capabilities and keys without launching', async () => {
    const h = await connect();
    const out = await h.ok('capabilities');
    expect(out).toContain('key.back');
    expect(out).toContain('SDK: off (black-box)');
    expect(out).toMatch(/Keys: UP DOWN LEFT RIGHT SELECT BACK\b/);
  });

  it('refuses state launches without the SDK', async () => {
    const h = await connect();
    const out = await h.err('launch', { state: 'home' });
    expect(out).toContain('CAPABILITY_MISSING');
    expect(out).toContain('app.state');
  });

  it('starts an SDK host and launches into states with flags', async () => {
    let host: FakeSdkHost | undefined;
    const h = await connect({
      target: (driver) => ({
        toets: { sdk: { createHost: async () => (host = new FakeSdkHost(driver())) } },
      }),
    });
    expect(await h.ok('capabilities')).toContain('SDK: enabled, not connected');

    const out = await h.ok('launch', { state: 'details', flags: { kids: true, variant: 'b' } });
    expect(out).toContain('SDK: connected (@toets/fake-sdk@0.0.0');
    expect(out).toContain(
      "Code: await app.launch({ state: 'details', flags: { kids: true, variant: 'b' } });",
    );
    expect(h.driver.launches[0]?.payload).toMatchObject({
      sdkUrl: 'ws://localhost:9323',
      token: 'token-1',
      state: 'details',
      flags: { kids: true, variant: 'b' },
    });

    host!.session!.media = { id: 'm', state: 'playing', position: 12, duration: 60, rate: 1 };
    expect(await h.ok('assert', { matcher: 'toBePlaying' })).toContain(
      'await expect(app.media).toBePlaying();',
    );
    expect(
      await h.ok('assert', { matcher: 'toHavePosition', seconds: 11, tolerance: 2 }),
    ).toContain('await expect(app.media).toHavePosition(11, { tolerance: 2 });');
    expect(await h.err('assert', { matcher: 'toBePaused', timeoutMs: 0 })).toContain(
      'Received: playing at 12.0s / 60.0s',
    );

    await h.dispose();
    expect(host!.closedHost).toBe(true);
  });

  it('needs the SDK for media assertions', async () => {
    const h = await connect();
    await h.ok('launch');
    expect(await h.err('assert', { matcher: 'toBePlaying' })).toContain('CAPABILITY_MISSING');
  });

  it('runs the mock server and asserts requests like a test', async () => {
    let mock: FakeMockServer | undefined;
    const h = await connect({
      target: () => ({
        toets: { mock: { createServer: async () => (mock = new FakeMockServer()) } },
      }),
    });
    await h.ok('launch');
    expect(h.driver.launches[0]?.payload).toMatchObject({ mockUrl: 'http://localhost:9400' });
    mock!.record({ url: 'http://localhost:9400/api/home' });
    expect(
      await h.ok('assert', {
        matcher: 'toHaveRequested',
        request: { method: 'GET', url: '/api/home' },
        times: 1,
      }),
    ).toContain(
      "await expect(app.network).toHaveRequested({ method: 'GET', url: '/api/home' }, { times: 1 });",
    );
    // Each launch starts clean, like a test.
    await h.ok('launch');
    expect(
      await h.err('assert', {
        matcher: 'toHaveRequested',
        request: { url: '/api/home' },
        timeoutMs: 0,
      }),
    ).toContain('FAIL');
    await h.dispose();
    expect(mock!.closed).toBe(true);
  });

  it('serializes concurrent tool calls', async () => {
    const h = await connect();
    await h.ok('launch');
    const results = await Promise.all([
      h.ok('press', { keys: ['RIGHT'] }),
      h.ok('press', { keys: ['RIGHT'] }),
      h.ok('snapshot'),
    ]);
    expect(results[1]).toContain('Focus: card_3');
    expect(results[2]).toContain('card_3 "Movie 3" [focused]');
  });

  it('guides the agent when no config exists', async () => {
    const h = await connect({ config: null });
    const out = await h.err('launch');
    expect(out).toContain('MCP_NO_CONFIG');
    expect(out).toContain('playwright.config.ts');
  });
});
