import {
  leaseEnvironment,
  type DeviceLease,
  type DeviceProvider,
  type DeviceSpec,
} from '@toets/core';
import { defaultRunner, type CommandRunner } from './command.js';
import { DOCS, TvosErrorCode, tvosError } from './errors.js';
import {
  Simctl,
  isTvosRuntime,
  versionFromRuntimeId,
  type SimDeviceType,
  type SimRuntime,
} from './simctl.js';

/**
 * Models tried in order when the spec names none. The 1080p variant keeps screenshots and
 * videos at 1920x1080 (same as the point size), which is faster to capture and diff.
 */
export const DEFAULT_TVOS_MODELS: readonly string[] = [
  'Apple TV 4K (3rd generation) (at 1080p)',
  'Apple TV 4K (3rd generation)',
];

const DEFAULT_BOOT_TIMEOUT_MS = 300_000;

/** Options of the `managed` device provider. */
export interface TvosManagedDeviceOptions {
  /** CoreSimulator device set to create simulators in. Default: Xcode's default set. */
  readonly deviceSet?: string;
  /** Keep simulators booted after the run for faster local iterations. Default `false`. */
  readonly keepBooted?: boolean;
  /** Maximum time to boot one simulator. Default 300000 (cold boots on CI are slow). */
  readonly bootTimeoutMs?: number;
  /**
   * Prefix of the simulator names toets creates and reuses, e.g. `toets-ci` to keep a second
   * checkout's simulators apart. Must start with `toets`: the provider only ever touches
   * simulators named so. Default `toets`.
   */
  readonly namePrefix?: string;
}

/** A tvOS simulator that is booted and ready for a session. */
export interface TvosSimulator {
  readonly udid: string;
  readonly name: string;
  readonly runtimeId: string;
  /** tvOS version, e.g. `27.2`. */
  readonly osVersion: string;
  readonly deviceSet: string | undefined;
}

/**
 * The `managed` provider: creates (once) and boots one Apple TV simulator per worker, named
 * `<prefix>-<model>-<os>-w<parallelIndex>`, and reuses it on later runs. `spec.model` is an
 * exact simulator device type name; `spec.osVersion` a tvOS version prefix (`18` matches
 * `18.4`). The newest matching runtime wins.
 */
export function createManagedDeviceProvider(
  options: TvosManagedDeviceOptions = {},
  deps: { readonly runner?: CommandRunner } = {},
): DeviceProvider {
  const simctl = new Simctl(options.deviceSet, deps.runner ?? defaultRunner);
  const bootTimeoutMs = options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
  const prefix = options.namePrefix ?? 'toets';
  if (!/^toets(-|$)/.test(prefix)) {
    throw tvosError(
      TvosErrorCode.CONFIG,
      `managed.namePrefix "${prefix}" does not start with "toets".`,
      {
        hint: `Use e.g. "toets-${slug(prefix) || 'ci'}": toets only creates and reuses simulators named toets-*.`,
        docs: DOCS.simulators,
      },
    );
  }
  const bootedByUs = new Set<string>();

  return {
    async acquire(spec: DeviceSpec, { parallelIndex }): Promise<DeviceLease> {
      const [types, runtimes, devices] = await Promise.all([
        simctl.listDeviceTypes(),
        simctl.listRuntimes(),
        simctl.listDevices(),
      ]);
      const runtime = pickRuntime(runtimes, spec.osVersion);
      const type = pickDeviceType(types, runtime, spec.model);
      const name = `${prefix}-${slug(type.name)}-${runtime.version}-w${parallelIndex}`;
      const existing = devices.find(
        (d) => d.name === name && d.runtimeId === runtime.identifier && d.isAvailable,
      );
      const udid =
        existing?.udid ?? (await simctl.create(name, type.identifier, runtime.identifier));
      if (existing?.state !== 'Booted') bootedByUs.add(udid);
      await boot(simctl, udid, bootTimeoutMs);
      return {
        id: `tvos:${udid}`,
        platform: 'tvos',
        address: udid,
        meta: {
          name,
          model: type.name,
          osVersion: runtime.version,
          runtimeId: runtime.identifier,
          ...(options.deviceSet ? { deviceSet: options.deviceSet } : {}),
        },
        // The simulator stays booted for the next acquire of this worker; dispose shuts down.
        release: async () => {},
      };
    },
    async dispose(): Promise<void> {
      if (options.keepBooted) return;
      const udids = [...bootedByUs];
      bootedByUs.clear();
      await Promise.allSettled(udids.map((udid) => simctl.shutdown(udid)));
    },
  };
}

/**
 * Prepares a simulator handed over by the `external` or `command` provider: checks that it
 * exists and runs tvOS, boots it when needed and waits for boot completion.
 */
export async function prepareSimulator(
  udid: string,
  opts: {
    readonly deviceSet?: string | undefined;
    readonly bootTimeoutMs?: number;
    readonly runner?: CommandRunner;
  } = {},
): Promise<TvosSimulator> {
  const simctl = new Simctl(opts.deviceSet, opts.runner ?? defaultRunner);
  const device = (await simctl.listDevices()).find(
    (d) => d.udid.toLowerCase() === udid.toLowerCase(),
  );
  if (!device) {
    throw tvosError(
      TvosErrorCode.SIMULATOR_NOT_FOUND,
      `No simulator with UDID ${udid} in ${opts.deviceSet ? `device set ${opts.deviceSet}` : "Xcode's default device set"}.`,
      {
        hint: 'If a lease broker created the simulator in its own device set, pass that path as `deviceSet` (driver option or `meta.deviceSet` of the lease).',
        docs: DOCS.simulators,
      },
    );
  }
  if (!isTvosRuntime(device.runtimeId)) {
    throw tvosError(
      TvosErrorCode.NOT_TVOS,
      `Simulator ${device.name} (${udid}) runs ${device.runtimeId}, not tvOS.`,
      { hint: 'Lease or create an Apple TV simulator.', docs: DOCS.simulators },
    );
  }
  if (device.state !== 'Booted') await boot(simctl, device.udid, opts.bootTimeoutMs);
  return {
    udid: device.udid,
    name: device.name,
    runtimeId: device.runtimeId,
    osVersion: versionFromRuntimeId(device.runtimeId) ?? '',
    deviceSet: opts.deviceSet,
  };
}

/**
 * The device set a lease lives in: `meta.deviceSet`, or the `SIMLOCK_IOS_DEVICE_SET` entry of
 * `meta.environment` (leases from simlock and the `command` provider). `undefined` = default.
 */
export function deviceSetFromLease(lease: DeviceLease | undefined): string | undefined {
  if (!lease) return undefined;
  const direct = lease.meta.deviceSet;
  if (typeof direct === 'string' && direct) return direct;
  return leaseEnvironment(lease).SIMLOCK_IOS_DEVICE_SET || undefined;
}

async function boot(simctl: Simctl, udid: string, timeoutMs = DEFAULT_BOOT_TIMEOUT_MS) {
  try {
    await simctl.bootAndWait(udid, timeoutMs);
  } catch (cause) {
    throw tvosError(TvosErrorCode.BOOT_FAILED, `Simulator ${udid} did not boot.`, {
      hint: `Booting can take minutes on a cold machine; raise \`bootTimeoutMs\` (now ${timeoutMs}ms) or check free memory.`,
      docs: DOCS.simulators,
      cause,
    });
  }
}

export function pickRuntime(runtimes: readonly SimRuntime[], osVersion?: string): SimRuntime {
  const tvos = runtimes
    .filter((r) => r.isAvailable && (r.platform === 'tvOS' || isTvosRuntime(r.identifier)))
    .sort((a, b) => compareVersions(b.version, a.version));
  const match = osVersion ? tvos.find((r) => versionMatches(r.version, osVersion)) : tvos[0];
  if (!match) {
    const installed = tvos.map((r) => r.version).join(', ') || 'none';
    throw tvosError(
      TvosErrorCode.RUNTIME_MISSING,
      `No installed tvOS simulator runtime${osVersion ? ` matches ${osVersion}` : ''} (installed: ${installed}).`,
      {
        hint: 'Install one with `xcodebuild -downloadPlatform tvOS`, or change `osVersion`.',
        docs: DOCS.simulators,
      },
    );
  }
  return match;
}

export function pickDeviceType(
  types: readonly SimDeviceType[],
  runtime: SimRuntime,
  model?: string,
): SimDeviceType {
  const supported = (t: SimDeviceType) =>
    !runtime.supportedDeviceTypeIds || runtime.supportedDeviceTypeIds.includes(t.identifier);
  const appleTvs = types.filter((t) => isAppleTv(t) && supported(t));
  const pick = model
    ? appleTvs.find((t) => t.name === model)
    : (DEFAULT_TVOS_MODELS.map((name) => appleTvs.find((t) => t.name === name)).find(Boolean) ??
      appleTvs[0]);
  if (!pick) {
    throw tvosError(
      TvosErrorCode.DEVICE_TYPE_MISSING,
      `${model ? `Device type "${model}" is not` : 'No Apple TV device type is'} available for ${runtime.name}.`,
      {
        hint: `Use one of: ${appleTvs.map((t) => t.name).join(', ') || '(none; reinstall the tvOS runtime)'}.`,
        docs: DOCS.simulators,
      },
    );
  }
  return pick;
}

function isAppleTv(t: SimDeviceType): boolean {
  return t.productFamily === 'Apple TV' || t.identifier.includes('Apple-TV');
}

/** `18` matches `18.4`, `18.4` matches `18.4` and `18.4.1`, not `18.40`. */
export function versionMatches(version: string, requested: string): boolean {
  const have = version.split('.');
  return requested.split('.').every((part, i) => have[i] === part);
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
