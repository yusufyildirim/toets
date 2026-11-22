import type { DeviceLease, DeviceProvider } from '../devices.js';
import { DpadError, docsLink } from '../errors.js';

export interface ExternalDevicesOptions {
  /** Device addresses (Android serials, simulator UDIDs). Default: `DPAD_DEVICES`, comma separated. */
  readonly addresses?: readonly string[];
}

/** Reads `DPAD_DEVICES` (comma separated, blanks ignored). */
export function devicesFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.DPAD_DEVICES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * `external` device mode: devices are already running and the user lists them. Worker slot
 * `n` (Playwright's `parallelIndex`) gets the n-th address, so workers never share a device.
 * Releasing is a no-op: dpad did not start these devices and does not stop them.
 */
export function createExternalDeviceProvider(opts: ExternalDevicesOptions = {}): DeviceProvider {
  const addresses = opts.addresses ? [...opts.addresses] : devicesFromEnv();
  return {
    async acquire(spec, { parallelIndex }): Promise<DeviceLease> {
      if (!addresses.length) {
        throw new DpadError(
          'NO_DEVICES',
          `No ${spec.platform} devices configured for external mode.`,
          {
            hint: 'List running devices in the project config (devices: { mode: "external", addresses: [...] }) or in DPAD_DEVICES=emulator-5554,emulator-5556.',
            docs: docsLink('test/devices'),
          },
        );
      }
      const address = addresses[parallelIndex];
      if (address === undefined) {
        throw new DpadError(
          'NOT_ENOUGH_DEVICES',
          `Worker slot ${parallelIndex} has no device: ${addresses.length} external device(s) for more workers.`,
          {
            hint: `Run with --workers=${addresses.length} (one device per worker) or add devices.`,
            docs: docsLink('test/devices'),
          },
        );
      }
      return { id: address, platform: spec.platform, address, meta: {}, release: async () => {} };
    },
    async dispose() {},
  };
}
