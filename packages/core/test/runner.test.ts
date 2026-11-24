import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ToetsError, Key, type DriverModule } from '../src/index.js';
import {
  describeKeyOverride,
  importUserModule,
  loadDriverModule,
  mergeRuntimeConfig,
  RunningTarget,
  selectDeviceProvider,
  type TargetContext,
} from '../src/runner/index.js';
import { FakeMockServer, FakeSdkHost } from '../src/testing/index.js';
import { created } from './runner-fixtures/fake-driver.js';

const fixtures = fileURLToPath(new URL('./runner-fixtures', import.meta.url));

async function toetsError(promise: Promise<unknown>): Promise<ToetsError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ToetsError);
  return error as ToetsError;
}

const fakeModule = (platform: DriverModule['platform'], withProvider = false): DriverModule => ({
  platform,
  createDriver: () => Promise.reject(new Error('unused')),
  ...(withProvider
    ? {
        createDeviceProvider: () => ({
          acquire: () => Promise.reject(new Error('unused')),
          dispose: () => Promise.resolve(),
        }),
      }
    : {}),
});

const ctx = (over: Partial<TargetContext> = {}): TargetContext => ({
  workerIndex: 0,
  parallelIndex: 0,
  configDir: fixtures,
  artifactsDir: join(mkdtempSync(join(tmpdir(), 'toets-runner-')), 'w0'),
  log: () => {},
  ...over,
});

describe('importUserModule', () => {
  it('names the missing package and how to install it', async () => {
    const error = await toetsError(importUserModule('@toets/driver-nope', fixtures, 'web driver'));
    expect(error.code).toBe('MODULE_NOT_FOUND');
    expect(error.message).toContain('Cannot find @toets/driver-nope (web driver).');
    expect(error.hint).toContain('npm install -D @toets/driver-nope');
  });

  it('resolves paths from the config directory', async () => {
    const error = await toetsError(importUserModule('./missing.js', fixtures, 'web driver'));
    expect(error.hint).toContain(`config directory (${fixtures})`);
  });
});

describe('loadDriverModule', () => {
  it('loads a driver module by path or takes the module itself', async () => {
    expect((await loadDriverModule('./fake-driver.ts', fixtures, 'web')).platform).toBe('web');
    const module = fakeModule('tvos');
    expect(await loadDriverModule(module, fixtures)).toBe(module);
  });

  it('rejects modules for another platform', async () => {
    const error = await toetsError(loadDriverModule('./fake-driver.ts', fixtures, 'tvos'));
    expect(error.code).toBe('INVALID_DRIVER');
    expect(error.message).toContain('drives web, but the project is tvos');
  });

  it('rejects modules without a DriverModule default export', async () => {
    const error = await toetsError(loadDriverModule('./not-a-driver.ts', fixtures));
    expect(error.code).toBe('INVALID_DRIVER');
  });
});

describe('selectDeviceProvider', () => {
  it('uses the driver provider by default and needs none for web', () => {
    expect(selectDeviceProvider(undefined, fakeModule('web'))).toBeUndefined();
    expect(selectDeviceProvider(undefined, fakeModule('tvos', true))).toBeDefined();
  });

  it('fails when managed devices are requested from a driver without a provider', () => {
    expect(() => selectDeviceProvider('managed', fakeModule('tvos'))).toThrow(
      expect.objectContaining({ code: 'NO_MANAGED_DEVICES' }),
    );
  });

  it('builds external and command providers', async () => {
    const external = selectDeviceProvider(
      { mode: 'external', addresses: ['UDID-1'] },
      fakeModule('tvos', true),
    );
    const lease = await external?.acquire(
      { platform: 'tvos' },
      { workerIndex: 3, parallelIndex: 0 },
    );
    expect(lease?.address).toBe('UDID-1');

    const command = selectDeviceProvider(
      { mode: 'command', acquire: `echo '{"address":"emulator-'$TOETS_PARALLEL_INDEX'"}'` },
      fakeModule('android-tv'),
    );
    const leased = await command?.acquire(
      { platform: 'android-tv' },
      { workerIndex: 5, parallelIndex: 2 },
    );
    expect(leased?.address).toBe('emulator-2');
    await leased?.release();
  });
});

describe('mergeRuntimeConfig', () => {
  it('merges option groups key by key', () => {
    expect(
      mergeRuntimeConfig(
        { sdk: true, timeouts: { actionMs: 1 }, keyOverrides: { PLAY: { as: 'PLAY_PAUSE' } } },
        {
          mock: true,
          timeouts: { sdkConnectMs: 2 },
          keyOverrides: { PAUSE: { as: 'PLAY_PAUSE' } },
        },
      ),
    ).toEqual({
      sdk: true,
      mock: true,
      timeouts: { actionMs: 1, sdkConnectMs: 2 },
      keyOverrides: { PLAY: { as: 'PLAY_PAUSE' }, PAUSE: { as: 'PLAY_PAUSE' } },
      idle: {},
      remote: {},
    });
  });
});

describe('mergeRuntimeConfig sdk and mock settings', () => {
  const handlers = ['baseline'];

  it('merges settings key by key', () => {
    expect(
      mergeRuntimeConfig(
        { mock: { handlers, port: 1 } },
        { mock: { onUnhandledRequest: 'reject' } },
      ).mock,
    ).toEqual({ handlers, port: 1, onUnhandledRequest: 'reject' });
  });

  it('keeps the shared settings for `true` and turns off for `false`', () => {
    expect(mergeRuntimeConfig({ mock: { handlers } }, { mock: true }).mock).toEqual({ handlers });
    expect(mergeRuntimeConfig({ mock: { handlers } }, { mock: false }).mock).toBe(false);
    expect(mergeRuntimeConfig({ sdk: { port: 3 } }, {}).sdk).toEqual({ port: 3 });
    expect(mergeRuntimeConfig({}, { sdk: true }).sdk).toBe(true);
    expect('mock' in mergeRuntimeConfig({}, {})).toBe(false);
  });
});

describe('RunningTarget', () => {
  it('passes the mock settings to the server factory', async () => {
    const seen: unknown[] = [];
    const target = await RunningTarget.start(
      {
        driver: './fake-driver.ts',
        options: {
          mock: { handlers: ['baseline'], onUnhandledRequest: 'reject' },
        },
      },
      ctx({
        createMockServer: async (opts) => {
          seen.push(opts);
          return new FakeMockServer();
        },
      }),
    );
    await target.stop(() => {});
    expect(seen).toEqual([{ handlers: ['baseline'], onUnhandledRequest: 'reject' }]);
  });

  it('starts driver, mock and SDK host, and stops them', async () => {
    let mock: FakeMockServer | undefined;
    let host: FakeSdkHost | undefined;
    const target = await RunningTarget.start(
      {
        driver: './fake-driver.ts',
        options: {
          mock: true,
          sdk: {
            createHost: async () => {
              if (!created.driver) throw new Error('driver must exist before the SDK host');
              return (host = new FakeSdkHost(created.driver));
            },
          },
          keyOverrides: { PLAY: { as: 'PLAY_PAUSE' } },
        },
      },
      ctx({ createMockServer: async () => (mock = new FakeMockServer()) }),
    );
    expect(target.driver).toBe(created.driver);
    expect(created.driver?.started).toBe(true);
    expect(target.runtime.mock).toBe(mock);
    expect(target.runtime.sdkHost).toBe(host);
    expect(target.runtime.keyOverrides).toEqual({ PLAY: { as: 'PLAY_PAUSE' } });
    expect(target.runtime.declaredCapabilities.has('network.mock')).toBe(true);
    expect(target.runtime.declaredCapabilities.has('sync.idle')).toBe(true);
    await target.stop(() => {});
    expect(created.driver?.stopped).toBe(true);
    expect(mock?.closed).toBe(true);
    expect(host?.closedHost).toBe(true);
  });

  it('runs the real SDK host by default', async () => {
    const target = await RunningTarget.start(
      { driver: './fake-driver.ts', options: { sdk: true } },
      ctx(),
    );
    try {
      expect(target.runtime.sdkHost?.url).toMatch(/^ws:\/\/localhost:\d+$/);
      expect(target.runtime.sdkHost?.issueToken()).toEqual(expect.any(String));
    } finally {
      await target.stop(() => {});
    }
  });

  it('explains mocking without a mock server factory', async () => {
    const error = await toetsError(
      RunningTarget.start({ driver: './fake-driver.ts', options: { mock: true } }, ctx()),
    );
    expect(error.code).toBe('MOCK_UNAVAILABLE');
    expect(created.driver?.stopped).toBe(true);
  });

  it('tears down what it started when a later step fails', async () => {
    let mock: FakeMockServer | undefined;
    await expect(
      RunningTarget.start(
        {
          driver: './fake-driver.ts',
          options: {
            mock: { createServer: async () => (mock = new FakeMockServer()) },
            sdk: { createHost: () => Promise.reject(new Error('port in use')) },
          },
        },
        ctx(),
      ),
    ).rejects.toThrow('port in use');
    expect(created.driver?.stopped).toBe(true);
    expect(mock?.closed).toBe(true);
  });
});

describe('formatting helpers', () => {
  it('describes key overrides like the remote step titles', () => {
    expect(describeKeyOverride({ as: Key.RIGHT, holdMs: 800 })).toBe('hold RIGHT 800ms');
    expect(describeKeyOverride({ as: Key.SELECT })).toBe('press SELECT');
  });
});
