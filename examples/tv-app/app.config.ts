import type { ExpoConfig } from 'expo/config';
import { withAppBuildGradle, type ConfigPlugin } from 'expo/config-plugins';

/**
 * Embeds the JS bundle in debug APKs too (React Native skips it by default), so the debug
 * APK runs without Metro. Metro still wins when it is reachable, so `expo run:android` keeps
 * fast refresh.
 */
const withEmbeddedDebugBundle: ConfigPlugin = (config) =>
  withAppBuildGradle(config, (mod) => {
    const marker = '// debuggableVariants = ["liteDebug", "prodDebug"]';
    if (!mod.modResults.contents.includes(marker)) {
      throw new Error('withEmbeddedDebugBundle: react { } block not found in app/build.gradle');
    }
    mod.modResults.contents = mod.modResults.contents.replace(marker, 'debuggableVariants = []');
    return mod;
  });

const config: ExpoConfig = {
  name: 'dpad TV',
  slug: 'dpad-tv-example',
  version: '1.0.0',
  orientation: 'landscape',
  ios: { bundleIdentifier: 'dev.dpad.example' },
  android: { package: 'dev.dpad.example' },
  web: { bundler: 'metro', output: 'single', name: 'dpad TV example' },
  plugins: [
    [
      '@react-native-tvos/config-tv',
      { isTV: true, androidTVRequired: true, tvosDeploymentTarget: '17.0' },
    ],
    'expo-video',
  ],
};

export default withEmbeddedDebugBundle(config);
