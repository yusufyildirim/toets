import { KEY_CAPABILITY, type Capability, type Key } from '@toets/core';

/**
 * Android `KeyEvent` keycode for every toets {@link Key}. Android TV defines a keycode for
 * every canonical key, so the mapping is total; what a given remote physically has is
 * expressed by the {@link RemoteProfile}, not here.
 */
export const ANDROID_KEYCODES: Readonly<Record<Key, number>> = {
  UP: 19, // KEYCODE_DPAD_UP
  DOWN: 20, // KEYCODE_DPAD_DOWN
  LEFT: 21, // KEYCODE_DPAD_LEFT
  RIGHT: 22, // KEYCODE_DPAD_RIGHT
  SELECT: 23, // KEYCODE_DPAD_CENTER
  BACK: 4, // KEYCODE_BACK
  HOME: 3, // KEYCODE_HOME
  MENU: 82, // KEYCODE_MENU
  INFO: 165, // KEYCODE_INFO
  PLAY_PAUSE: 85, // KEYCODE_MEDIA_PLAY_PAUSE
  PLAY: 126, // KEYCODE_MEDIA_PLAY
  PAUSE: 127, // KEYCODE_MEDIA_PAUSE
  STOP: 86, // KEYCODE_MEDIA_STOP
  FAST_FORWARD: 90, // KEYCODE_MEDIA_FAST_FORWARD
  REWIND: 89, // KEYCODE_MEDIA_REWIND
  NEXT: 87, // KEYCODE_MEDIA_NEXT
  PREVIOUS: 88, // KEYCODE_MEDIA_PREVIOUS
  RED: 183, // KEYCODE_PROG_RED
  GREEN: 184, // KEYCODE_PROG_GREEN
  YELLOW: 185, // KEYCODE_PROG_YELLOW
  BLUE: 186, // KEYCODE_PROG_BLUE
  CHANNEL_UP: 166, // KEYCODE_CHANNEL_UP
  CHANNEL_DOWN: 167, // KEYCODE_CHANNEL_DOWN
  DIGIT_0: 7, // KEYCODE_0
  DIGIT_1: 8,
  DIGIT_2: 9,
  DIGIT_3: 10,
  DIGIT_4: 11,
  DIGIT_5: 12,
  DIGIT_6: 13,
  DIGIT_7: 14,
  DIGIT_8: 15,
  DIGIT_9: 16, // KEYCODE_9
};

/**
 * Which physical remote the tests should be honest about.
 * - `android-tv`: the full Android TV key set (Google TV / operator remotes have media, color,
 *   numeric, channel and info keys).
 * - `fire-tv`: the Alexa Voice Remote: D-pad, select, back, home, menu, play/pause, fast
 *   forward and rewind. No discrete play/pause, color, numeric, channel or info keys.
 */
export type RemoteProfile = 'android-tv' | 'fire-tv';

const ALL_KEY_CAPABILITIES: readonly Capability[] = [
  'key.back',
  'key.home',
  'key.menu',
  'key.info',
  'key.media.toggle',
  'key.media.discrete',
  'key.media.seek',
  'key.media.track',
  'key.color',
  'key.numeric',
  'key.channel',
];

/** Key capabilities per remote profile. `key.longpress` is added by the driver. */
export const REMOTE_PROFILE_CAPABILITIES: Readonly<Record<RemoteProfile, readonly Capability[]>> = {
  'android-tv': ALL_KEY_CAPABILITIES,
  // The Alexa Voice Remote has FAST_FORWARD/REWIND but no NEXT/PREVIOUS (see docs/fire-tv.md).
  'fire-tv': ['key.back', 'key.home', 'key.menu', 'key.media.toggle', 'key.media.seek'],
};

/** True when `key` can be pressed under the given capability set. */
export function keySupported(key: Key, capabilities: ReadonlySet<Capability>): boolean {
  const required = KEY_CAPABILITY[key];
  return required === null || capabilities.has(required);
}
