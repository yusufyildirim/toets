import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppRuntime,
  createCommandDeviceProvider,
  createExternalDeviceProvider,
  docsLink,
  DpadError,
  type DeviceLease,
  type DeviceProvider,
  type Driver,
  type DriverModule,
  type MockServerLike,
} from '@dpad-tv/core';
import type { SdkHost } from '@dpad-tv/protocol';
import type { DeviceSelection, DpadOptions, DpadProjectConfig } from './config.js';
import { importUserModule } from './load.js';

export interface WorkerContext {
  readonly workerIndex: number;
  readonly parallelIndex: number;
  /** Directory module paths are resolved from (the config file's directory). */
  readonly configDir: string;
  /** This worker's artifacts directory. */
  readonly artifactsDir: string;
  readonly log: (message: string) => void;
}

function isDriverModule(value: unknown): value is DriverModule {
  const m = value as Partial<DriverModule> | undefined;
  return !!m && typeof m.createDriver === 'function' && typeof m.platform === 'string';
}

export async function loadDriverModule(
  config: DpadProjectConfig,
  configDir: string,
): Promise<DriverModule> {
  const mod = await importUserModule(config.driver, configDir, `${config.platform} driver`);
  const candidate = mod.default;
  if (!isDriverModule(candidate)) {
    throw new DpadError(
      'INVALID_DRIVER',
      `${config.driver} does not default-export a dpad DriverModule.`,
      {
        hint: 'A driver package must `export default { platform, createDriver }` (see DriverModule in @dpad-tv/core).',
        docs: docsLink('test/config'),
      },
    );
  }
  if (candidate.platform !== config.platform) {
    throw new DpadError(
      'INVALID_DRIVER',
      `${config.driver} drives ${candidate.platform}, but the project is ${config.platform}.`,
      { hint: 'Use the platform helper that matches the driver.', docs: docsLink('test/config') },
    );
  }
  return candidate;
}

function normalizeSelection(
  selection: DeviceSelection | undefined,
): Exclude<DeviceSelection, 'managed'> | undefined {
  return selection === 'managed' ? { mode: 'managed' } : selection;
}

/** Picks the device provider for a project, or `undefined` when the platform needs no device. */
export function selectDeviceProvider(
  config: DpadProjectConfig,
  module: DriverModule,
): DeviceProvider | undefined {
  const selection = normalizeSelection(config.devices);
  if (!selection) return module.createDeviceProvider?.(config.driverOptions);
  switch (selection.mode) {
    case 'managed': {
      const provider = module.createDeviceProvider?.(config.driverOptions);
      if (!provider) {
        throw new DpadError(
          'NO_MANAGED_DEVICES',
          `${config.driver} cannot manage ${config.platform} devices.`,
          {
            hint: "Use devices: { mode: 'external' } with running devices, or { mode: 'command' } with lease commands.",
            docs: docsLink('test/devices'),
          },
        );
      }
      return provider;
    }
    case 'external':
      return createExternalDeviceProvider(
        selection.addresses ? { addresses: selection.addresses } : {},
      );
    case 'command': {
      const { mode: _mode, ...opts } = selection;
      return createCommandDeviceProvider(opts);
    }
  }
}

async function createSdkHost(
  options: DpadOptions,
  configDir: string,
): Promise<SdkHost | undefined> {
  const sdk = options.sdk;
  if (!sdk) return undefined;
  const opts = typeof sdk === 'object' && sdk.port !== undefined ? { port: sdk.port } : {};
  if (typeof sdk === 'object' && sdk.createHost) return sdk.createHost(opts);
  for (const specifier of ['@dpad-tv/protocol/host', '@dpad-tv/protocol']) {
    let mod: Record<string, unknown>;
    try {
      mod = await importUserModule(specifier, configDir, 'SDK host');
    } catch {
      continue;
    }
    if (typeof mod.createSdkHost === 'function') {
      return (mod.createSdkHost as (o: { port?: number }) => Promise<SdkHost>)(opts);
    }
  }
  throw new DpadError('SDK_HOST_UNAVAILABLE', 'No dpad SDK host implementation was found.', {
    hint: 'Install a @dpad-tv/protocol version that exports createSdkHost, or pass dpad.sdk.createHost.',
    docs: docsLink('core/sdk'),
  });
}

async function createMock(
  options: DpadOptions,
  configDir: string,
): Promise<MockServerLike | undefined> {
  const mock = options.mock;
  if (!mock) return undefined;
  const opts = typeof mock === 'object' && mock.port !== undefined ? { port: mock.port } : {};
  if (typeof mock === 'object' && mock.createServer) return mock.createServer(opts);
  const mod = await importUserModule('@dpad-tv/mock', configDir, 'network mocking');
  if (typeof mod.createMockServer !== 'function') {
    throw new DpadError('MOCK_UNAVAILABLE', '@dpad-tv/mock does not export createMockServer.', {
      hint: 'Update @dpad-tv/mock to a version matching @dpad-tv/test.',
      docs: docsLink('core/network'),
    });
  }
  return (mod.createMockServer as (o: { port?: number }) => Promise<MockServerLike>)(opts);
}

/**
 * Everything one Playwright worker owns: device lease, driver session, mock server, SDK host
 * and the app runtime. Created on first use, torn down when the worker exits.
 */
export class DpadWorker {
  /** Identity of the serial group the last test belonged to (see `serialGroupOf`). */
  lastGroup: string | null = null;

  private constructor(
    readonly config: DpadProjectConfig,
    readonly runtime: AppRuntime,
    private readonly disposers: (() => Promise<void>)[],
  ) {}

  get driver(): Driver {
    return this.runtime.driver;
  }

  static async start(config: DpadProjectConfig, ctx: WorkerContext): Promise<DpadWorker> {
    const disposers: (() => Promise<void>)[] = [];
    try {
      await mkdir(ctx.artifactsDir, { recursive: true });
      const module = await loadDriverModule(config, ctx.configDir);

      const provider = selectDeviceProvider(config, module);
      let lease: DeviceLease | undefined;
      if (provider) {
        disposers.push(() => provider.dispose());
        lease = await provider.acquire(
          { ...config.device, platform: config.platform },
          { workerIndex: ctx.workerIndex, parallelIndex: ctx.parallelIndex },
        );
        const held = lease;
        disposers.push(() => held.release());
        ctx.log(`leased ${config.platform} device ${lease.address}`);
      }

      const driver = await module.createDriver(config.driverOptions, {
        app: config.app,
        ...(lease ? { device: lease } : {}),
        workerIndex: ctx.workerIndex,
        artifactsDir: ctx.artifactsDir,
        log: ctx.log,
      });
      disposers.push(() => driver.stop());
      await driver.start();

      const mock = await createMock(config.options, ctx.configDir);
      if (mock) disposers.push(() => mock.close());
      const sdkHost = await createSdkHost(config.options, ctx.configDir);
      if (sdkHost) disposers.push(() => sdkHost.close());

      const runtime = new AppRuntime({
        driver,
        sdkHost,
        mock,
        keyOverrides: config.options.keyOverrides,
        timeouts: config.options.timeouts,
        idle: config.options.idle,
        remote: config.options.remote,
        log: ctx.log,
      });
      disposers.push(() => runtime.dispose());
      return new DpadWorker(config, runtime, disposers);
    } catch (error) {
      await DpadWorker.dispose(disposers, ctx.log);
      throw error;
    }
  }

  private static async dispose(
    disposers: readonly (() => Promise<void>)[],
    log: (message: string) => void,
  ): Promise<void> {
    for (const dispose of [...disposers].reverse()) {
      try {
        await dispose();
      } catch (e) {
        log(`teardown step failed: ${String(e)}`);
      }
    }
  }

  async stop(log: (message: string) => void): Promise<void> {
    await DpadWorker.dispose(this.disposers, log);
  }
}

export function workerArtifactsDir(outputDir: string, workerIndex: number): string {
  return join(outputDir, '.dpad', `worker-${workerIndex}`);
}
