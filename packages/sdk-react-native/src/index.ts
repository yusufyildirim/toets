/**
 * dpad in-app SDK adapter for React Native (react-native-tvos, react-native-web). Maps the
 * host view tree, native focus, `Animated` and players onto the dpad protocol. Inert unless
 * the app was launched by dpad. See `docs/`.
 *
 * @example
 * import { startDpad } from '@dpad-tv/sdk-react-native';
 * startDpad();
 */
export * from '@dpad-tv/sdk';
export {
  startDpad,
  reportFocus,
  withDpad,
  DpadRoot,
  SDK_ID,
  type DpadRootProps,
  type ReactNativeDpadOptions,
} from './adapter.js';
export { discoverNativePayload, payloadFromInitialProps } from './payload.js';
export { useDpadMedia, videoMediaProps, type VideoMediaProps } from './media.js';
export { navigationIdleListeners, type NavigationIdleListeners } from './idle.js';
export type { HostProps } from './fiber.js';
export type { FocusTarget } from './focus.js';
