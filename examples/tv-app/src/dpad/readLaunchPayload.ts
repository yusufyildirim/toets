import { requireOptionalNativeModule } from 'expo';

import { decodeLaunchParam, type LaunchPayload } from './launchPayload';

interface DpadLaunchModule {
  /** The raw `__dpad` intent extra (Android) or launch argument (tvOS), if any. */
  getRawPayload(): string | null;
}

/** Reads the launch payload on Android TV / tvOS through the local `dpad-launch` module. */
export function readLaunchPayload(): LaunchPayload | null {
  const native = requireOptionalNativeModule<DpadLaunchModule>('DpadLaunch');
  return decodeLaunchParam(native?.getRawPayload() ?? null);
}
