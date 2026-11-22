import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withFileLock } from '../src/devices/lock.js';
import {
  avdName,
  CLEAN_SNAPSHOT,
  ManagedDeviceProvider,
  type ManagedDeviceOptions,
} from '../src/devices/managed.js';
import { bootedDevice, FakeRunner } from './fake-runner.js';

const AVD = 'dpad_tv_1080p_api33_android-tv';

function setup(
  opts: ManagedDeviceOptions = {},
  extra: { running?: string[]; busyPorts?: number[] } = {},
) {
  const sdkRoot = mkdtempSync(join(tmpdir(), 'dpad-sdk-'));
  for (const api of ['31', '33'])
    mkdirSync(join(sdkRoot, 'system-images', `android-${api}`, 'android-tv', 'arm64-v8a'), {
      recursive: true,
    });
  const avdHome = mkdtempSync(join(tmpdir(), 'dpad-avd-'));
  const runner = bootedDevice(new FakeRunner());
  const running = [...(extra.running ?? [])];
  runner
    .on(
      'adb devices',
      () => `List of devices attached\n${running.map((s) => `${s}\tdevice`).join('\n')}\n`,
    )
    .on('avdmanager create avd', (args) => {
      const name = args[args.indexOf('--name') + 1]!;
      writeFileSync(join(avdHome, `${name}.ini`), '');
      mkdirSync(join(avdHome, `${name}.avd`), { recursive: true });
      return '';
    })
    .on('emu avd snapshot save', () => {
      mkdirSync(join(avdHome, `${AVD}.avd`, 'snapshots', CLEAN_SNAPSHOT), { recursive: true });
      return 'OK\n';
    })
    .on('emu avd snapshot load', 'OK\n')
    .on('emu kill', (args) => {
      const port = args[1]!.replace('emulator-', '');
      for (const p of runner.processes) if (p.call.args.includes(port)) p.exit(0);
      return 'OK\n';
    });
  const busy = new Set(extra.busyPorts ?? []);
  const provider = new ManagedDeviceProvider({ abi: 'arm64-v8a', avdHome, ...opts }, sdkRoot, {
    runner,
    env: {},
    isPortFree: async (p) => !busy.has(p),
    settleMs: 0,
  });
  const emulatorSpawns = () =>
    runner.calls.filter((c) => c.kind === 'spawn').map((c) => c.args.join(' '));
  return { provider, runner, avdHome, sdkRoot, running, emulatorSpawns };
}

const spec = { platform: 'android-tv' as const, model: 'tv_1080p', osVersion: '33' };

describe('ManagedDeviceProvider', () => {
  it('creates the AVD and its clean snapshot once, then boots read-only instances from it', async () => {
    const t = setup();
    const lease = await t.provider.acquire(spec, { workerIndex: 0 });

    const create = t.runner.calls.find((c) => c.file.endsWith('avdmanager'))!;
    expect(create.args).toEqual([
      'create',
      'avd',
      '--name',
      AVD,
      '--package',
      'system-images;android-33;android-tv;arm64-v8a',
      '--device',
      'tv_1080p',
      '--force',
    ]);
    expect(create.opts).toMatchObject({ input: 'no\n' });

    expect(t.emulatorSpawns()).toEqual([
      `-avd ${AVD} -port 5554 -no-boot-anim -no-audio -no-window -no-snapshot-load`,
      `-avd ${AVD} -port 5554 -no-boot-anim -no-audio -no-window -read-only -snapshot ${CLEAN_SNAPSHOT} -no-snapshot-save`,
    ]);
    expect(t.runner.lines('run')).toContain(
      `adb -s emulator-5554 emu avd snapshot save ${CLEAN_SNAPSHOT}`,
    );
    expect(t.runner.processes[0]?.call.args).toContain('-no-snapshot-load');

    expect(lease).toMatchObject({
      id: `${AVD}@emulator-5554`,
      platform: 'android-tv',
      address: 'emulator-5554',
      meta: { avd: AVD, port: 5554, api: '33', snapshot: CLEAN_SNAPSHOT },
    });

    const second = await t.provider.acquire(spec, { workerIndex: 1 });
    expect(second.address).toBe('emulator-5556');
    expect(t.runner.calls.filter((c) => c.file.endsWith('avdmanager'))).toHaveLength(1);
    expect(t.emulatorSpawns()).toHaveLength(3);
  });

  it('skips ports used by other emulators or processes', async () => {
    const t = setup({}, { running: ['emulator-5554'], busyPorts: [5557] });
    const lease = await t.provider.acquire(spec, { workerIndex: 0 });
    expect(lease.address).toBe('emulator-5558');
  });

  it('reuses a released emulator after restoring the clean snapshot', async () => {
    const t = setup();
    const lease = await t.provider.acquire(spec, { workerIndex: 0 });
    await lease.release();
    await lease.release();
    const again = await t.provider.acquire(spec, { workerIndex: 3 });
    expect(again.address).toBe(lease.address);
    expect(t.emulatorSpawns()).toHaveLength(2);
    expect(t.runner.lines('run').at(-3)).toBe(
      `adb -s emulator-5554 emu avd snapshot load ${CLEAN_SNAPSHOT}`,
    );
  });

  it('kills the emulators it booted on dispose', async () => {
    const t = setup();
    await t.provider.acquire(spec, { workerIndex: 0 });
    await t.provider.dispose();
    expect(t.runner.lines('run').at(-1)).toBe('adb -s emulator-5554 emu kill');
    await expect(t.runner.processes[1]!.exited).resolves.toBe(0);
  });

  it('adopts a running emulator of the same AVD in reuse mode and leaves it running', async () => {
    const t = setup({ reuse: true }, { running: ['emulator-5590', 'emulator-5600'] });
    mkdirSync(join(t.avdHome, `${AVD}.avd`, 'snapshots', CLEAN_SNAPSHOT), { recursive: true });
    writeFileSync(join(t.avdHome, `${AVD}.ini`), '');
    t.runner.on('emu avd name', (args) =>
      args[1] === 'emulator-5600' ? `${AVD}\nOK\n` : 'someone_else\nOK\n',
    );
    const lease = await t.provider.acquire(spec, { workerIndex: 0 });
    expect(lease.address).toBe('emulator-5600');
    expect(t.emulatorSpawns()).toEqual([]);
    expect(t.runner.lines('run')).toContain(
      `adb -s emulator-5600 emu avd snapshot load ${CLEAN_SNAPSHOT}`,
    );
    await t.provider.dispose();
    expect(t.runner.lines('run').some((l) => l.endsWith('emu kill'))).toBe(false);
  });

  it('boots detached in reuse mode when nothing can be adopted', async () => {
    const t = setup({
      reuse: true,
      headless: false,
      emulatorArgs: ['-gpu', 'swiftshader_indirect'],
    });
    await t.provider.acquire(spec, { workerIndex: 0 });
    const boot = t.runner.calls.filter((c) => c.kind === 'spawn').at(-1)!;
    expect(boot.opts).toMatchObject({ detached: true });
    expect(boot.args).not.toContain('-no-window');
    expect(boot.args.slice(-2)).toEqual(['-gpu', 'swiftshader_indirect']);
  });

  it('explains a missing system image', async () => {
    const t = setup();
    const err = await t.provider
      .acquire({ ...spec, osVersion: '34' }, { workerIndex: 0 })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'ANDROID_SYSTEM_IMAGE_MISSING' });
    expect((err as Error & { hint: string }).hint).toContain(
      'sdkmanager "system-images;android-34;android-tv;arm64-v8a"',
    );
    expect((err as Error & { hint: string }).hint).toContain('31, 33');
  });

  it('picks the newest installed image when no API level is given', () => {
    const t = setup();
    expect(t.provider.resolveImage({ platform: 'android-tv' })).toMatchObject({
      api: '33',
      model: 'tv_1080p',
    });
  });

  it('fails clearly when the emulator dies while booting', async () => {
    const t = setup();
    mkdirSync(join(t.avdHome, `${AVD}.avd`, 'snapshots', CLEAN_SNAPSHOT), { recursive: true });
    writeFileSync(join(t.avdHome, `${AVD}.ini`), '');
    t.runner.on('get-state', { exitCode: 1, stderr: 'offline' });
    const pending = t.provider.acquire(spec, { workerIndex: 0 });
    await new Promise((r) => setTimeout(r, 10));
    t.runner.processes[0]!.exit(1);
    await expect(pending).rejects.toMatchObject({ code: 'ANDROID_EMULATOR_FAILED' });
  });

  it('reports avdmanager failures', async () => {
    const t = setup();
    t.runner.on('avdmanager create avd', {
      exitCode: 1,
      stderr: 'Error: Invalid --device tv_9000',
    });
    await expect(
      t.provider.acquire({ ...spec, model: 'tv_9000' }, { workerIndex: 0 }),
    ).rejects.toMatchObject({
      code: 'ANDROID_AVD_FAILED',
    });
  });
});

describe('avdName', () => {
  it('is a valid AVD name', () => {
    expect(avdName('Television (1080p)', '33', 'google-tv')).toBe(
      'dpad_Television__1080p__api33_google-tv',
    );
  });
});

describe('withFileLock', () => {
  it('serializes concurrent holders', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'dpad-lock-')), 'l');
    const order: string[] = [];
    const hold = (name: string) =>
      withFileLock(
        dir,
        async () => {
          order.push(`${name}+`);
          await new Promise((r) => setTimeout(r, 20));
          order.push(`${name}-`);
        },
        { pollMs: 5 },
      );
    await Promise.all([hold('a'), hold('b')]);
    expect(order).toEqual(['a+', 'a-', 'b+', 'b-']);
  });

  it('takes over a lock whose owner process is gone', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'dpad-lock-')), 'l');
    mkdirSync(dir);
    writeFileSync(join(dir, 'owner'), '999999');
    await expect(withFileLock(dir, async () => 'ok', { pollMs: 5, timeoutMs: 1000 })).resolves.toBe(
      'ok',
    );
  });
});
