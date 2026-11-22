import { LAUNCH_GLOBAL, LAUNCH_PARAM } from '@dpad-tv/protocol';
import { getGlobal } from '@dpad-tv/sdk';
import { Platform, Settings } from 'react-native';

/**
 * The launch payload available before the first render: `global.__DPAD__`, then (iOS and
 * tvOS) the `-__dpad <value>` launch argument, which `NSUserDefaults` exposes through
 * `Settings` without native code. `undefined` when not found.
 *
 * Android passes intent extras to JS only through the root component's initial props; see
 * {@link payloadFromInitialProps} and `docs/react-native.md`.
 */
export function discoverNativePayload(): unknown {
  const injected = getGlobal()[LAUNCH_GLOBAL];
  if (injected !== undefined && injected !== null && injected !== '') return injected;
  if (Platform.OS === 'ios') {
    try {
      const value: unknown = Settings.get(LAUNCH_PARAM);
      if (value !== undefined && value !== null && value !== '') return value;
    } catch {
      // Settings native module missing: no launch arguments.
    }
  }
  return undefined;
}

/** The `__dpad` initial prop (Android `getLaunchOptions()` glue), or `undefined`. */
export function payloadFromInitialProps(initialProps: unknown): unknown {
  if (typeof initialProps !== 'object' || initialProps === null) return undefined;
  const value = (initialProps as Record<string, unknown>)[LAUNCH_PARAM];
  return value === null || value === '' ? undefined : value;
}
