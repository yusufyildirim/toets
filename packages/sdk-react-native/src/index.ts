/**
 * toets in-app SDK adapter for React Native (react-native-tvos, react-native-web). Maps the
 * host view tree, native focus, `Animated` and players onto the toets protocol. Inert unless
 * the app was launched by toets. See `docs/`.
 *
 * @example
 * import { startToets } from '@toets/sdk-react-native';
 * startToets();
 */
export * from '@toets/sdk';
export {
  startToets,
  withToets,
  ToetsRoot,
  SDK_ID,
  type ToetsRootProps,
  type ReactNativeToetsOptions,
} from './adapter.js';
export { discoverNativePayload, payloadFromInitialProps } from './payload.js';
export { useToetsMedia, videoMediaProps, type VideoMediaProps } from './media.js';
export { navigationIdleListeners, type NavigationIdleListeners } from './idle.js';
export type { HostProps } from './fiber.js';
export type { FocusTarget } from './focus.js';
