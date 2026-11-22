import type { Capability, Key } from '@dpad-tv/core';

/** Button names of `XCUIRemote` as accepted by XCUITest's `mobile: pressButton`. */
export type RemoteButton =
  'up' | 'down' | 'left' | 'right' | 'select' | 'menu' | 'playpause' | 'home';

/**
 * The only keys the tvOS driver presses, each a real Siri Remote button. The Siri Remote has
 * no discrete play/pause, transport, color, numeric or channel buttons, so those keys stay
 * unsupported (VISION decision 17). Apps that map, say, `FAST_FORWARD` to "hold RIGHT"
 * declare it as a key override in their dpad config; the core then presses RIGHT with
 * `holdMs` and flags the override in reports.
 *
 * `MENU` is not mapped: the remote's Menu/Back button is the platform's back action, so it
 * implements `BACK`.
 */
export const REMOTE_BUTTONS: Readonly<Partial<Record<Key, RemoteButton>>> = {
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
  SELECT: 'select',
  BACK: 'menu',
  PLAY_PAUSE: 'playpause',
  HOME: 'home',
};

/** Static capabilities of the tvOS driver. SDK capabilities are added by the core. */
export const TVOS_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'key.back',
  'key.home',
  'key.media.toggle',
  'key.longpress',
  'screenshot.element',
  'logs',
  'video',
]);
