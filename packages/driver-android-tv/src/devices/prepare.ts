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
 * is booted, and reports what it is. The driver waits for boot itself on `start()`; a broker
 * integration calls this to fail fast before handing out a dead device.
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
  const isTv = (await adb.shell(['pm', 'has-feature', 'android.software.leanback'])).includes(
    'true',
  );
  if (opts.requireTv && !isTv) {
    throw androidError('ANDROID_NOT_A_TV', `${serial} is not an Android TV device.`, {
      hint: 'Use an Android TV / Google TV system image (`tv_1080p` device profile).',
      docs: DOCS.devices,
    });
  }
  return { serial, apiLevel, isTv };
}
