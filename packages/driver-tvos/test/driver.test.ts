import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceLease, DriverCreateContext, ElementRef } from '@dpad-tv/core';
import { KEY_CAPABILITY, Key } from '@dpad-tv/core';
import { encodeLaunchPayloadParam } from '@dpad-tv/protocol';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import tvosDriverModule, { TvosDriver, type TvosDriverDeps } from '../src/index.js';
import { REMOTE_BUTTONS, TVOS_CAPABILITIES } from '../src/keys.js';
import type { TvosDriverOptions } from '../src/options.js';
import type { SessionRequest, TvosSession } from '../src/session.js';
import type { WdaSourceNode } from '../src/source.js';
import { FakeRunner } from './helpers.js';

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

const SCREEN: WdaSourceNode = {
  type: 'Application',
  rect: rect(0, 0, 1920, 1080),
  children: [
    {
      type: 'Button',
      rawIdentifier: 'play',
      label: 'Play',
      rect: rect(100, 100, 200, 100),
      isVisible: '1',
      isAccessible: '1',
      isFocused: '1',
    },
    {
      type: 'Button',
      rawIdentifier: 'offscreen',
      label: 'Far',
      rect: rect(3000, 100, 200, 100),
      isVisible: '0',
      isAccessible: '1',
    },
  ],
};

/** Records `execute` calls; answers `mobile: source` with {@link SCREEN}. */
class FakeSession implements TvosSession {
  readonly executed: { script: string; args: unknown }[] = [];
  deleted = 0;
  screenshotPng = solidPng(3840, 2160);
  failNext: Error | undefined;

  async execute(script: string, ...args: unknown[]): Promise<unknown> {
    this.executed.push({ script, args: args[0] });
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = undefined;
      throw err;
    }
    return script === 'mobile: source' ? structuredClone(SCREEN) : null;
  }
  async takeScreenshot(): Promise<string> {
    return Buffer.from(this.screenshotPng).toString('base64');
  }
  async deleteSession(): Promise<void> {
    this.deleted++;
  }
  scripts(): string[] {
    return this.executed.map((e) => e.script);
  }
}

function solidPng(width: number, height: number): Uint8Array {
  const png = new PNG({ width, height });
  png.data.fill(255);
  return new Uint8Array(PNG.sync.write(png));
}

describe('TvosDriver', () => {
  let dir: string;
  let session: FakeSession;
  let runner: FakeRunner;
  let requests: SessionRequest[];
  let appiumStops: number;
  let deps: { -readonly [K in keyof TvosDriverDeps]?: TvosDriverDeps[K] };
  const logs: string[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dpad-tvos-driver-'));
    session = new FakeSession();
    requests = [];
    appiumStops = 0;
    runner = new FakeRunner()
      .on('get_app_container', { stdout: '/apps/Fixture.app\n' })
      .on('plutil', { stdout: 'DpadFixture\n' });
    deps = {
      runner,
      createSession: async (req) => {
        requests.push(req);
        return session;
      },
      startAppium: async (opts) => ({
        url: 'http://127.0.0.1:4999/',
        logFile: opts.logFile,
        stop: async () => {
          appiumStops++;
        },
      }),
      ensureWda: async () => '/cache/WebDriverAgentRunner_tvOS-Runner.app',
      prepareSimulator: async (udid, opts) => ({
        udid,
        name: 'Apple TV',
        runtimeId: 'com.apple.CoreSimulator.SimRuntime.tvOS-27-2',
        osVersion: '27.2',
        deviceSet: opts?.deviceSet,
      }),
      freePort: async () => 8123,
    };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function ctx(over: Partial<DriverCreateContext> = {}): DriverCreateContext {
    const device: DeviceLease = {
      id: 'tvos:UDID-1',
      platform: 'tvos',
      address: 'UDID-1',
      meta: { environment: { SIMLOCK_IOS_DEVICE_SET: '/simlock/set' } },
      release: async () => {},
    };
    return {
      app: {
        bundleId: 'tv.dpad.fixture',
        app: '/build/DpadFixture.app',
        launchArguments: ['-AppleLanguages', '(en)'],
      },
      device,
      workerIndex: 3,
      artifactsDir: dir,
      log: (m) => logs.push(m),
      ...over,
    };
  }

  async function started(options: TvosDriverOptions = {}, c = ctx()) {
    const driver = new TvosDriver(options, c, deps);
    await driver.start();
    return driver;
  }

  it('starts Appium, opens an XCUITest session with prebuilt WDA, installs the app and streams its logs', async () => {
    const driver = await started();
    const caps = requests[0]!.capabilities;
    expect(requests[0]!.serverUrl).toBe('http://127.0.0.1:4999/');
    expect(caps).toMatchObject({
      platformName: 'tvOS',
      'appium:automationName': 'XCUITest',
      'appium:udid': 'UDID-1',
      'appium:platformVersion': '27.2',
      'appium:simulatorDevicesSetPath': '/simlock/set',
      'appium:wdaLocalPort': 8123,
      'appium:usePreinstalledWDA': true,
      'appium:prebuiltWDAPath': '/cache/WebDriverAgentRunner_tvOS-Runner.app',
      'appium:waitForIdleTimeout': 0,
      'appium:skipLogCapture': true,
      'appium:newCommandTimeout': 0,
    });
    expect(runner.lines()).toContain(
      'xcrun simctl --set /simlock/set install UDID-1 /build/DpadFixture.app',
    );
    const logStream = runner.spawned[0]!.args.join(' ');
    expect(logStream).toContain('simctl --set /simlock/set spawn UDID-1 log stream --style ndjson');
    expect(logStream).toContain('process == "DpadFixture"');
    expect(driver.escapeHatch()).toBe(session);
    await driver.stop();
  });

  it('uses an external Appium server and XCUITest-managed WDA when configured', async () => {
    const driver = await started({
      appium: { url: 'http://grid:4723/' },
      wda: { mode: 'xcodebuild' },
      capabilities: { 'appium:reduceMotion': true },
      logs: { enabled: false },
    });
    const caps = requests[0]!.capabilities;
    expect(requests[0]!.serverUrl).toBe('http://grid:4723/');
    expect(caps['appium:usePreinstalledWDA']).toBeUndefined();
    expect(caps['appium:newCommandTimeout']).toBe(600);
    expect(caps['appium:reduceMotion']).toBe(true);
    expect(runner.spawned).toHaveLength(0);
    await driver.stop();
    expect(appiumStops).toBe(0);
  });

  it('launches with the payload as `-__dpad <base64url>` after the app launch arguments', async () => {
    const driver = await started();
    await driver.launch({
      payload: { v: 1, state: 'details', sdkUrl: 'ws://localhost:9323', token: 't' },
      clearData: true,
    });
    expect(session.executed).toEqual([
      { script: 'mobile: terminateApp', args: { bundleId: 'tv.dpad.fixture' } },
      { script: 'mobile: clearApp', args: { bundleId: 'tv.dpad.fixture' } },
      {
        script: 'mobile: launchApp',
        args: {
          bundleId: 'tv.dpad.fixture',
          arguments: [
            '-AppleLanguages',
            '(en)',
            '-__dpad',
            encodeLaunchPayloadParam({
              v: 1,
              state: 'details',
              sdkUrl: 'ws://localhost:9323',
              token: 't',
            }),
          ],
          environment: {},
        },
      },
    ]);
    await driver.terminate();
    await driver.reset();
    expect(session.scripts().slice(-2)).toEqual(['mobile: terminateApp', 'mobile: clearApp']);
  });

  it('reads query, focused and tree from one page source fetch each', async () => {
    const driver = await started();
    expect((await driver.focused())?.testId).toBe('play');
    expect((await driver.query([{ kind: 'text', value: 'far' }])).map((s) => s.testId)).toEqual([
      'offscreen',
    ]);
    expect((await driver.tree()).viewport).toEqual({ width: 1920, height: 1080 });
    expect(session.scripts()).toEqual(['mobile: source', 'mobile: source', 'mobile: source']);
    expect(session.executed[0]!.args).toMatchObject({
      format: 'json',
      excludedAttributes: expect.stringContaining('nativeFrame'),
    });
  });

  it('presses real remote buttons, with a duration for long presses', async () => {
    const driver = await started();
    await driver.press(Key.BACK);
    await driver.press(Key.SELECT, { holdMs: 1500 });
    await driver.press(Key.PLAY_PAUSE);
    expect(session.executed.map((e) => e.args)).toEqual([
      { name: 'menu' },
      { name: 'select', durationSeconds: 1.5 },
      { name: 'playpause' },
    ]);
    await expect(driver.press(Key.RED)).rejects.toMatchObject({ code: 'TVOS_KEY_UNSUPPORTED' });
  });

  it('crops element screenshots from the viewport screenshot at the pixel scale', async () => {
    const driver = await started();
    const full = PNG.sync.read(Buffer.from(await driver.screenshot()));
    expect([full.width, full.height]).toEqual([3840, 2160]);
    const play = (await driver.query([{ kind: 'testId', value: 'play' }]))[0]!;
    const el = PNG.sync.read(Buffer.from(await driver.screenshot({ element: play.ref })));
    expect([el.width, el.height]).toEqual([400, 200]);
    const far = (await driver.query([{ kind: 'testId', value: 'offscreen' }]))[0]!;
    await expect(driver.screenshot({ element: far.ref })).rejects.toMatchObject({
      code: 'TVOS_ELEMENT_NOT_VISIBLE',
    });
    await expect(driver.screenshot({ element: '9.9:Button' as ElementRef })).rejects.toMatchObject({
      code: 'TVOS_ELEMENT_DETACHED',
    });
  });

  it('records video with simctl into the artifacts dir', async () => {
    const driver = await started({ logs: { enabled: false } });
    const recording = driver.startRecording();
    const rec = runner.spawned.at(-1)!;
    expect(rec.args.join(' ')).toMatch(
      /simctl --set \/simlock\/set io UDID-1 recordVideo --codec=h264 --force .*tvos-w3-\d+\.mp4$/,
    );
    rec.child.stderr.write('Recording started\n');
    await recording;
    const path = rec.args.at(-1)!;
    await writeFile(path, 'mp4');
    expect(await driver.stopRecording()).toBe(path);
    expect(rec.child.signals).toEqual(['SIGINT']);
    await expect(driver.stopRecording()).rejects.toMatchObject({ code: 'TVOS_RECORDING_FAILED' });
  });

  it('wraps command failures in a DpadError pointing at the Appium log', async () => {
    const driver = await started();
    session.failNext = new Error('WDA crashed');
    await expect(driver.tree()).rejects.toMatchObject({
      code: 'TVOS_COMMAND_FAILED',
      message: expect.stringContaining('WDA crashed'),
      hint: expect.stringContaining(join(dir, 'appium-w3.log')),
    });
  });

  it('stops idempotently and refuses work when not started', async () => {
    const driver = await started();
    await Promise.all([driver.stop(), driver.stop()]);
    await driver.stop();
    expect(session.deleted).toBe(1);
    expect(appiumStops).toBe(1);
    expect(runner.spawned[0]!.child.signals).toEqual(['SIGTERM']);
    await expect(driver.tree()).rejects.toMatchObject({ code: 'TVOS_NOT_STARTED' });
    expect(() => driver.escapeHatch()).toThrow(/not started/);
    expect(await driver.drainLogs()).toEqual([]);
  });

  it('stops the started server when the WebDriverAgent build fails', async () => {
    deps.ensureWda = async () => {
      throw new Error('xcodebuild exit 65');
    };
    await expect(new TvosDriver({}, ctx(), deps).start()).rejects.toThrow('exit 65');
    expect(appiumStops).toBe(1);
    expect(requests).toHaveLength(0);
  });

  it('cleans up the server when the session can not open', async () => {
    deps.createSession = async () => {
      throw new Error('xcodebuild failed with code 65');
    };
    const driver = new TvosDriver({}, ctx(), deps);
    await expect(driver.start()).rejects.toMatchObject({
      code: 'TVOS_SESSION_FAILED',
      message: expect.stringContaining('code 65'),
    });
    expect(appiumStops).toBe(1);
  });

  it('explains a missing device, app config and uninstalled app', async () => {
    const { device: _device, ...withoutDevice } = ctx();
    const noDevice = new TvosDriver({}, withoutDevice, deps);
    await expect(noDevice.start()).rejects.toMatchObject({ code: 'TVOS_NO_DEVICE' });
    expect(() => new TvosDriver({}, ctx({ app: {} }), deps)).toThrow(/bundleId/);
    runner = new FakeRunner().on('get_app_container', { exitCode: 2 });
    deps.runner = runner;
    const notInstalled = new TvosDriver({}, ctx({ app: { bundleId: 'tv.dpad.fixture' } }), deps);
    await expect(notInstalled.start()).rejects.toMatchObject({ code: 'TVOS_APP_NOT_INSTALLED' });
    expect(appiumStops).toBe(1);
  });
});

describe('capabilities and key mapping', () => {
  it('maps exactly the Siri Remote buttons and declares only what they back', () => {
    for (const [key, button] of Object.entries(REMOTE_BUTTONS)) {
      const cap = KEY_CAPABILITY[key as Key];
      expect(button, key).toBeTruthy();
      if (cap) expect(TVOS_CAPABILITIES.has(cap), `${key} needs ${cap}`).toBe(true);
    }
    for (const [key, cap] of Object.entries(KEY_CAPABILITY)) {
      if (cap && TVOS_CAPABILITIES.has(cap)) expect(REMOTE_BUTTONS[key as Key], key).toBeDefined();
    }
    for (const cap of [
      'key.media.discrete',
      'key.media.transport',
      'key.color',
      'key.numeric',
      'key.channel',
      'key.menu',
      'key.info',
    ] as const) {
      expect(TVOS_CAPABILITIES.has(cap), cap).toBe(false);
    }
  });

  it('exports a DriverModule for the tvos platform', async () => {
    expect(tvosDriverModule.platform).toBe('tvos');
    expect(tvosDriverModule.createDeviceProvider?.({})).toMatchObject({
      acquire: expect.any(Function),
      dispose: expect.any(Function),
    });
  });
});
