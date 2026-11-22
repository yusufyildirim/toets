import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppRuntime,
  createCommandDeviceProvider,
  createExternalDeviceProvider,
  packageDocsLink,
  DpadError,
  type DeviceLease,
  type DeviceProvider,
  type Driver,
  type DriverModule,
  type MockServerLike,
} from '@dpad-tv/core';
import { createMockServer } from '@dpad-tv/mock';
import type { SdkHost } from '@dpad-tv/protocol';
import { createSdkHost } from '@dpad-tv/protocol/host';
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
        docs: packageDocsLink('test', 'config'),
      },
    );
  }
  if (candidate.platform !== config.platform) {
    throw new DpadError(
      'INVALID_DRIVER',
      `${config.driver} drives ${candidate.platform}, but the project is ${config.platform}.`,
      {
        hint: 'Use the platform helper that matches the driver.',
        docs: packageDocsLink('test', 'config'),
      },
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
            docs: packageDocsLink('test', 'devices'),
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

/** The worker's SDK host: `createSdkHost` from `@dpad-tv/protocol/host` unless overridden. */
async function startSdkHost(
  options: DpadOptions,
  log: (m: string) => void,
): Promise<SdkHost | undefined> {
  const sdk = options.sdk;
  if (!sdk) return undefined;
  const port = typeof sdk === 'object' ? sdk.port : undefined;
  const opts = port === undefined ? {} : { port };
  if (typeof sdk === 'object' && sdk.createHost) return sdk.createHost(opts);
  return createSdkHost({
    ...opts,
    onEvent: (e) => {
      if (e.type === 'rejected') log(`SDK host rejected a connection (${e.reason}): ${e.message}`);
      else if (e.type === 'session') log(`SDK connected: ${e.hello.sdk} (${e.hello.framework})`);
      else if (e.type === 'session-closed') log(`SDK session closed: ${e.code} ${e.reason}`);
    },
  });
}

/** The worker's mock server: `createMockServer` from `@dpad-tv/mock` unless overridden. */
async function startMockServer(options: DpadOptions): Promise<MockServerLike | undefined> {
  const mock = options.mock;
  if (!mock) return undefined;
  const port = typeof mock === 'object' ? mock.port : undefined;
  const opts = port === undefined ? {} : { port };
  if (typeof mock === 'object' && mock.createServer) return mock.createServer(opts);
  return createMockServer(opts);
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
        configDir: ctx.configDir,
        ...(lease ? { device: lease } : {}),
        workerIndex: ctx.workerIndex,
        artifactsDir: ctx.artifactsDir,
        log: ctx.log,
      });
      disposers.push(() => driver.stop());
      await driver.start();

      const mock = await startMockServer(config.options);
      if (mock) disposers.push(() => mock.close());
      const sdkHost = await startSdkHost(config.options, ctx.log);
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
