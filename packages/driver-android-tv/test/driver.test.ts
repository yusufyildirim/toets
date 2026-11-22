import { Key, type DpadError, type DriverCreateContext, type ElementRef } from '@dpad-tv/core';
import { encodeLaunchPayloadParam } from '@dpad-tv/protocol';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppiumServer } from '../src/appium.js';
import {
  createAndroidTvDriver,
  DEFAULT_UIA2_SETTINGS,
  payloadPorts,
  type AndroidTvDriver,
  type AppiumSession,
} from '../src/driver.js';
import type { AndroidTvDriverOptions } from '../src/options.js';
import { bootedDevice, FakeRunner } from './fake-runner.js';

const homeXml = readFileSync(join(import.meta.dirname, 'fixtures', 'home.xml'), 'utf8');

class FakeSession implements AppiumSession {
  readonly executed: [string, unknown[]][] = [];
  settings: Record<string, unknown> = {};
  deleted = 0;
  source = homeXml;

  async getPageSource() {
    return this.source;
  }
  async takeScreenshot() {
    const png = new PNG({ width: 1920, height: 1080 });
    for (let i = 0; i < png.data.length; i += 4) {
      const x = (i / 4) % 1920;
      png.data[i] = x < 824 ? 255 : 0; // red left of card_0's right edge
      png.data[i + 3] = 255;
    }
    return PNG.sync.write(png).toString('base64');
  }
  async execute(script: string, ...args: unknown[]) {
    this.executed.push([script, args]);
    return null;
  }
  async updateSettings(settings: Record<string, unknown>) {
    this.settings = { ...this.settings, ...settings };
  }
  async deleteSession() {
    this.deleted++;
  }
}

function setup(
  options: AndroidTvDriverOptions = {},
  app: Record<string, unknown> = {},
  extra: { configDir?: string; meta?: Record<string, unknown> } = {},
) {
  const sdkRoot = mkdtempSync(join(tmpdir(), 'dpad-sdk-'));
  mkdirSync(join(sdkRoot, 'platform-tools'));
  const artifactsDir = mkdtempSync(join(tmpdir(), 'dpad-art-'));
  const runner = bootedDevice(new FakeRunner())
    .on('pm path', 'package:/data/app/base.apk\n')
    .on('pm list packages -U', 'package:tv.dpad.fixture uid:10096\n')
    .on('LEANBACK_LAUNCHER', 'priority=0\ntv.dpad.fixture/.MainActivity\n')
    .on('am start', 'Status: ok\nComplete\n')
    .on('pm clear', 'Success\n')
    .on('app_process', 'repeats=12\n')
    .on(' install ', 'Success\n');
  const session = new FakeSession();
  const servers: { stopped: number; env: NodeJS.ProcessEnv | undefined }[] = [];
  const caps: Record<string, unknown>[] = [];
  const logs: string[] = [];
  const ctx: DriverCreateContext = {
    app: { package: 'tv.dpad.fixture', ...app },
    device: {
      id: 'd',
      platform: 'android-tv',
      address: 'emulator-5554',
      meta: extra.meta ?? {},
      release: async () => {},
    },
    ...(extra.configDir === undefined ? {} : { configDir: extra.configDir }),
    workerIndex: 0,
    artifactsDir,
    log: (m) => logs.push(m),
  };
  const driver = createAndroidTvDriver({ sdkRoot, ...options }, ctx, {
    runner,
    env: { ANDROID_ADB_SERVER_PORT: '5038' },
    startServer: async (opts) => {
      const s = { stopped: 0, env: opts.env };
      servers.push(s);
      const server: AppiumServer = {
        hostname: '127.0.0.1',
        port: 4723,
        stop: async () => {
          s.stopped++;
        },
      };
      return server;
    },
    createSession: async (_server, capabilities) => {
      caps.push(capabilities);
      return session;
    },
  });
  return { driver, runner, session, servers, caps, logs, sdkRoot };
}

const adbShell = (runner: FakeRunner) =>
  runner.calls.filter((c) => c.args[2] === 'shell').map((c) => c.args.slice(3).join(' '));

describe('AndroidTvDriver', () => {
  let t: ReturnType<typeof setup>;
  let driver: AndroidTvDriver;

  beforeEach(async () => {
    t = setup();
    driver = t.driver;
    await driver.start();
  });

  it('declares honest capabilities', () => {
    expect([...driver.capabilities].sort()).toEqual(
      [
        'key.back',
        'key.channel',
        'key.color',
        'key.home',
        'key.info',
        'key.longpress',
        'key.media.discrete',
        'key.media.toggle',
        'key.media.seek',
        'key.media.track',
        'key.menu',
        'key.numeric',
        'logs',
        'screenshot.element',
        'video',
      ].sort(),
    );
    expect(driver.platform).toBe('android-tv');
  });

  it('starts a UiAutomator2 session that never launches the app itself', () => {
    expect(t.caps[0]).toMatchObject({
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:udid': 'emulator-5554',
      'appium:noReset': true,
      'appium:autoLaunch': false,
      'appium:adbPort': 5038,
    });
    expect(typeof t.caps[0]?.['appium:systemPort']).toBe('number');
    expect(t.session.settings).toEqual(DEFAULT_UIA2_SETTINGS);
    expect(t.servers[0]?.env?.ANDROID_HOME).toBe(t.sdkRoot);
    // logcat streams in the background
    expect(t.runner.lines('spawn')[0]).toContain('logcat -v epoch -v uid');
  });

  it('launches with the payload as the __dpad string extra after reversing its ports', async () => {
    await driver.launch({
      payload: {
        v: 1,
        sdkUrl: 'ws://localhost:9323',
        token: 't',
        mockUrl: 'http://127.0.0.1:8080',
      },
      clearData: true,
    });
    const lines = t.runner.lines('run');
    const from = lines.findIndex((l) => l.includes('am force-stop'));
    expect(lines.slice(from)).toEqual([
      'adb -s emulator-5554 shell am force-stop tv.dpad.fixture',
      'adb -s emulator-5554 shell pm clear tv.dpad.fixture',
      'adb -s emulator-5554 reverse tcp:9323 tcp:9323',
      'adb -s emulator-5554 reverse tcp:8080 tcp:8080',
      `adb -s emulator-5554 shell am start -W -n tv.dpad.fixture/.MainActivity -a android.intent.action.MAIN -c android.intent.category.LEANBACK_LAUNCHER --es __dpad ${encodeLaunchPayloadParam({ v: 1, sdkUrl: 'ws://localhost:9323', token: 't', mockUrl: 'http://127.0.0.1:8080' })}`,
    ]);

    // Ports are reversed once per driver and removed on stop.
    await driver.launch({ payload: { v: 1, mockUrl: 'http://localhost:8080' } });
    expect(t.runner.lines().filter((l) => l.includes('reverse tcp:8080'))).toHaveLength(1);
    await driver.stop();
    expect(t.runner.lines()).toContain('adb -s emulator-5554 reverse --remove tcp:8080');
    expect(t.runner.lines()).toContain('adb -s emulator-5554 reverse --remove tcp:9323');
  });

  it('uses a configured activity', async () => {
    const custom = setup({}, { activity: '.Other' });
    await custom.driver.start();
    await custom.driver.launch({ payload: { v: 1 } });
    expect(adbShell(custom.runner).find((l) => l.startsWith('am start'))).toBe(
      `am start -W -n tv.dpad.fixture/.Other -a android.intent.action.MAIN --es __dpad ${encodeLaunchPayloadParam({ v: 1 })}`,
    );
  });

  it('terminates with force-stop and resets with pm clear', async () => {
    await driver.terminate();
    await driver.reset();
    expect(adbShell(t.runner).slice(-2)).toEqual([
      'am force-stop tv.dpad.fixture',
      'pm clear tv.dpad.fixture',
    ]);
  });

  it('answers query, focused and tree from one page source each', async () => {
    let fetches = 0;
    t.session.getPageSource = async () => {
      fetches++;
      return homeXml;
    };
    expect((await driver.focused())?.testId).toBe('card_0');
    expect((await driver.query([{ kind: 'testId', value: 'card_3' }]))[0]?.text).toBe('Item 3');
    expect((await driver.tree()).viewport).toEqual({ width: 1920, height: 1080 });
    expect(fetches).toBe(3);
  });

  it('presses keys through UiAutomator2 and holds them through the key-hold helper', async () => {
    await driver.press(Key.SELECT);
    await driver.press(Key.RED);
    expect(t.session.executed).toEqual([
      ['mobile: pressKey', [{ keycode: 23 }]],
      ['mobile: pressKey', [{ keycode: 183 }]],
    ]);

    await driver.press(Key.RIGHT, { holdMs: 1500 });
    await driver.press(Key.RIGHT, { holdMs: 800 });
    const lines = t.runner.lines('run');
    expect(lines.filter((l) => l.includes('push')).length).toBe(1);
    expect(lines.filter((l) => l.includes('app_process'))).toEqual([
      'adb -s emulator-5554 shell CLASSPATH=/data/local/tmp/dpad-key-hold.jar app_process / tv.dpad.helper.KeyHold 22 1500',
      'adb -s emulator-5554 shell CLASSPATH=/data/local/tmp/dpad-key-hold.jar app_process / tv.dpad.helper.KeyHold 22 800',
    ]);
  });

  it('refuses keys the configured remote does not have', async () => {
    const fire = setup({ remote: 'fire-tv' });
    await fire.driver.start();
    expect(fire.driver.capabilities.has('key.color')).toBe(false);
    const err = await fire.driver.press(Key.RED).catch((e: unknown) => e);
    expect((err as DpadError).code).toBe('ANDROID_KEY_UNSUPPORTED');
    await fire.driver.press(Key.PLAY_PAUSE);
    expect(fire.session.executed).toEqual([['mobile: pressKey', [{ keycode: 85 }]]]);
  });

  it('takes viewport screenshots and crops element screenshots to bounds', async () => {
    const full = PNG.sync.read(Buffer.from(await driver.screenshot()));
    expect([full.width, full.height]).toEqual([1920, 1080]);

    const [card] = await driver.query([{ kind: 'testId', value: 'card_0' }]);
    const el = PNG.sync.read(Buffer.from(await driver.screenshot({ element: card!.ref })));
    expect([el.width, el.height]).toEqual([400, 224]);
    expect(el.data[0]).toBe(255);

    const err = await driver
      .screenshot({ element: 'r.0.7|x|y' as ElementRef })
      .catch((e: unknown) => e);
    expect((err as DpadError).code).toBe('ANDROID_ELEMENT_DETACHED');
    const [hidden] = await driver.query([{ kind: 'testId', value: 'card_9' }]);
    await expect(driver.screenshot({ element: hidden!.ref })).rejects.toThrow(/no visible area/);
  });

  it('drains app logs from logcat', async () => {
    const logcat = t.runner.processes[0]!;
    logcat.emit('  1795371169.124 10096  1382  1382 I DpadFixture: hello');
    logcat.emit('  1795371169.125 1000  363  363 E system: unrelated');
    const logs = await driver.drainLogs();
    expect(logs).toEqual([
      { level: 'info', message: 'DpadFixture: hello', timestamp: 1795371169124, source: 'app' },
    ]);
    expect(await driver.drainLogs()).toEqual([]);
  });

  it('returns the WebdriverIO session as the escape hatch', () => {
    expect(driver.escapeHatch()).toBe(t.session);
  });

  it('stops everything once and is safe to call twice', async () => {
    await driver.stop();
    await driver.stop();
    expect(t.session.deleted).toBe(1);
    expect(t.servers[0]?.stopped).toBe(1);
    expect(t.runner.processes[0]?.signals).toEqual(['SIGTERM']);
    await expect(driver.press(Key.UP)).rejects.toMatchObject({ code: 'ANDROID_NOT_STARTED' });
  });
});

describe('AndroidTvDriver start failures', () => {
  it('installs the configured APK before checking the package', async () => {
    const t = setup({}, { apk: '/tmp/app.apk' });
    await t.driver.start();
    const lines = t.runner.lines('run');
    expect(lines.findIndex((l) => l.includes('install -r -t -g /tmp/app.apk'))).toBeLessThan(
      lines.findIndex((l) => l.includes('pm path')),
    );
  });

  it('resolves a relative APK path against the config directory', async () => {
    const t = setup({}, { apk: './build/app.apk' }, { configDir: '/work/tv' });
    await t.driver.start();
    expect(
      t.runner.lines('run').some((l) => l.includes('install -r -t -g /work/tv/build/app.apk')),
    ).toBe(true);
  });

  it('drives the device with the lease environment', async () => {
    const t = setup({}, {}, { meta: { environment: { ANDROID_ADB_SERVER_PORT: '6100' } } });
    await t.driver.start();
    expect(t.servers[0]?.env?.ANDROID_ADB_SERVER_PORT).toBe('6100');
    expect(t.caps[0]?.['appium:adbPort']).toBe(6100);
  });

  it('explains a missing app', async () => {
    const t = setup();
    t.runner.on('pm path', { exitCode: 1 });
    await expect(t.driver.start()).rejects.toMatchObject({ code: 'ANDROID_APP_NOT_INSTALLED' });
    expect(t.servers).toHaveLength(0);
  });

  it('wraps session errors and cleans up the server', async () => {
    const t = setup();
    const failing = createAndroidTvDriver(
      { sdkRoot: t.sdkRoot },
      {
        app: { package: 'tv.dpad.fixture' },
        workerIndex: 0,
        artifactsDir: tmpdir(),
        log: () => {},
      },
      {
        runner: t.runner,
        env: { ANDROID_SERIAL: 'emulator-5556' },
        startServer: async () => ({ hostname: 'h', port: 1, stop: async () => {} }),
        createSession: async () => {
          throw new Error('no uia2');
        },
      },
    );
    expect(failing.serial).toBe('emulator-5556');
    await expect(failing.start()).rejects.toMatchObject({ code: 'ANDROID_SESSION_FAILED' });
  });

  it('requires a device', () => {
    const { sdkRoot } = setup();
    expect(() =>
      createAndroidTvDriver(
        { sdkRoot },
        { app: { package: 'a.b' }, workerIndex: 0, artifactsDir: '', log: () => {} },
        { env: {} },
      ),
    ).toThrow(expect.objectContaining({ code: 'ANDROID_NO_DEVICE' }));
  });

  it('validates the app config', () => {
    expect(() => setup({}, { package: 'not a package' })).toThrow(
      expect.objectContaining({ code: 'ANDROID_APP_CONFIG' }),
    );
  });
});

describe('payloadPorts', () => {
  it('collects localhost ports with protocol defaults and skips remote hosts', () => {
    expect(payloadPorts({ v: 1 })).toEqual([]);
    expect(
      payloadPorts({
        v: 1,
        sdkUrl: 'ws://localhost:9323',
        token: 't',
        mockUrl: 'http://localhost:9323',
      }),
    ).toEqual([9323]);
    expect(payloadPorts({ v: 1, mockUrl: 'https://localhost' })).toEqual([443]);
    expect(payloadPorts({ v: 1, mockUrl: 'http://10.0.2.2:8080' })).toEqual([]);
  });
});
