import { exec } from 'node:child_process';
import type { DeviceLease, DeviceProvider, DeviceSpec } from '../devices.js';
import { DpadError, packageDocsLink } from '../errors.js';

export interface CommandDevicesOptions {
  /**
   * Shell command that leases one device and prints JSON on its last stdout line:
   * `{ "address": "emulator-5554", "id"?: "lease-1", "meta"?: { ... }, "environment"?: { ... } }`.
   * `environment` (variables the device must be driven with) lands in `meta.environment`.
   * Receives `DPAD_PLATFORM`, `DPAD_WORKER_INDEX`, `DPAD_PARALLEL_INDEX`, `DPAD_DEVICE_SPEC` (JSON).
   */
  readonly acquire: string;
  /**
   * Shell command that returns the device. Receives the acquire variables plus `DPAD_DEVICE_ID`,
   * `DPAD_DEVICE_ADDRESS` and `DPAD_DEVICE_META` (JSON).
   */
  readonly release?: string;
  /** Default 600000 (booting a device can take minutes). */
  readonly acquireTimeoutMs?: number;
  /** Default 120000. */
  readonly releaseTimeoutMs?: number;
  readonly cwd?: string;
}

function run(
  command: string,
  env: Record<string, string>,
  timeoutMs: number,
  cwd: string | undefined,
): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      command,
      { env: { ...process.env, ...env }, timeout: timeoutMs, cwd, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stderr: String(stderr).trim() }));
        else resolve(String(stdout));
      },
    );
  });
}

function parseLease(stdout: string): {
  address: string;
  id?: string;
  meta?: Record<string, unknown>;
} {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1);
  let value: unknown;
  try {
    value = JSON.parse(line ?? '');
  } catch {
    value = undefined;
  }
  const v = value as
    { address?: unknown; id?: unknown; meta?: unknown; environment?: unknown } | undefined;
  if (!v || typeof v.address !== 'string' || !v.address) {
    throw new DpadError(
      'DEVICE_COMMAND_OUTPUT',
      `The device acquire command must print JSON with an "address" on its last line; got: ${line ?? '(nothing)'}`,
      {
        hint: 'Print e.g. {"address":"emulator-5554","id":"lease-1"} as the final stdout line.',
        docs: packageDocsLink('test', 'devices'),
      },
    );
  }
  const meta = v.meta && typeof v.meta === 'object' ? (v.meta as Record<string, unknown>) : {};
  const environment = isStringMap(v.environment) ? v.environment : undefined;
  return {
    address: v.address,
    ...(typeof v.id === 'string' ? { id: v.id } : {}),
    meta: environment
      ? { ...meta, environment: { ...(meta.environment as object | undefined), ...environment } }
      : meta,
  };
}

function isStringMap(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string')
  );
}

const commandError = (what: string, command: string, cause: unknown): DpadError => {
  const stderr = (cause as { stderr?: string }).stderr;
  return new DpadError(
    'DEVICE_COMMAND_FAILED',
    `The device ${what} command failed: ${command}${stderr ? `\n${stderr}` : ''}`,
    {
      hint: 'Run the command by hand with the same DPAD_* variables to debug it.',
      docs: packageDocsLink('test', 'devices'),
      cause,
    },
  );
};

/**
 * `command` device mode: shell commands lease and release devices. Integrates device farms and
 * lease brokers without dpad knowing them.
 */
export function createCommandDeviceProvider(opts: CommandDevicesOptions): DeviceProvider {
  const leases = new Set<DeviceLease>();
  return {
    async acquire(spec: DeviceSpec, { workerIndex, parallelIndex }): Promise<DeviceLease> {
      const baseEnv = {
        DPAD_PLATFORM: spec.platform,
        DPAD_WORKER_INDEX: String(workerIndex),
        DPAD_PARALLEL_INDEX: String(parallelIndex),
        DPAD_DEVICE_SPEC: JSON.stringify(spec),
      };
      let stdout: string;
      try {
        stdout = await run(opts.acquire, baseEnv, opts.acquireTimeoutMs ?? 600_000, opts.cwd);
      } catch (cause) {
        throw commandError('acquire', opts.acquire, cause);
      }
      const parsed = parseLease(stdout);
      const meta = parsed.meta ?? {};
      let released = false;
      const lease: DeviceLease = {
        id: parsed.id ?? parsed.address,
        platform: spec.platform,
        address: parsed.address,
        meta,
        release: async () => {
          if (released) return;
          released = true;
          leases.delete(lease);
          if (!opts.release) return;
          const env = {
            ...baseEnv,
            DPAD_DEVICE_ID: lease.id,
            DPAD_DEVICE_ADDRESS: lease.address,
            DPAD_DEVICE_META: JSON.stringify(meta),
          };
          try {
            await run(opts.release, env, opts.releaseTimeoutMs ?? 120_000, opts.cwd);
          } catch (cause) {
            throw commandError('release', opts.release, cause);
          }
        },
      };
      leases.add(lease);
      return lease;
    },
    async dispose() {
      await Promise.allSettled([...leases].map((l) => l.release()));
    },
  };
}
