import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { formatFailureDump, Key, screenshotPng, type ActionInfo } from '../src/index.js';
import { FakeMockServer } from '../src/testing/index.js';
import { setup } from './fixtures.js';

const smallScreen = {
  initialFocus: 'a',
  viewport: { width: 40, height: 20 },
  root: {
    children: [
      {
        id: 'a',
        testId: 'a',
        text: 'A',
        focusable: true,
        bounds: { x: 0, y: 0, width: 10, height: 10 },
      },
      {
        id: 'b',
        testId: 'b',
        text: 'B',
        focusable: true,
        bounds: { x: 20, y: 0, width: 10, height: 10 },
      },
    ],
  },
};

describe('launch', () => {
  it('sends a black-box payload without SDK or mock', async () => {
    const { app, driver } = setup();
    await app.launch({ clearData: true });
    expect(driver.launches).toEqual([{ payload: { v: 1 }, clearData: true }]);
  });

  it('issues a token, points the app at the mock server and connects the SDK', async () => {
    const mock = new FakeMockServer();
    const { app, driver, host, runtime } = setup({ sdk: true, runtime: { mock } });
    expect(runtime.declaredCapabilities.has('media.state')).toBe(true);
    expect(app.platform.has('media.state')).toBe(false);
    await app.launch({ state: 'home', flags: { promo: false } });
    expect(driver.launches[0]?.payload).toEqual({
      v: 1,
      sdkUrl: 'ws://localhost:9323',
      token: 'token-1',
      mockUrl: 'http://localhost:9400',
      state: 'home',
      flags: { promo: false },
    });
    expect(host?.session?.hello.token).toBe('token-1');
    expect(app.platform.has('media.state')).toBe(true);
    expect(app.platform.has('network.mock')).toBe(true);
  });

  it('refuses launch states without the SDK', async () => {
    const { app, driver } = setup();
    await expect(app.launch({ state: 'home' })).rejects.toMatchObject({
      code: 'CAPABILITY_MISSING',
    });
    expect(driver.launches).toEqual([]);
  });

  it('explains an SDK that never connects', async () => {
    const { app } = setup({ sdk: { connect: false } });
    const err = await app.launch().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'SDK_NOT_CONNECTED' });
    expect((err as Error).message).toBe(
      'The app did not connect to the dpad SDK host at ws://localhost:9323 within 200ms.',
    );
  });

  it('closes the previous SDK session on relaunch and terminate', async () => {
    const { app, host } = setup({ sdk: true });
    await app.launch();
    await app.launch();
    expect(host?.sessions.map((s) => s.isClosed)).toEqual([true, false]);
    await app.terminate();
    expect(host?.sessions[1]?.isClosed).toBe(true);
  });

  it('reports launch, terminate and reset as steps', async () => {
    const titles: string[] = [];
    const { app } = setup({
      runtime: { hooks: { step: (i: ActionInfo, run) => (titles.push(i.title), run()) } },
    });
    await app.launch({ clearData: true });
    await app.reset();
    await app.terminate();
    expect(titles).toEqual(['launch clearData', 'reset', 'terminate']);
  });
});

describe('SDK composition', () => {
  it('answers queries from the SDK tree and falls back to the driver when it fails', async () => {
    const logs: string[] = [];
    const { app, host, runtime } = setup({ sdk: true, runtime: { log: (m) => logs.push(m) } });
    await app.launch();
    expect(await app.getByTestId('menu_home').text()).toBe('Home');
    expect(host!.session!.requests.some((r) => r.method === 'tree.get')).toBe(true);

    host!.session!.failing.add('tree.get');
    expect(await app.getByTestId('menu_settings').text()).toBe('Settings');
    expect(logs.some((l) => l.includes('SDK tree.get failed'))).toBe(true);
    expect((await runtime.takeLogs()).some((l) => l.source === 'driver')).toBe(true);
  });

  it('waits for idle before each assertion check', async () => {
    const { app, host } = setup({ sdk: true });
    await app.launch();
    await app.getByTestId('menu_home').text();
    const methods = host!.session!.requests.map((r) => r.method);
    expect(methods.indexOf('sync.waitForIdle')).toBeLessThan(methods.indexOf('tree.get', 1));
  });

  it('collects app logs from the SDK', async () => {
    const { app, host, runtime } = setup({ sdk: true });
    await app.launch();
    host!.session!.notify('logs.entry', { level: 'error', message: 'boom', timestamp: 1 });
    expect(await runtime.takeLogs()).toEqual([
      { level: 'error', message: 'boom', timestamp: 1, source: 'app' },
    ]);
  });
});

describe('screenshots', () => {
  it('crops elements and paints masks', async () => {
    const { app } = setup({ screen: smallScreen });
    const full = PNG.sync.read(Buffer.from(screenshotPng(await app.screenshot())));
    expect([full.width, full.height]).toEqual([40, 20]);

    const el = PNG.sync.read(Buffer.from(screenshotPng(await app.getByTestId('b').screenshot())));
    expect([el.width, el.height]).toEqual([10, 10]);

    const masked = PNG.sync.read(
      Buffer.from(screenshotPng(await app.screenshot({ mask: [app.getByTestId('a')] }))),
    );
    expect([...masked.data.subarray(0, 4)]).toEqual([255, 0, 255, 255]);
    expect([...full.data.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
  });

  it('rejects foreign screenshot values', () => {
    expect(() => screenshotPng({} as never)).toThrow('Not a dpad screenshot.');
  });
});

describe('platform', () => {
  it('emits events only with platform.events', async () => {
    const { app } = setup();
    await expect(app.platform.emit('suspend')).rejects.toMatchObject({
      code: 'CAPABILITY_MISSING',
    });
    const ok = setup({ capabilities: ['platform.events'] });
    await ok.app.platform.emit('suspend');
    expect(ok.driver.events).toEqual(['suspend']);
  });

  it('runs platformOnly only on the matching platform', async () => {
    const { app, driver } = setup();
    const seen: unknown[] = [];
    await app.platformOnly('tvos', async (h) => void seen.push(h));
    await app.platformOnly('web', async (h) => void seen.push(h));
    expect(seen).toEqual([driver]);
  });
});

describe('isolation and failure dumps', () => {
  it('isolate terminates, resets mocks and clears state', async () => {
    const mock = new FakeMockServer();
    const { app, driver, runtime } = setup({ runtime: { mock } });
    await app.launch();
    app.network.use('handler');
    mock.record({ url: '/x' });
    await app.remote.press(Key.DOWN);
    await runtime.isolate();
    expect(driver.launched).toBe(false);
    expect(mock.handlers).toEqual([]);
    expect(mock.recorded).toEqual([]);
    expect(runtime.keyLog).toEqual([]);
  });

  it('collects a readable failure dump', async () => {
    const mock = new FakeMockServer();
    const { app, driver, runtime } = setup({
      screen: smallScreen,
      capabilities: ['key.longpress'],
      runtime: { mock, keyOverrides: { FAST_FORWARD: { as: Key.RIGHT, holdMs: 800 } } },
    });
    await app.remote.press(Key.RIGHT);
    await app.remote.press(Key.FAST_FORWARD);
    driver.log('warn', 'slow frame');
    mock.record({ url: 'http://localhost:9400/api/home', timestamp: 0 });
    const dump = await runtime.failureDump();
    expect(dump.screenshot?.length).toBeGreaterThan(0);
    const text = formatFailureDump({
      ...dump,
      logs: dump.logs.map((l) => ({ ...l, timestamp: 0 })),
    });
    expect(text).toBe(
      [
        '# dpad failure dump',
        '',
        '- platform: web',
        '- capabilities: key.longpress, network.mock',
        '- sdk: off (black-box)',
        '- focused: b "B"',
        '- last keys: RIGHT, FAST_FORWARD (override: hold RIGHT 800ms)',
        '',
        '## Screen',
        '',
        '```yaml',
        '- a "A"',
        '- b "B" [focused]',
        '```',
        '',
        '## Logs (last 1)',
        '',
        '- 00:00:00.000 warn [app] slow frame',
        '',
        '## Requests (last 1)',
        '',
        '- 00:00:00.000 GET http://localhost:9400/api/home -> 200 (mocked)',
        '',
      ].join('\n'),
    );
  });

  it('never throws when the driver is broken', async () => {
    const { driver, runtime } = setup();
    driver.tree = async () => {
      throw new Error('session lost');
    };
    driver.focused = driver.tree as never;
    const dump = await runtime.failureDump();
    expect(dump.screen).toBe('unavailable: session lost');
    expect(dump.focused).toBe('unavailable: session lost');
  });
});
