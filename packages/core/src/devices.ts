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
  readonly meta: Readonly<Record<string, unknown>>;
  release(): Promise<void>;
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
 * - `managed`: dpad creates, boots, snapshots and resets emulators/simulators itself.
 * - `external`: the user supplies addresses (e.g. `DPAD_DEVICES=emulator-5554,emulator-5556`).
 * - `command`: shell commands lease and release devices and print JSON (integrates device farms
 *   and lease brokers).
 */
export interface DeviceProvider {
  acquire(spec: DeviceSpec, opts: DeviceAcquireOptions): Promise<DeviceLease>;
  dispose(): Promise<void>;
}
