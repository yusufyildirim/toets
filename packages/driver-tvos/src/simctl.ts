import type { ChildProcess } from 'node:child_process';
import { defaultRunner, tail, type CommandRunner } from './command.js';
import { DOCS, TvosErrorCode, tvosError } from './errors.js';

export interface SimDevice {
  readonly udid: string;
  readonly name: string;
  /** e.g. `Booted`, `Shutdown`, `Booting`. */
  readonly state: string;
  readonly isAvailable: boolean;
  readonly runtimeId: string;
  readonly deviceTypeId: string | undefined;
}

export interface SimDeviceType {
  readonly name: string;
  readonly identifier: string;
  readonly productFamily: string | undefined;
}

export interface SimRuntime {
  readonly identifier: string;
  readonly name: string;
  readonly version: string;
  readonly platform: string;
  readonly isAvailable: boolean;
  readonly supportedDeviceTypeIds: readonly string[] | undefined;
}

/**
 * Thin, typed wrapper over `xcrun simctl`. `deviceSet` targets a custom CoreSimulator device
 * set (`simctl --set <path>`) such as one owned by a lease broker.
 */
export class Simctl {
  constructor(
    readonly deviceSet: string | undefined = undefined,
    private readonly runner: CommandRunner = defaultRunner,
  ) {}

  /** Full argument list for `xcrun`, including the device set. */
  args(subcommand: readonly string[]): string[] {
    return ['simctl', ...(this.deviceSet ? ['--set', this.deviceSet] : []), ...subcommand];
  }

  async exec(subcommand: readonly string[], timeoutMs?: number): Promise<string> {
    const res = await this.runner.run(
      'xcrun',
      this.args(subcommand),
      timeoutMs === undefined ? {} : { timeoutMs },
    );
    if (res.exitCode !== 0) {
      throw tvosError(
        TvosErrorCode.SIMCTL_FAILED,
        `\`xcrun ${this.args(subcommand).join(' ')}\` failed (exit ${res.exitCode}):\n${tail(res.stderr || res.stdout)}`,
        {
          hint: 'Check that Xcode and its command line tools are selected (`xcode-select -p`) and that the simulator exists in the device set toets uses.',
          docs: DOCS.simulators,
        },
      );
    }
    return res.stdout;
  }

  async listDevices(): Promise<SimDevice[]> {
    const json = parseJson<{ devices?: Record<string, RawDevice[]> }>(
      await this.exec(['list', 'devices', '--json']),
    );
    const out: SimDevice[] = [];
    for (const [runtimeId, devices] of Object.entries(json.devices ?? {})) {
      for (const d of devices) {
        out.push({
          udid: d.udid,
          name: d.name,
          state: d.state,
          isAvailable: d.isAvailable !== false,
          runtimeId,
          deviceTypeId: d.deviceTypeIdentifier,
        });
      }
    }
    return out;
  }

  async listDeviceTypes(): Promise<SimDeviceType[]> {
    const json = parseJson<{ devicetypes?: RawDeviceType[] }>(
      await this.exec(['list', 'devicetypes', '--json']),
    );
    return (json.devicetypes ?? []).map((t) => ({
      name: t.name,
      identifier: t.identifier,
      productFamily: t.productFamily,
    }));
  }

  async listRuntimes(): Promise<SimRuntime[]> {
    const json = parseJson<{ runtimes?: RawRuntime[] }>(
      await this.exec(['list', 'runtimes', '--json']),
    );
    return (json.runtimes ?? []).map((r) => ({
      identifier: r.identifier,
      name: r.name,
      version: r.version,
      platform: r.platform ?? platformFromRuntimeId(r.identifier) ?? 'unknown',
      isAvailable: r.isAvailable !== false,
      supportedDeviceTypeIds: r.supportedDeviceTypes?.map((t) => t.identifier),
    }));
  }

  /** Creates a simulator and returns its UDID. */
  async create(name: string, deviceTypeId: string, runtimeId: string): Promise<string> {
    return (await this.exec(['create', name, deviceTypeId, runtimeId])).trim();
  }

  /** Boots the simulator if needed and waits until it finished booting. */
  async bootAndWait(udid: string, timeoutMs: number): Promise<void> {
    await this.exec(['bootstatus', udid, '-b'], timeoutMs);
  }

  async shutdown(udid: string): Promise<void> {
    await this.exec(['shutdown', udid]);
  }

  /** Path of an installed app's bundle, or `null` when the app is not installed. */
  async appBundlePath(udid: string, bundleId: string): Promise<string | null> {
    const res = await this.runner.run(
      'xcrun',
      this.args(['get_app_container', udid, bundleId, 'app']),
    );
    return res.exitCode === 0 ? res.stdout.trim() || null : null;
  }

  /** Starts a long-running `simctl` process (log stream, screen recording). */
  spawn(subcommand: readonly string[]): ChildProcess {
    return this.runner.spawn('xcrun', this.args(subcommand));
  }
}

/** `com.apple.CoreSimulator.SimRuntime.tvOS-27-2` -> `tvOS`. */
export function platformFromRuntimeId(runtimeId: string): string | undefined {
  return /SimRuntime\.([A-Za-z]+)-/.exec(runtimeId)?.[1];
}

/** `com.apple.CoreSimulator.SimRuntime.tvOS-27-2` -> `27.2`. */
export function versionFromRuntimeId(runtimeId: string): string | undefined {
  return /SimRuntime\.[A-Za-z]+-([\d-]+)$/.exec(runtimeId)?.[1]?.replaceAll('-', '.');
}

export function isTvosRuntime(runtimeId: string): boolean {
  return platformFromRuntimeId(runtimeId) === 'tvOS';
}

interface RawDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable?: boolean;
  deviceTypeIdentifier?: string;
}

interface RawDeviceType {
  name: string;
  identifier: string;
  productFamily?: string;
}

interface RawRuntime {
  identifier: string;
  name: string;
  version: string;
  platform?: string;
  isAvailable?: boolean;
  supportedDeviceTypes?: { identifier: string }[];
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw tvosError(TvosErrorCode.SIMCTL_FAILED, 'simctl printed output that is not JSON.', {
      hint: 'Update Xcode; toets needs `simctl list --json`.',
      cause,
    });
  }
}
