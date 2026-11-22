import { DpadError, docsLink } from '@dpad-tv/core';

/** Error codes thrown by the Android TV driver. Stable: agents and users branch on them. */
export type AndroidTvErrorCode =
  | 'ANDROID_SDK_NOT_FOUND'
  | 'ANDROID_NO_DEVICE'
  | 'ANDROID_DEVICE_NOT_READY'
  | 'ANDROID_NOT_A_TV'
  | 'ANDROID_COMMAND_FAILED'
  | 'ANDROID_COMMAND_TIMEOUT'
  | 'ANDROID_APP_CONFIG'
  | 'ANDROID_APP_NOT_INSTALLED'
  | 'ANDROID_LAUNCH_FAILED'
  | 'ANDROID_APPIUM_START_FAILED'
  | 'ANDROID_SESSION_FAILED'
  | 'ANDROID_NOT_STARTED'
  | 'ANDROID_ELEMENT_DETACHED'
  | 'ANDROID_KEY_UNSUPPORTED'
  | 'ANDROID_SYSTEM_IMAGE_MISSING'
  | 'ANDROID_AVD_FAILED'
  | 'ANDROID_EMULATOR_FAILED'
  | 'ANDROID_RECORDING_FAILED';

/** Docs page slugs of this package (`node_modules/@dpad-tv/driver-android-tv/docs/<slug>.md`). */
export const DOCS = {
  setup: docsLink('android-tv/setup'),
  devices: docsLink('android-tv/devices'),
  keys: docsLink('android-tv/keys'),
  capabilities: docsLink('android-tv/capabilities'),
  traps: docsLink('android-tv/traps'),
} as const;

export function androidError(
  code: AndroidTvErrorCode,
  message: string,
  opts: { hint?: string; docs?: string; cause?: unknown } = {},
): DpadError {
  return new DpadError(code, message, opts);
}
