import type { ExpoConfig } from 'expo/config';
import {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withMainActivity,
  type ConfigPlugin,
} from 'expo/config-plugins';

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
 * toets SDK glue for Android: hands the `__toets` launch intent extra to JS as the root
 * component's `__toets` initial prop, where `@toets/sdk-react-native` reads it. Only in e2e
 * builds (`TOETS_E2E=1`), the same switch that keeps the SDK out of other bundles (metro.config.ts).
 */
const withToetsLaunchOptions: ConfigPlugin = (config) =>
  withMainActivity(config, (mod) => {
    if (process.env.TOETS_E2E !== '1') return mod;
    const delegate = /(object\s*:\s*DefaultReactActivityDelegate\([^)]*\)\s*)\{\s*\}/;
    if (mod.modResults.language !== 'kt' || !delegate.test(mod.modResults.contents)) {
      throw new Error(
        'withToetsLaunchOptions: DefaultReactActivityDelegate not found in MainActivity',
      );
    }
    const contents = mod.modResults.contents.replace(
      delegate,
      `$1{
              // toets: pass the launch payload (intent extra) to JS. E2E builds only.
              override fun getLaunchOptions(): Bundle? =
                this@MainActivity.intent?.getStringExtra("__toets")
                  ?.let { Bundle().apply { putString("__toets", it) } }
          }`,
    );
    mod.modResults.contents = contents.includes('import android.os.Bundle\n')
      ? contents
      : contents.replace(/^(package [^\n]+\n)/, '$1\nimport android.os.Bundle\n');
    return mod;
  });

/** Fire TV-style content intent: a custom action with a `contentId` extra and no URI. */
const OPEN_DETAILS_ACTION = 'dev.toets.example.OPEN_DETAILS';

/**
 * Deep links beyond the `toetstv://` scheme (which `scheme` registers): Android also opens
 * details from a Fire TV-style intent, `OPEN_DETAILS` with a `contentId` extra. `MainActivity`
 * turns it into the app's own link (`toetstv://details/<id>`) at cold start and in
 * `onNewIntent`, so React Native's `Linking` handles both the same way.
 */
const withContentIntent: ConfigPlugin = (config) => {
  config = withAndroidManifest(config, (mod) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    activity['intent-filter'] = [
      ...(activity['intent-filter'] ?? []),
      {
        action: [{ $: { 'android:name': OPEN_DETAILS_ACTION } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
      },
    ];
    return mod;
  });
  return withMainActivity(config, (mod) => {
    const onCreate = /(\n(\s*)super\.onCreate\(null\))/;
    const classOpen = /(class MainActivity\s*:\s*ReactActivity\(\)\s*\{)/;
    if (
      mod.modResults.language !== 'kt' ||
      !onCreate.test(mod.modResults.contents) ||
      !classOpen.test(mod.modResults.contents)
    ) {
      throw new Error('withContentIntent: MainActivity.onCreate not found');
    }
    let contents = mod.modResults.contents.replace(onCreate, '\n$2toAppLink(intent)$1').replace(
      classOpen,
      `$1
  /** A Fire TV content intent (${OPEN_DETAILS_ACTION} + contentId) becomes the app's own link. */
  private fun toAppLink(intent: Intent?) {
    if (intent == null || intent.action != "${OPEN_DETAILS_ACTION}") return
    val id = intent.getStringExtra("contentId") ?: return
    intent.action = Intent.ACTION_VIEW
    intent.data = Uri.parse("toetstv://details/" + Uri.encode(id))
  }

  override fun onNewIntent(intent: Intent) {
    toAppLink(intent)
    super.onNewIntent(intent)
  }
`,
    );
    for (const name of ['android.content.Intent', 'android.net.Uri']) {
      if (!contents.includes(`import ${name}\n`)) {
        contents = contents.replace(/^(package [^\n]+\n)/, `$1\nimport ${name}\n`);
      }
    }
    mod.modResults.contents = contents;
    return mod;
  });
};

const config: ExpoConfig = {
  name: 'toets TV',
  slug: 'toets-tv-example',
  version: '1.0.0',
  orientation: 'landscape',
  // Deep links: `toetstv://details/<id>` and `toetstv://player/<id>` (Android intent filter,
  // tvOS CFBundleURLTypes). Web routes the same paths (`/details/<id>`).
  scheme: 'toetstv',
  ios: { bundleIdentifier: 'dev.toets.example' },
  android: { package: 'dev.toets.example' },
  web: { bundler: 'metro', output: 'single', name: 'toets TV example' },
  plugins: [
    [
      '@react-native-tvos/config-tv',
      { isTV: true, androidTVRequired: true, tvosDeploymentTarget: '17.0' },
    ],
    'expo-video',
  ],
};

export default withContentIntent(withToetsLaunchOptions(withEmbeddedDebugBundle(config)));
