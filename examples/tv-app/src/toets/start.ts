/**
 * Starts the toets SDK. Imported first by the entry file, so the SDK is in place before any
 * app module runs (a call next to the imports would run after them: imports are hoisted).
 * Inert unless toets launched the app; production builds get the no-op module (metro.config.ts).
 */
import { startToets } from '@toets/sdk-react-native';

startToets({
  // The player reports through `usePlayerMedia` on every platform, so react-native-web must
  // not also expose the raw <video> element as a second player.
  web: { media: false },
});
