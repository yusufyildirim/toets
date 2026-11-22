/**
 * Builds the native apps from a clean `expo prebuild` and copies them to stable paths:
 *
 *   node scripts/build-native.ts android   ->  dist/android/dpad-tv-debug.apk
 *   node scripts/build-native.ts tvos      ->  dist/tvos/dpadTV.app (tvOS Simulator)
 *
 * Both embed the JS bundle, so they run without Metro: the APK is a debug build (see
 * app.config.ts), the tvOS app a Release build (Debug simulator builds always load JS from Metro).
 * Env: ANDROID_ABIS (default arm64-v8a,x86_64).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = process.argv[2];

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`\n${command} failed (exit ${result.status ?? result.signal})`);
    process.exit(result.status ?? 1);
  }
}

function publish(from: string, to: string) {
  rmSync(`${root}${to}`, { recursive: true, force: true });
  mkdirSync(`${root}${to.slice(0, to.lastIndexOf('/'))}`, { recursive: true });
  cpSync(`${root}${from}`, `${root}${to}`, { recursive: true });
  console.log(`\nBuilt ${to}`);
}

if (target === 'android') {
  run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install'], {
    env: { CI: '1' },
  });
  const abis = process.env.ANDROID_ABIS ?? 'arm64-v8a,x86_64';
  run('./gradlew', ['assembleDebug', `-PreactNativeArchitectures=${abis}`, '--console=plain'], {
    cwd: `${root}android`,
  });
  publish('android/app/build/outputs/apk/debug/app-debug.apk', 'dist/android/dpad-tv-debug.apk');
} else if (target === 'tvos') {
  run('npx', ['expo', 'prebuild', '--platform', 'ios', '--clean'], { env: { CI: '1' } });
  run('xcodebuild', [
    '-workspace',
    'ios/dpadTV.xcworkspace',
    '-scheme',
    'dpadTV',
    '-configuration',
    'Release',
    '-sdk',
    'appletvsimulator',
    '-destination',
    'generic/platform=tvOS Simulator',
    '-derivedDataPath',
    'build/tvos',
    '-quiet',
  ]);
  publish('build/tvos/Build/Products/Release-appletvsimulator/dpadTV.app', 'dist/tvos/dpadTV.app');
} else {
  console.error('Usage: node scripts/build-native.ts <android|tvos>');
  process.exit(1);
}
