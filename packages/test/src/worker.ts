import { join } from 'node:path';
import type { AppRuntime, Driver } from '@dpad-tv/core';
import { RunningTarget } from '@dpad-tv/core/runner';
import { mockServerFactory } from '@dpad-tv/mock';
import type { DpadProjectConfig } from './config.js';

export interface WorkerContext {
  readonly workerIndex: number;
  readonly parallelIndex: number;
  /** Directory module paths are resolved from (the config file's directory). */
  readonly configDir: string;
  /** This worker's artifacts directory. */
  readonly artifactsDir: string;
  readonly log: (message: string) => void;
}

/**
 * Everything one Playwright worker owns: the running target (device lease, driver session, mock
 * server, SDK host, app runtime; see `RunningTarget` in `@dpad-tv/core/runner`) plus the serial
 * group bookkeeping. Created on first use, torn down when the worker exits.
 */
export class DpadWorker {
  /** Identity of the serial group the last test belonged to (see `serialGroupOf`). */
  lastGroup: string | null = null;

  private constructor(
    readonly config: DpadProjectConfig,
    private readonly target: RunningTarget,
  ) {}

  get runtime(): AppRuntime {
    return this.target.runtime;
  }

  get driver(): Driver {
    return this.target.driver;
  }

  static async start(config: DpadProjectConfig, ctx: WorkerContext): Promise<DpadWorker> {
    const target = await RunningTarget.start(
      {
        platform: config.platform,
        driver: config.driver,
        driverOptions: config.driverOptions,
        app: config.app,
        device: config.device,
        ...(config.devices === undefined ? {} : { devices: config.devices }),
        options: config.options,
      },
      { ...ctx, createMockServer: mockServerFactory },
    );
    return new DpadWorker(config, target);
  }

  async stop(log: (message: string) => void): Promise<void> {
    await this.target.stop(log);
  }
}

export function workerArtifactsDir(outputDir: string, workerIndex: number): string {
  return join(outputDir, '.dpad', `worker-${workerIndex}`);
}
