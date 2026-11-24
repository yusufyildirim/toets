import type { Platform } from './platform.js';

/** What kind of device a project needs. Driver-specific fields are allowed. */
export interface DeviceSpec {
  readonly platform: Platform;
  /** e.g. `tv_1080p`, `Apple TV 4K (3rd generation)` */
  readonly model?: string;
  /** e.g. `34`, `18.0` */
  readonly osVersion?: string;
  readonly [key: string]: unknown;
}

/** A device held exclusively by one worker until released. */
export interface DeviceLease {
  readonly id: string;
  readonly platform: Platform;
  /** Android serial (e.g. `emulator-5554`) or simulator UDID. */
  readonly address: string;
  /**
   * Provider data. `meta.environment` (string map) holds variables the device must be driven
   * with, e.g. a lease broker's `ANDROID_ADB_SERVER_PORT` or `SIMLOCK_IOS_DEVICE_SET`.
   */
  readonly meta: Readonly<Record<string, unknown>>;
  release(): Promise<void>;
}

/** The string entries of `lease.meta.environment`; empty without a lease or environment. */
export function leaseEnvironment(lease: DeviceLease | undefined): Readonly<Record<string, string>> {
  const env = lease?.meta.environment;
  if (!env || typeof env !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) if (typeof value === 'string') out[name] = value;
  return out;
}

export interface DeviceAcquireOptions {
  /** Unique per worker process; grows when Playwright restarts a worker after a failure. */
  readonly workerIndex: number;
  /**
   * Stable slot `0..workers-1`, reused by the replacement of a restarted worker. Use it to pick
   * an exclusive device (e.g. the n-th address or AVD) without cross-process coordination.
   */
  readonly parallelIndex: number;
}

/**
 * Supplies devices to workers. One provider instance lives in each worker process. Built-in kinds:
 * - `managed`: toets creates, boots, snapshots and resets emulators/simulators itself.
 * - `external`: the user supplies addresses (e.g. `TOETS_DEVICES=emulator-5554,emulator-5556`).
 * - `command`: shell commands lease and release devices and print JSON (integrates device farms
 *   and lease brokers).
 */
export interface DeviceProvider {
  acquire(spec: DeviceSpec, opts: DeviceAcquireOptions): Promise<DeviceLease>;
  dispose(): Promise<void>;
}
