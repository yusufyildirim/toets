import type { DeviceLease, DeviceProvider } from '../devices.js';
import { ToetsError, packageDocsLink } from '../errors.js';

export interface ExternalDevicesOptions {
  /** Device addresses (Android serials, simulator UDIDs). Default: `TOETS_DEVICES`, comma separated. */
  readonly addresses?: readonly string[];
}

/** Reads `TOETS_DEVICES` (comma separated, blanks ignored). */
export function devicesFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.TOETS_DEVICES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * `external` device mode: devices are already running and the user lists them. Worker slot
 * `n` (Playwright's `parallelIndex`) gets the n-th address, so workers never share a device.
 * Releasing is a no-op: toets did not start these devices and does not stop them.
 */
export function createExternalDeviceProvider(opts: ExternalDevicesOptions = {}): DeviceProvider {
  const addresses = opts.addresses ? [...opts.addresses] : devicesFromEnv();
  return {
    async acquire(spec, { parallelIndex }): Promise<DeviceLease> {
      if (!addresses.length) {
        throw new ToetsError(
          'NO_DEVICES',
          `No ${spec.platform} devices configured for external mode.`,
          {
            hint: 'List running devices in the project config (devices: { mode: "external", addresses: [...] }) or in TOETS_DEVICES=emulator-5554,emulator-5556.',
            docs: packageDocsLink('test', 'devices'),
          },
        );
      }
      const address = addresses[parallelIndex];
      if (address === undefined) {
        throw new ToetsError(
          'NOT_ENOUGH_DEVICES',
          `Worker slot ${parallelIndex} has no device: ${addresses.length} external device(s) for more workers.`,
          {
            hint: `Run with --workers=${addresses.length} (one device per worker) or add devices.`,
            docs: packageDocsLink('test', 'devices'),
          },
        );
      }
      return { id: address, platform: spec.platform, address, meta: {}, release: async () => {} };
    },
    async dispose() {},
  };
}
