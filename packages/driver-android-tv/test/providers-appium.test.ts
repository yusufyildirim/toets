import { existsSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ensureAppiumHome,
  externalAppiumServer,
  freePort,
  startAppiumServer,
} from '../src/appium.js';
import { nodeCommandRunner } from '../src/command.js';
import { createExternalDeviceProvider, prepareAndroidDevice } from '../src/devices/external.js';
import { resolveAndroidSdk, sdkAt } from '../src/sdk.js';
import { bootedDevice, FakeRunner } from './fake-runner.js';

const fakeSdk = () => {
  const root = mkdtempSync(join(tmpdir(), 'dpad-sdk-'));
  mkdirSync(join(root, 'platform-tools'));
  return root;
};
const spec = { platform: 'android-tv' as const };

describe('external devices', () => {
  it('hands out DPAD_DEVICES by worker index once they are booted', async () => {
    const runner = bootedDevice(new FakeRunner());
    const provider = createExternalDeviceProvider({
      sdkRoot: fakeSdk(),
      runner,
      env: { DPAD_DEVICES: 'emulator-5554, emulator-5556' },
    });
    const b = await provider.acquire(spec, { workerIndex: 1 });
    const a = await provider.acquire(spec, { workerIndex: 0 });
    expect([a.address, b.address]).toEqual(['emulator-5554', 'emulator-5556']);
    expect(a.meta).toEqual({ apiLevel: 33, isTv: true });
    await expect(provider.acquire(spec, { workerIndex: 2 })).rejects.toMatchObject({
      code: 'ANDROID_NO_DEVICE',
    });
    await a.release();
    expect((await provider.acquire(spec, { workerIndex: 2 })).address).toBe('emulator-5554');
    expect(runner.lines().some((l) => l.includes('emu kill'))).toBe(false);
  });

  it('explains an empty configuration', async () => {
    const provider = createExternalDeviceProvider({
      sdkRoot: fakeSdk(),
      runner: new FakeRunner(),
      env: {},
    });
    await expect(provider.acquire(spec, { workerIndex: 0 })).rejects.toThrow(
      /No external devices configured/,
    );
  });

  it('prepareAndroidDevice reports TV-ness and can require it', async () => {
    const runner = bootedDevice(new FakeRunner());
    const sdkRoot = fakeSdk();
    expect(await prepareAndroidDevice('emulator-5554', { sdkRoot, runner, env: {} })).toEqual({
      serial: 'emulator-5554',
      apiLevel: 33,
      isTv: true,
    });
    runner.on('pm has-feature', 'false\n');
    await expect(
      prepareAndroidDevice('emulator-5554', { sdkRoot, runner, env: {}, requireTv: true }),
    ).rejects.toMatchObject({
      code: 'ANDROID_NOT_A_TV',
    });
  });
});

describe('Android SDK resolution', () => {
  it('prefers the explicit root, then ANDROID_HOME, and explains a missing SDK', () => {
    const root = fakeSdk();
    expect(resolveAndroidSdk(root, {}).root).toBe(root);
    expect(resolveAndroidSdk(undefined, { ANDROID_HOME: root }).adb).toBe(
      join(root, 'platform-tools', 'adb'),
    );
    expect(() => resolveAndroidSdk('/nope', { ANDROID_HOME: '/nope2' }, 'linux')).toThrow(
      expect.objectContaining({ code: 'ANDROID_SDK_NOT_FOUND' }),
    );
    expect(sdkAt('C:\\sdk', 'win32').avdmanager.endsWith('avdmanager.bat')).toBe(true);
  });
});

describe('Appium server', () => {
  it('links the bundled UiAutomator2 driver into a private APPIUM_HOME', () => {
    const home = ensureAppiumHome();
    const link = join(home, 'node_modules', 'appium-uiautomator2-driver');
    expect(existsSync(join(link, 'package.json'))).toBe(true);
    expect(realpathSync(readlinkSync(link))).toBe(realpathSync(link));
    expect(ensureAppiumHome()).toBe(home);
  });

  it('spawns the pinned appium and waits for /status', async () => {
    const port = await freePort();
    const status = createServer((_req, res) => res.end(JSON.stringify({ value: { ready: true } })));
    await new Promise<void>((r) => status.listen(port, '127.0.0.1', r));
    const runner = new FakeRunner();
    try {
      const server = await startAppiumServer({ runner, env: { ANDROID_HOME: '/sdk' }, port });
      expect(server).toMatchObject({ hostname: '127.0.0.1', port });
      const call = runner.calls[0]!;
      expect(call.file).toBe(process.execPath);
      expect(call.args[0]).toMatch(/appium[/\\]index\.js$/);
      expect(call.args.slice(1)).toEqual([
        'server',
        '--address',
        '127.0.0.1',
        '--port',
        String(port),
        '--log-no-colors',
        '--log-timestamp',
      ]);
      expect((call.opts as { env: NodeJS.ProcessEnv }).env.APPIUM_HOME).toBe(ensureAppiumHome());
      await server.stop();
      await server.stop();
      expect(runner.processes[0]!.signals).toEqual(['SIGTERM']);
    } finally {
      status.close();
    }
  });

  it('reports the server output when Appium exits during startup', async () => {
    const runner = new FakeRunner();
    const pending = startAppiumServer({
      runner,
      env: {},
      port: await freePort(),
      startTimeoutMs: 5000,
    });
    await new Promise((r) => setTimeout(r, 20));
    runner.processes[0]!.emit('Error: Could not load driver uiautomator2');
    runner.processes[0]!.exit(1);
    const err = await pending.catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'ANDROID_APPIUM_START_FAILED' });
    expect((err as { hint: string }).hint).toContain('Could not load driver uiautomator2');
  });

  it('wraps an external server without owning it', async () => {
    const server = externalAppiumServer('http://grid.local:4723/');
    expect(server).toMatchObject({ hostname: 'grid.local', port: 4723 });
    await server.stop();
  });
});

describe('nodeCommandRunner', () => {
  it('captures output and exit codes, feeds stdin and enforces timeouts', async () => {
    const node = process.execPath;
    expect(
      await nodeCommandRunner.run(node, ['-e', 'process.stdout.write("hi"); process.exit(3)']),
    ).toEqual({
      stdout: 'hi',
      stderr: '',
      exitCode: 3,
    });
    const echo = await nodeCommandRunner.run(node, ['-e', 'process.stdin.pipe(process.stdout)'], {
      input: 'no\n',
    });
    expect(echo.stdout).toBe('no\n');
    await expect(
      nodeCommandRunner.run(node, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 100 }),
    ).rejects.toMatchObject({
      code: 'ANDROID_COMMAND_TIMEOUT',
    });
    await expect(nodeCommandRunner.run('/definitely/not/here', [])).rejects.toMatchObject({
      code: 'ANDROID_COMMAND_FAILED',
    });
  });

  it('streams lines from spawned processes and reports their exit', async () => {
    const lines: string[] = [];
    const proc = nodeCommandRunner.spawn(
      process.execPath,
      ['-e', 'console.log("a\\nb"); console.error("c")'],
      {
        onLine: (l, s) => lines.push(`${s}:${l}`),
      },
    );
    expect(await proc.exited).toBe(0);
    expect(lines.sort()).toEqual(['stderr:c', 'stdout:a', 'stdout:b']);

    const long = nodeCommandRunner.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)']);
    long.kill();
    expect(await long.exited).toBeNull();
  });
});
