import type { DeviceProvider } from '../devices.js';
import type { DriverModule } from '../driver.js';
import { ToetsError, packageDocsLink } from '../errors.js';
import { createCommandDeviceProvider, type CommandDevicesOptions } from '../providers/command.js';
import { createExternalDeviceProvider } from '../providers/external.js';

/** How a target gets its device. Web needs none. */
export type DeviceSelection =
  /** toets boots, snapshots and resets emulators/simulators through the driver package. */
  | 'managed'
  | { readonly mode: 'managed' }
  /** Already running devices: listed here or in `TOETS_DEVICES` (comma separated). */
  | { readonly mode: 'external'; readonly addresses?: readonly string[] }
  /** Shell commands lease and release devices (device farms, lease brokers). */
  | ({ readonly mode: 'command' } & CommandDevicesOptions);

/**
 * Picks the device provider for a target, or `undefined` when the platform needs no device.
 * Without a selection, the driver's own (`managed`) provider is used when it has one.
 */
export function selectDeviceProvider(
  selection: DeviceSelection | undefined,
  module: DriverModule,
  driverOptions: Readonly<Record<string, unknown>> = {},
): DeviceProvider | undefined {
  const mode = selection === 'managed' ? { mode: 'managed' as const } : selection;
  if (!mode) return module.createDeviceProvider?.(driverOptions);
  switch (mode.mode) {
    case 'managed': {
      const provider = module.createDeviceProvider?.(driverOptions);
      if (!provider) {
        throw new ToetsError(
          'NO_MANAGED_DEVICES',
          `The ${module.platform} driver cannot manage devices.`,
          {
            hint: "Use devices: { mode: 'external' } with running devices, or { mode: 'command' } with lease commands.",
            docs: packageDocsLink('test', 'devices'),
          },
        );
      }
      return provider;
    }
    case 'external':
      return createExternalDeviceProvider(mode.addresses ? { addresses: mode.addresses } : {});
    case 'command': {
      const { mode: _mode, ...opts } = mode;
      return createCommandDeviceProvider(opts);
    }
  }
}
