import type { DeviceLease, DeviceProvider, DeviceSpec } from '@dpad-tv/core';
import { Adb } from '../adb.js';
import { nodeCommandRunner, type CommandRunner } from '../command.js';
import { DOCS, androidError } from '../errors.js';
import { resolveAndroidSdk } from '../sdk.js';

/** What {@link prepareAndroidDevice} found out about a device. */
export interface AndroidDeviceInfo {
  readonly serial: string;
  readonly apiLevel: number;
  /** Has the `android.software.leanback` feature (Android TV / Google TV / Fire TV). */
  readonly isTv: boolean;
}

export interface PrepareDeviceOptions {
  readonly sdkRoot?: string;
  readonly bootTimeoutMs?: number;
  /** Throw `ANDROID_NOT_A_TV` for devices without the leanback feature. Default `false`. */
  readonly requireTv?: boolean;
  readonly runner?: CommandRunner;
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Waits until a device someone else provided (`external` / `command` providers, a lease broker)
 * is booted, and reports what it is. The driver calls this itself on `start()`; providers call
 * it to fail fast with a clear error before handing out a dead device.
 */
export async function prepareAndroidDevice(
  serial: string,
  opts: PrepareDeviceOptions = {},
): Promise<AndroidDeviceInfo> {
  const env = opts.env ?? process.env;
  const sdk = resolveAndroidSdk(opts.sdkRoot, env);
  const adb = new Adb(opts.runner ?? nodeCommandRunner, sdk.adb, serial, env);
  await adb.waitForBoot(opts.bootTimeoutMs ?? 180_000);
  const apiLevel = await adb.sdkVersion();
  const isTv = (await adb.shell(['pm', 'has-feature', 'android.software.leanback'])).includes('true');
  if (opts.requireTv && !isTv) {
    throw androidError('ANDROID_NOT_A_TV', `${serial} is not an Android TV device.`, {
      hint: 'Use an Android TV / Google TV system image (`tv_1080p` device profile).',
      docs: DOCS.devices,
    });
  }
  return { serial, apiLevel, isTv };
}

export interface ExternalDeviceOptions extends PrepareDeviceOptions {
  /** Device serials. Default: `DPAD_DEVICES` (comma separated). */
  readonly addresses?: readonly string[];
}

/**
 * Hands out devices you started yourself: worker `n` gets the `n`-th free serial. Nothing is
 * booted or killed; devices are only checked to be online and booted.
 */
export function createExternalDeviceProvider(opts: ExternalDeviceOptions = {}): DeviceProvider {
  const env = opts.env ?? process.env;
  const addresses =
    opts.addresses ??
    (env.DPAD_DEVICES ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const held = new Set<string>();
  return {
    async acquire(_spec: DeviceSpec, { workerIndex }): Promise<DeviceLease> {
      const preferred = addresses[workerIndex % Math.max(1, addresses.length)];
      const serial =
        preferred && !held.has(preferred) ? preferred : addresses.find((a) => !held.has(a));
      if (!serial) {
        throw androidError(
          'ANDROID_NO_DEVICE',
          addresses.length
            ? `All ${addresses.length} external devices are in use.`
            : 'No external devices configured.',
          {
            hint: 'List one serial per worker in DPAD_DEVICES (e.g. `emulator-5554,emulator-5556`) or lower the worker count.',
            docs: DOCS.devices,
          },
        );
      }
      held.add(serial);
      try {
        const info = await prepareAndroidDevice(serial, { ...opts, env });
        let released = false;
        return {
          id: serial,
          platform: 'android-tv',
          address: serial,
          meta: { apiLevel: info.apiLevel, isTv: info.isTv },
          release: async () => {
            if (released) return;
            released = true;
            held.delete(serial);
          },
        };
      } catch (e) {
        held.delete(serial);
        throw e;
      }
    },
    async dispose() {
      held.clear();
    },
  };
}
