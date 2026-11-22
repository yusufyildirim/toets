import { DpadError, docsLink } from '@dpad-tv/core';

/** Error codes thrown by the tvOS driver. Branch on these, not on messages. */
export const TvosErrorCode = {
  NOT_STARTED: 'TVOS_NOT_STARTED',
  CONFIG: 'TVOS_CONFIG',
  NO_DEVICE: 'TVOS_NO_DEVICE',
  SIMULATOR_NOT_FOUND: 'TVOS_SIMULATOR_NOT_FOUND',
  NOT_TVOS: 'TVOS_NOT_A_TVOS_SIMULATOR',
  RUNTIME_MISSING: 'TVOS_RUNTIME_MISSING',
  DEVICE_TYPE_MISSING: 'TVOS_DEVICE_TYPE_MISSING',
  SIMCTL_FAILED: 'TVOS_SIMCTL_FAILED',
  BOOT_FAILED: 'TVOS_BOOT_FAILED',
  APPIUM_START_FAILED: 'TVOS_APPIUM_START_FAILED',
  WDA_BUILD_FAILED: 'TVOS_WDA_BUILD_FAILED',
  SESSION_FAILED: 'TVOS_SESSION_FAILED',
  APP_NOT_INSTALLED: 'TVOS_APP_NOT_INSTALLED',
  COMMAND_FAILED: 'TVOS_COMMAND_FAILED',
  KEY_UNSUPPORTED: 'TVOS_KEY_UNSUPPORTED',
  ELEMENT_DETACHED: 'TVOS_ELEMENT_DETACHED',
  ELEMENT_NOT_VISIBLE: 'TVOS_ELEMENT_NOT_VISIBLE',
  RECORDING_FAILED: 'TVOS_RECORDING_FAILED',
} as const;

export type TvosErrorCode = (typeof TvosErrorCode)[keyof typeof TvosErrorCode];

/** Docs pages shipped in this package (`docs/<page>.md`). */
export type TvosDocsPage = 'setup' | 'simulators' | 'remote' | 'capabilities' | 'traps';

export function tvosError(
  code: TvosErrorCode,
  message: string,
  opts: { hint?: string; docs?: TvosDocsPage; cause?: unknown } = {},
): DpadError {
  return new DpadError(code, message, {
    ...(opts.hint === undefined ? {} : { hint: opts.hint }),
    ...(opts.docs === undefined ? {} : { docs: docsLink(`driver-tvos/${opts.docs}`) }),
    ...(opts.cause === undefined ? {} : { cause: opts.cause }),
  });
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
