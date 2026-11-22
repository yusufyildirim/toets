import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DOCS, androidError } from './errors.js';

/** Locations of the Android SDK tools the driver uses. */
export interface AndroidSdk {
  readonly root: string;
  readonly adb: string;
  readonly emulator: string;
  readonly avdmanager: string;
}

/**
 * Resolves the Android SDK: explicit `root`, then `ANDROID_HOME`, `ANDROID_SDK_ROOT`, then the
 * Android Studio default location for the OS.
 */
export function resolveAndroidSdk(
  root?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): AndroidSdk {
  const candidates = [root, env.ANDROID_HOME, env.ANDROID_SDK_ROOT, defaultSdkRoot(env, platform)];
  const found = candidates.find((c): c is string => !!c && existsSync(c));
  if (!found) {
    throw androidError('ANDROID_SDK_NOT_FOUND', 'Android SDK not found.', {
      hint: 'Install the Android SDK (Android Studio or command line tools) and set ANDROID_HOME.',
      docs: DOCS.setup,
    });
  }
  return sdkAt(found, platform);
}

/** Tool paths inside an SDK root (no existence check). */
export function sdkAt(root: string, platform: NodeJS.Platform = process.platform): AndroidSdk {
  const exe = platform === 'win32' ? '.exe' : '';
  const bat = platform === 'win32' ? '.bat' : '';
  return {
    root,
    adb: join(root, 'platform-tools', `adb${exe}`),
    emulator: join(root, 'emulator', `emulator${exe}`),
    avdmanager: join(root, 'cmdline-tools', 'latest', 'bin', `avdmanager${bat}`),
  };
}

function defaultSdkRoot(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (platform === 'darwin') return join(homedir(), 'Library', 'Android', 'sdk');
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? homedir(), 'Android', 'Sdk');
  return join(homedir(), 'Android', 'Sdk');
}
