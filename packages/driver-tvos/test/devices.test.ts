import type { DeviceLease } from '@dpad-tv/core';
import { describe, expect, it } from 'vitest';
import {
  createManagedDeviceProvider,
  deviceSetFromLease,
  pickRuntime,
  prepareSimulator,
  versionMatches,
} from '../src/devices.js';
import {
  ATV_1080P,
  ATV_4K,
  DEVICE_TYPES_JSON,
  FakeRunner,
  TVOS_RUNTIME,
  devicesJson,
  runtimesJson,
} from './helpers.js';

function managedRunner(devices: Parameters<typeof devicesJson>[0] = {}) {
  return new FakeRunner()
    .on('list devicetypes', { stdout: DEVICE_TYPES_JSON })
    .on('list runtimes', {
      stdout: runtimesJson([
        { version: '18.4' },
        { version: '27.2' },
        {
          version: '26.3',
          platform: 'iOS',
          identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-3',
        },
      ]),
    })
    .on('list devices', { stdout: devicesJson(devices) })
    .on(' create ', { stdout: 'NEW-UDID\n' });
}

describe('managed device provider', () => {
  it('creates and boots one simulator per worker on the newest tvOS runtime', async () => {
    const runner = managedRunner();
    const provider = createManagedDeviceProvider({}, { runner });
    const lease = await provider.acquire({ platform: 'tvos' }, { workerIndex: 2 });

    const name = 'dpad-apple-tv-4k-3rd-generation-at-1080p-27.2-w2';
    expect(runner.lines()).toContain(`xcrun simctl create ${name} ${ATV_1080P} ${TVOS_RUNTIME}`);
    expect(runner.lines()).toContain('xcrun simctl bootstatus NEW-UDID -b');
    expect(lease).toMatchObject({
      id: 'tvos:NEW-UDID',
      platform: 'tvos',
      address: 'NEW-UDID',
      meta: {
        name,
        model: 'Apple TV 4K (3rd generation) (at 1080p)',
        osVersion: '27.2',
        runtimeId: TVOS_RUNTIME,
      },
    });
  });

  it('reuses an existing simulator and leaves one it did not boot running', async () => {
    const name = 'dpad-apple-tv-4k-3rd-generation-at-1080p-27.2-w0';
    const runner = managedRunner({ [TVOS_RUNTIME]: [{ udid: 'OLD', name, state: 'Booted' }] });
    const provider = createManagedDeviceProvider({}, { runner });
    const lease = await provider.acquire({ platform: 'tvos' }, { workerIndex: 0 });
    await lease.release();
    await provider.dispose();

    expect(lease.address).toBe('OLD');
    expect(runner.lines().some((l) => l.includes('simctl create'))).toBe(false);
    expect(runner.lines().some((l) => l.includes('simctl shutdown'))).toBe(false);
  });

  it('shuts down simulators it booted on dispose unless keepBooted', async () => {
    const runner = managedRunner();
    const provider = createManagedDeviceProvider({}, { runner });
    await provider.acquire({ platform: 'tvos' }, { workerIndex: 0 });
    await provider.dispose();
    expect(runner.lines()).toContain('xcrun simctl shutdown NEW-UDID');

    const keep = managedRunner();
    const kept = createManagedDeviceProvider({ keepBooted: true }, { runner: keep });
    await kept.acquire({ platform: 'tvos' }, { workerIndex: 0 });
    await kept.dispose();
    expect(keep.lines().some((l) => l.includes('shutdown'))).toBe(false);
  });

  it('honors model, osVersion and a custom device set', async () => {
    const runner = managedRunner();
    const provider = createManagedDeviceProvider(
      { deviceSet: '/sets/dpad', namePrefix: 'ci' },
      { runner },
    );
    const lease = await provider.acquire(
      { platform: 'tvos', model: 'Apple TV 4K (3rd generation)', osVersion: '18' },
      { workerIndex: 1 },
    );
    expect(runner.lines()).toContain(
      `xcrun simctl --set /sets/dpad create ci-apple-tv-4k-3rd-generation-18.4-w1 ${ATV_4K} com.apple.CoreSimulator.SimRuntime.tvOS-18-4`,
    );
    expect(lease.meta.deviceSet).toBe('/sets/dpad');
  });

  it('explains a missing runtime or model', async () => {
    const provider = createManagedDeviceProvider({}, { runner: managedRunner() });
    await expect(
      provider.acquire({ platform: 'tvos', osVersion: '19' }, { workerIndex: 0 }),
    ).rejects.toMatchObject({
      code: 'TVOS_RUNTIME_MISSING',
      message: expect.stringContaining('installed: 27.2, 18.4'),
      hint: expect.stringContaining('xcodebuild -downloadPlatform tvOS'),
    });
    await expect(
      provider.acquire({ platform: 'tvos', model: 'Apple TV 9' }, { workerIndex: 0 }),
    ).rejects.toMatchObject({
      code: 'TVOS_DEVICE_TYPE_MISSING',
      hint: expect.stringContaining('Apple TV 4K (3rd generation) (at 1080p)'),
    });
  });

  it('reports a failed boot with a timeout hint', async () => {
    const runner = managedRunner().on('xcrun simctl bootstatus', { exitCode: 1, stderr: 'boom' });
    const provider = createManagedDeviceProvider({ bootTimeoutMs: 5 }, { runner });
    await expect(provider.acquire({ platform: 'tvos' }, { workerIndex: 0 })).rejects.toMatchObject({
      code: 'TVOS_BOOT_FAILED',
      hint: expect.stringContaining('5ms'),
    });
    expect(runner.calls.find((c) => c.args.includes('bootstatus'))?.opts).toEqual({ timeoutMs: 5 });
  });
});

describe('prepareSimulator', () => {
  const devices = devicesJson({
    [TVOS_RUNTIME]: [{ udid: 'TV-1', name: 'Apple TV', state: 'Shutdown' }],
    'com.apple.CoreSimulator.SimRuntime.iOS-27-2': [
      { udid: 'PHONE', name: 'iPhone 17', state: 'Booted' },
    ],
  });

  it('boots a shut down tvOS simulator and describes it', async () => {
    const runner = new FakeRunner().on('xcrun simctl --set /set list devices', { stdout: devices });
    const sim = await prepareSimulator('tv-1', { deviceSet: '/set', runner });
    expect(sim).toEqual({
      udid: 'TV-1',
      name: 'Apple TV',
      runtimeId: TVOS_RUNTIME,
      osVersion: '27.2',
      deviceSet: '/set',
    });
    expect(runner.lines()).toContain('xcrun simctl --set /set bootstatus TV-1 -b');
  });

  it('rejects unknown and non-tvOS simulators', async () => {
    const runner = new FakeRunner().on('xcrun simctl list devices', { stdout: devices });
    await expect(prepareSimulator('NOPE', { runner })).rejects.toMatchObject({
      code: 'TVOS_SIMULATOR_NOT_FOUND',
    });
    await expect(prepareSimulator('PHONE', { runner })).rejects.toMatchObject({
      code: 'TVOS_NOT_A_TVOS_SIMULATOR',
    });
  });

  it('surfaces simctl failures', async () => {
    const runner = new FakeRunner().on('xcrun simctl list devices', {
      exitCode: 72,
      stderr: 'xcrun: error: unable to find utility "simctl"',
    });
    await expect(prepareSimulator('TV-1', { runner })).rejects.toMatchObject({
      code: 'TVOS_SIMCTL_FAILED',
      message: expect.stringContaining('unable to find utility'),
    });
  });
});

describe('helpers', () => {
  const lease = (meta: Record<string, unknown>): DeviceLease => ({
    id: 'x',
    platform: 'tvos',
    address: 'udid',
    meta,
    release: async () => {},
  });

  it('reads the device set from lease meta or a simlock environment', () => {
    expect(deviceSetFromLease(undefined)).toBeUndefined();
    expect(deviceSetFromLease(lease({}))).toBeUndefined();
    expect(deviceSetFromLease(lease({ deviceSet: '/a' }))).toBe('/a');
    expect(deviceSetFromLease(lease({ environment: { SIMLOCK_IOS_DEVICE_SET: '/b' } }))).toBe('/b');
  });

  it('matches version prefixes by segment', () => {
    expect(versionMatches('18.4', '18')).toBe(true);
    expect(versionMatches('18.4.1', '18.4')).toBe(true);
    expect(versionMatches('18.40', '18.4')).toBe(false);
    expect(versionMatches('1.8', '18')).toBe(false);
  });

  it('ignores unavailable runtimes', () => {
    const runtimes = JSON.parse(
      runtimesJson([{ version: '27.2', isAvailable: false }, { version: '18.4' }]),
    ).runtimes;
    const mapped = runtimes.map(
      (r: { identifier: string; name: string; version: string; isAvailable: boolean }) => ({
        ...r,
        platform: 'tvOS',
        supportedDeviceTypeIds: undefined,
      }),
    );
    expect(pickRuntime(mapped).version).toBe('18.4');
  });
});
