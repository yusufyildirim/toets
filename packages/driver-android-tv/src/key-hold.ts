import { fileURLToPath } from 'node:url';
import type { Adb } from './adb.js';
import { androidError } from './errors.js';

/** The dex jar built from `helper/src/tv/dpad/helper/KeyHold.java`. */
export const KEY_HOLD_JAR = fileURLToPath(new URL('../assets/dpad-key-hold.jar', import.meta.url));
const REMOTE_JAR = '/data/local/tmp/dpad-key-hold.jar';

/**
 * Holds a key for an exact duration with real auto-repeat (see `KeyHold.java`). UiAutomator2
 * can only send a press or a fixed long press, so holds run through a tiny on-device helper.
 */
export class KeyHolder {
  private pushed: Promise<void> | undefined;

  constructor(private readonly adb: Adb) {}

  async hold(keycode: number, holdMs: number): Promise<void> {
    this.pushed ??= this.adb.push(KEY_HOLD_JAR, REMOTE_JAR).catch((e: unknown) => {
      this.pushed = undefined;
      throw e;
    });
    await this.pushed;
    const ms = Math.max(0, Math.round(holdMs));
    const res = await this.adb.run(
      ['shell', `CLASSPATH=${REMOTE_JAR} app_process / tv.dpad.helper.KeyHold ${keycode} ${ms}`],
      { timeoutMs: ms + 30_000 },
    );
    if (res.exitCode !== 0 || !/repeats=\d+/.test(res.stdout)) {
      throw androidError(
        'ANDROID_COMMAND_FAILED',
        `Holding keycode ${keycode} for ${ms}ms failed: ${(res.stderr || res.stdout).trim()}`,
        { hint: 'The device must allow `app_process` from adb shell (all emulator images do).' },
      );
    }
  }
}
