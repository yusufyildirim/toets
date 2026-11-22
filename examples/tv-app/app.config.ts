import type { ExpoConfig } from 'expo/config';
import { withAppBuildGradle, withMainActivity, type ConfigPlugin } from 'expo/config-plugins';

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

/**
 * dpad SDK glue for Android: hands the `__dpad` launch intent extra to JS as the root
 * component's `__dpad` initial prop, where `@dpad-tv/sdk-react-native` reads it. Only in e2e
 * builds (`DPAD_E2E=1`), the same switch that keeps the SDK out of other bundles (metro.config.ts).
 */
const withDpadLaunchOptions: ConfigPlugin = (config) =>
  withMainActivity(config, (mod) => {
    if (process.env.DPAD_E2E !== '1') return mod;
    const delegate = /(object\s*:\s*DefaultReactActivityDelegate\([^)]*\)\s*)\{\s*\}/;
    if (mod.modResults.language !== 'kt' || !delegate.test(mod.modResults.contents)) {
      throw new Error(
        'withDpadLaunchOptions: DefaultReactActivityDelegate not found in MainActivity',
      );
    }
    const contents = mod.modResults.contents.replace(
      delegate,
      `$1{
              // dpad: pass the launch payload (intent extra) to JS. E2E builds only.
              override fun getLaunchOptions(): Bundle? =
                this@MainActivity.intent?.getStringExtra("__dpad")
                  ?.let { Bundle().apply { putString("__dpad", it) } }
          }`,
    );
    mod.modResults.contents = contents.includes('import android.os.Bundle\n')
      ? contents
      : contents.replace(/^(package [^\n]+\n)/, '$1\nimport android.os.Bundle\n');
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

export default withDpadLaunchOptions(withEmbeddedDebugBundle(config));
