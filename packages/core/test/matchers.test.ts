import { describe, expect, it } from 'vitest';
import {
  locatorMatchers as m,
  mediaMatchers,
  networkMatchers,
  toMatchTextSnapshot,
  type MatchContext,
} from '../src/index.js';
import { FakeMockServer, FakeSdkHost } from '../src/testing/index.js';
import { setup } from './fixtures.js';

const pos: MatchContext = { isNot: false, timeoutMs: 100 };
const neg: MatchContext = { isNot: true, timeoutMs: 100 };

/** Playwright semantics: the assertion succeeds when pass !== isNot. */
const succeeds = (ctx: MatchContext, r: { pass: boolean }) => r.pass !== ctx.isNot;

describe('locator matchers', () => {
  it('toBeVisible treats a missing element as hidden', async () => {
    const { app } = setup();
    expect(succeeds(pos, await m.toBeVisible(pos, app.getByTestId('menu_home')))).toBe(true);
    expect(succeeds(neg, await m.toBeVisible(neg, app.getByTestId('hidden_banner')))).toBe(true);
    expect(succeeds(neg, await m.toBeVisible(neg, app.getByTestId('missing')))).toBe(true);
    expect(succeeds(pos, await m.toBeVisible(pos, app.getByTestId('missing')))).toBe(false);
  });

  it('toBeInViewport distinguishes offscreen cards', async () => {
    const { app } = setup();
    expect(succeeds(pos, await m.toBeInViewport(pos, app.getByTestId('trending_5')))).toBe(true);
    expect(succeeds(neg, await m.toBeInViewport(neg, app.getByTestId('trending_6')))).toBe(true);
  });

  it('toBeFocused fails both forms for a missing element and explains focus', async () => {
    const { app } = setup();
    const missing = await m.toBeFocused(neg, app.getByTestId('missing'));
    expect(succeeds(neg, missing)).toBe(false);
    const r = await m.toBeFocused(pos, app.getByTestId('menu_settings'));
    expect(succeeds(pos, r)).toBe(false);
    expect(r.message()).toMatch(
      new RegExp(
        [
          'expect\\(locator\\)\\.toBeFocused\\(\\) failed',
          '',
          "Locator:  getByTestId\\('menu_settings'\\)",
          'Expected: focused',
          'Received: not focused',
          'Timeout:  100ms',
          'Idle:     no SDK idle sync; polled',
          'Focused:  menu_home "Home"',
          '',
          'Call log:',
          '  - \\d+ checks over \\d+ms',
        ].join('\\n'),
      ),
    );
  });

  it('waits for the state to arrive', async () => {
    const { app, driver } = setup();
    setTimeout(() => driver.focus('new_1'), 40);
    const r = await m.toBeFocused({ isNot: false, timeoutMs: 1000 }, app.getByTestId('new_1'));
    expect(r.pass).toBe(true);
    const fw = await m.toHaveFocusWithin(pos, app.getByTestId('rail_new'));
    expect(fw.pass).toBe(true);
  });

  it('enabled, disabled, selected, busy', async () => {
    const { app, driver } = setup();
    driver.setScreen({
      root: {
        children: [
          { testId: 'a', enabled: false, bounds: { x: 0, y: 0, width: 10, height: 10 } },
          { testId: 'b', selected: true, children: [{ testId: 'c', busy: true }] },
        ],
      },
    });
    expect((await m.toBeDisabled(pos, app.getByTestId('a'))).pass).toBe(true);
    expect((await m.toBeEnabled(pos, app.getByTestId('a'))).pass).toBe(false);
    expect((await m.toBeSelected(pos, app.getByTestId('b'))).pass).toBe(true);
    expect((await m.toBeBusy(pos, app.getByTestId('b'))).pass).toBe(true);
  });

  it('toHaveText matches the full normalized text; toContainText a substring', async () => {
    const { app } = setup();
    const card = app.getByTestId('new_1');
    expect((await m.toHaveText(pos, card, 'New 1')).pass).toBe(true);
    expect((await m.toHaveText(pos, card, 'New')).pass).toBe(false);
    expect((await m.toHaveText(pos, card, /^new/i)).pass).toBe(true);
    expect((await m.toContainText(pos, card, 'ew')).pass).toBe(true);
    const r = await m.toHaveText(pos, card, 'Old');
    expect(r.message()).toContain('Received: text "New 1"');
  });

  it('toHaveCount counts without strictness', async () => {
    const { app } = setup();
    expect((await m.toHaveCount(pos, app.getByText(/^New \d$/), 3)).pass).toBe(true);
    expect((await m.toHaveCount(neg, app.getByTestId('x'), 1)).pass).toBe(false);
  });

  it('throws strict mode violations instead of retrying', async () => {
    const { app } = setup();
    await expect(m.toBeFocused(pos, app.getByText('trending'))).rejects.toMatchObject({
      code: 'STRICT_MODE_VIOLATION',
    });
  });

  it('rejects non-locator subjects with a hint', async () => {
    await expect(m.toBeFocused(pos, {} as never)).rejects.toMatchObject({
      code: 'INVALID_SUBJECT',
    });
  });
});

describe('toMatchTextSnapshot', () => {
  it('ignores indentation and shows a line diff on mismatch', async () => {
    const { app } = setup();
    const ok = await toMatchTextSnapshot(
      pos,
      app.getByTestId('side_menu'),
      `
        - side_menu:
          - menu_home "Home" [focused]
          - menu_settings "Settings"
      `,
    );
    expect(ok.pass).toBe(true);
    const bad = await toMatchTextSnapshot(
      pos,
      app.getByTestId('side_menu'),
      '- side_menu:\n  - menu_home "Home"',
    );
    expect(bad.pass).toBe(false);
    expect(bad.message()).toContain(
      [
        'Diff (- expected, + received):',
        '  - side_menu:',
        '-   - menu_home "Home"',
        '+   - menu_home "Home" [focused]',
        '+   - menu_settings "Settings"',
      ].join('\n'),
    );
  });
});

describe('media matchers', () => {
  it('need media.state and read the SDK media domain', async () => {
    const { app, driver } = setup();
    await expect(mediaMatchers.toBePlaying(pos, app.media)).rejects.toMatchObject({
      code: 'CAPABILITY_MISSING',
    });

    const host = new FakeSdkHost(driver);
    const sdk = setup({ runtime: { sdkHost: host } });
    await sdk.app.launch();
    const session = host.session!;
    session.media = { id: 'main', state: 'playing', position: 12, duration: 60, rate: 1 };
    expect((await mediaMatchers.toBePlaying(pos, sdk.app.media)).pass).toBe(true);
    expect((await mediaMatchers.toHavePosition(pos, sdk.app.media, 11.5)).pass).toBe(true);
    const r = await mediaMatchers.toBePaused(pos, sdk.app.media);
    expect(r.pass).toBe(false);
    expect(r.message()).toContain('Received: playing at 12.0s / 60.0s');
    session.media = null;
    expect((await mediaMatchers.toHaveMediaState(neg, sdk.app.media, 'playing')).pass).toBe(false);
  });
});

describe('network matchers', () => {
  it('assert recorded requests on the mock server', async () => {
    const mock = new FakeMockServer();
    const { app } = setup({ runtime: { mock } });
    setTimeout(() => mock.record({ url: 'http://localhost:9400/api/home', method: 'GET' }), 30);
    const r = await networkMatchers.toHaveRequested(
      { isNot: false, timeoutMs: 1000 },
      app.network,
      {
        url: '/api/home',
      },
    );
    expect(r.pass).toBe(true);
    const twice = await networkMatchers.toHaveRequested(
      pos,
      app.network,
      { url: '/api/home' },
      { times: 2 },
    );
    expect(twice.pass).toBe(false);
    expect(twice.message()).toContain('  - GET http://localhost:9400/api/home -> 200 (mocked)');
  });

  it('explain how to enable mocking', async () => {
    const { app } = setup();
    await expect(networkMatchers.toHaveRequested(pos, app.network, {})).rejects.toMatchObject({
      code: 'MOCK_DISABLED',
    });
  });
});
